import { langOf } from "@/lib/i18n";
import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { config } from "@/lib/config";
import { redactError } from "@/lib/redact";
import { verifySignIn, type SignInInput } from "@/lib/siws";
import { verifyAnyGenesisHolder } from "@/lib/genesis";
import { skrNameOf } from "@/lib/skr";
import { issueSession } from "@/lib/session";
import { readPosition, sharePrice } from "@/lib/staking";
import { address } from "@solana/kit";
import { TERMS_VERSION } from "@/lib/terms";
import { addressOrNull, withFailureLog } from "@/lib/failure-log";
import { clientIp, rateLimited } from "@/lib/auth-guard";

export const runtime = "nodejs";

const Body = z.object({
  input: z.object({
    domain: z.string(), address: z.string().optional(), statement: z.string(), uri: z.string(), version: z.string(),
    chainId: z.string(), nonce: z.string(), issuedAt: z.string(), expirationTime: z.string(),
  }),
  output: z.object({ address: z.string().min(32).max(44), signedMessage: z.string(), signature: z.string() }),
  /** The client's own installation id (R84: one live session per wallet per device); a client that names none shares one slot. */
  device: z.string().min(4).max(64).optional(),
  /** R283, contracts 5.6: the Terms version the person accepted on the sign-in screen; only the current one is recorded. */
  termsVersion: z.string().max(32).optional(),
  /** 0.1.13 (his ruling 11-24): the phone's language code only ("es"), to count which languages users read. Anything else is ignored. */
  lang: z.string().max(8).optional(),
});

/**
 * Step two of sign-in: verify the signature, consume the nonce, require a Genesis Token (Seeker or Saga, R86), register the phone, issue a session.
 * Every entitlement decision happens here, never on the phone.
 */
async function verify(request: Request) {
  const lang = langOf(request);
  // 10-31 (Kimi MED-1): a failed verify now writes an event, so an anonymous loop is slowed here like the nonce route (a 429 is not recorded).
  if (rateLimited(`verify:${clientIp(request)}`, 20)) return apiError("rate_limited", { error: "Too many requests. Try again in a minute." }, { status: 429 }, lang);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("bad_request", { error: "Bad request." }, { status: 400 }, lang);
  const { input, output } = parsed.data;

  const signedMessage = new Uint8Array(Buffer.from(output.signedMessage, "base64"));
  const signature = new Uint8Array(Buffer.from(output.signature, "base64"));
  if (signature.length !== 64 || signedMessage.length === 0) return apiError("bad_signature", { error: "Bad signature." }, { status: 400 }, lang);

  const verified = await verifySignIn({ input: input as SignInInput, output: { address: output.address, signedMessage, signature } });
  if (!verified.ok) return apiError("signature_invalid", { error: "The signature did not verify." }, { status: 401 }, lang);

  const repo = await getRepo();
  if (!(await repo.useNonce(input.nonce, output.address))) return apiError("nonce_expired", { error: "This sign-in request expired. Try again." }, { status: 401 }, lang);

  const rpcUrl = config().heliusRpcUrl;
  // K-M10: these two take the URL itself (web3.js Connection, a raw fetch); an error that quotes it is redacted before it propagates.
  const genesis = await verifyAnyGenesisHolder(rpcUrl, output.address).catch((e: unknown) => { throw redactError(e); });
  if (!genesis) return apiError("no_genesis_token", { error: "This wallet holds no Genesis Token. The vault needs a Seeker or a Saga." }, { status: 403 }, lang);

  const skrName = await skrNameOf(rpcUrl, output.address).catch((e: unknown) => { throw redactError(e); });
  let created: boolean;
  try {
    ({ created } = await repo.upsertUser({ seedVaultPubkey: output.address, sgtMint: genesis.mint, skrName }));
  } catch (e) {
    if (e instanceof Error && e.message === "This phone is already registered.") return apiError("phone_registered", { error: e.message }, { status: 409 }, lang);
    throw e;
  }
  // The first acceptance of this version stands: a later sign-in neither moves its time nor adds an event.
  if (parsed.data.termsVersion === TERMS_VERSION && (await repo.getUser(output.address))?.termsVersion !== TERMS_VERSION) {
    await repo.setTermsAccepted(output.address, TERMS_VERSION, new Date());
    await repo.addEvent({ userPubkey: output.address, walletPubkey: null, kind: "terms_accepted", detail: { version: TERMS_VERSION, at: "sign-in" } });
  }
  // 0.1.13: one language_seen event when a user's phone language is new or changed (the code only, nothing derived from it).
  const phoneLang = parsed.data.lang?.toLowerCase();
  if (phoneLang && /^[a-z]{2,3}$/.test(phoneLang)) {
    try {
      const [last] = await repo.listEvents(output.address, ["language_seen"], 1);
      if ((last?.detail as { lang?: unknown } | null)?.lang !== phoneLang) await repo.addEvent({ userPubkey: output.address, walletPubkey: null, kind: "language_seen", detail: { lang: phoneLang } });
    } catch (e) {
      console.error(`sign-in: language not recorded: ${e instanceof Error ? e.message : String(e)}`);   // never fails a sign-in
    }
  }
  if (created) {
    // R61: what the Seeker already holds today is put in, never earned; the pot and the reconciliation count from here.
    const p = await readPosition(address(output.address));
    await repo.setJoinedPosition(output.address, { shares: p.shares, sharePrice: await sharePrice() });
    // A cooldown already running from the wallet: a wallet-source row so the basket shows and the crank delivers it [A24]. Its shares
    // already left the position the join recorded, so there is no principal to subtract (review I1).
    if (p.unstakingRaw > 0n) await repo.insertWithdrawal({ userPubkey: output.address, asset: "SKR", source: "wallet", unstakeSignature: null, sharesUnstaked: 0n, amountRaw: p.unstakingRaw, principalRaw: 0n });
  }
  // One live session per wallet per device (R84): the device is the client's own installation id (review I5), never the Genesis mint.
  return NextResponse.json({ token: await issueSession(output.address, parsed.data.device ?? "unnamed"), skrName, sgtMint: genesis.mint });
}

/**
 * 10-31: who a failed sign-in was. The address is someone's only once the signature verified AND it is a registered user: anyone can
 * make a fresh key and sign (security review), so a stranger's failure (no Genesis Token, say) stays anonymous and is never alerted.
 */
async function signInWho(req: Request, f: { status: number; error: string }) {
  const claimed = addressOrNull(((await req.json().catch(() => null)) as { output?: { address?: unknown } } | null)?.output?.address);
  // Kimi LOW-1: a 401 counts as verified only on the nonce-expired text, so a reworded message fails safe (anonymous), never open.
  const verified = f.status === 401 ? f.error === "This sign-in request expired. Try again." : f.status === 403 || f.status === 409;
  const known = verified && claimed !== null && (await (await getRepo()).getUser(claimed)) !== null;
  return known ? { userPubkey: claimed, walletPubkey: null } : { userPubkey: null, walletPubkey: claimed };
}
export const POST = withFailureLog("signin_failed", "verify", signInWho, verify);
