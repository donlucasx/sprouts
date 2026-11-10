import { NextResponse } from "next/server";
import { address, type Address, type Base64EncodedWireTransaction } from "@solana/kit";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { clientIp, rateLimited } from "@/lib/auth-guard";
import { config } from "@/lib/config";
import { APPROVE_ALL, delegationPda, usdcAta, waitForDelegation } from "@/lib/subscriptions";
import { leashPda } from "@/lib/leash";
import { heliusAddAddress } from "@/lib/helius";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { rpc } from "@/lib/rpc";
import { SUBSCRIPTIONS_PROGRAM, USDC_MINT } from "@/lib/constants";
import { findSubscriptionAuthorityPda } from "@solana/subscriptions";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { errorText, sendFailureText } from "@/lib/redact";
import { addressOrNull, linkOwner, withFailureLog } from "@/lib/failure-log";

export const runtime = "nodejs";
export const maxDuration = 60; // the delegation poll (up to 10 s) plus the send

/** The approve-once terms link/[code] builds (buildApproveOnceIxs): $5 a day, a one-day period, no expiry. */
const DAILY_CAP_RAW = 5_000_000n;
const DAY_S = 86_400n;
const Body = z.object({ code: z.string().length(6), wallet: z.string().min(32).max(44), waitMs: z.number().int().min(0).max(10_000).optional(), signedTransaction: z.string().optional() });
/** The delegation a leash link for (wallet, garden) names, or null when the garden id is not an address. */
async function leashDelegationPda(wallet: Address, garden: string, nonce: bigint): Promise<Address | null> {
  let user: Address;
  try {
    user = address(garden);
  } catch {
    return null;
  }
  return delegationPda({ delegator: wallet, delegatee: await leashPda(wallet, user), nonce });
}

/** Links the wallet once its delegation is on chain: consumes the code, records the wallet, adds it to the swap webhook. */
async function confirm(request: Request) {
  // Per caller IP (R207 #7): the confirm can hold a function for up to 10 s, so a loop from one address is slowed here.
  if (rateLimited(`link-confirm:${clientIp(request)}`, 20)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const code = parsed.data.code.toUpperCase();
  let wallet: Address;
  try {
    wallet = address(parsed.data.wallet);
  } catch {
    return NextResponse.json({ error: "That does not look like a Solana address." }, { status: 400 });
  }

  const repo = await getRepo();
  const link = await repo.peekLinkCode(code);
  if (!link) return NextResponse.json({ error: "This code is unknown, expired or already used." }, { status: 404 });
  if (!link.walletPubkey || !link.delegationPda) return NextResponse.json({ error: "Fetch the approval for this code first." }, { status: 409 });
  if (link.walletPubkey !== wallet) return NextResponse.json({ error: "This code was already used with another wallet. Get a new code in the app, then try again." }, { status: 409 });
  const existing = await repo.getWallet(wallet);
  if (existing && existing.userPubkey !== link.userPubkey && existing.status !== "revoked") {
    return NextResponse.json({ error: "This wallet is linked to another Seeker. Revoke it there first." }, { status: 409 });
  }

  let sendError: string | null = null;
  // The phone's own wallet posts the signed approval here [A3]: it must be this wallet's own approval for this delegation, then the API sends it.
  if (parsed.data.signedTransaction) {
    let posted;
    try {
      // The approval may begin by creating the wallet's USDC account (a wallet that never held USDC).
      // A re-link may also put back the USDC approval the wallet removed (link/[code] reapprove, 10-27): one token Approve.
      posted = verifyPostedTransaction({ base64: parsed.data.signedTransaction, feePayer: wallet, programs: [SUBSCRIPTIONS_PROGRAM, ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS] });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
    // The token program is allowed for that Approve only: this wallet's USDC account, its own USDC subscription authority as delegate,
    // the full allowance the init sets. Any other token instruction (a transfer, an approve to anyone else) is refused unsent.
    const [authorityPda] = await findSubscriptionAuthorityPda({ user: wallet, tokenMint: USDC_MINT });
    const ata = await usdcAta(wallet);
    const approveOk = (ix: { data: Uint8Array; accounts: Address[] }) => ix.data.length === 9 && ix.data[0] === 4
      && new DataView(ix.data.buffer, ix.data.byteOffset, 9).getBigUint64(1, true) === APPROVE_ALL
      && ix.accounts[0] === ata && ix.accounts[1] === authorityPda && ix.accounts[2] === wallet;
    if (posted.instructions.some((ix) => ix.program === TOKEN_PROGRAM_ADDRESS && !approveOk(ix))) return NextResponse.json({ error: "This approval is not the one Sprouts asked for. Nothing was linked; get a new code in the app." }, { status: 400 });
    const boundPda = address(link.delegationPda);
    if (!posted.instructions.some((ix) => ix.accounts.includes(boundPda))) return NextResponse.json({ error: "This approval is for another delegation. Get a new code in the app, then try again." }, { status: 400 });
    try {
      await rpc().sendTransaction(posted.wire as Base64EncodedWireTransaction, { encoding: "base64", preflightCommitment: "confirmed" }).send();
    } catch (e) {
      // A lost answer is not a lost approval (review I3): the delegation poll below decides, and the app retries confirm with the same code.
      // 11-01 (Kimi MED, hapybuda.skr): the reason was only logged, and Vercel keeps logs about an hour; it now rides the 409 below, so the
      // link_failed event (failure-log.ts) and the founder's alert carry it. An "already processed" here is the app's re-post of a landed approval.
      sendError = sendFailureText(e);
      console.error(`link confirm: send answered with an error for ${wallet}: ${sendError}`);
    }
  }

  const delegation = await waitForDelegation(address(link.delegationPda), parsed.data.waitMs ?? 10_000);
  // Every answer below keeps the stem "No delegation found" the app's retry matches (app/src/lib/confirm-retry.ts LINK_NOT_ON_CHAIN_YET).
  if (!delegation.exists) {
    const error = sendError
      ? `No delegation found: the network did not accept the approval (${sendError}). Nothing was linked. Try again.`
      : parsed.data.signedTransaction
        ? "No delegation found yet: your approval was sent but is not on chain. Trying again is safe."
        : "No delegation found for this wallet yet. Sign the approval first.";
    return NextResponse.json({ error }, { status: 409 });
  }
  // K-M4 (like relink/confirm): the chain must show the terms the link page built: this wallet as delegator, a delegatee that derives
  // the bound PDA, $5 a day, a one-day period, no expiry, on USDC, under this wallet's USDC subscription authority. Anything else
  // records nothing and leaves the code unburned (fails closed).
  const [authority] = await findSubscriptionAuthorityPda({ user: wallet, tokenMint: USDC_MINT });
  const termsOk = delegation.delegator === wallet && !!delegation.delegatee
    && (await delegationPda({ delegator: wallet, delegatee: delegation.delegatee, nonce: link.nonce })) === link.delegationPda
    && delegation.amountPerPeriodRaw === DAILY_CAP_RAW && delegation.periodLengthS === DAY_S && delegation.expiryTs === 0n
    && delegation.mint === USDC_MINT && delegation.subscriptionAuthority === authority;
  if (!termsOk) {
    console.error(`link confirm: the delegation at ${link.delegationPda} is not the approve-once Sprouts built for ${wallet}`);
    return NextResponse.json({ error: "This approval is not the one Sprouts asked for. Nothing was linked; get a new code in the app." }, { status: 409 });
  }

  const taken = await repo.takeLinkCode(code, wallet);
  if (!taken) return NextResponse.json({ error: "This code is unknown, expired or already used." }, { status: 404 });

  // The webhook add comes first so the wallet row can carry its outcome; a Helius failure never fails the link (repair pass later).
  let webhookAdded = true;
  try {
    // 11-10: every known linked wallet rides along, so one a racing link's write dropped is put back now, not at the daily pass.
    const known = await Promise.all([repo.listActiveWallets(), repo.listPausedWallets()]).then(([a, p]) => [...a, ...p].map((w) => w.pubkey), (e) => { console.error(`link confirm: known-wallet read failed, adding only the new wallet: ${errorText(e)}`); return [] as string[]; });
    await heliusAddAddress(config().heliusWebhookId, wallet, known);
  } catch (e) {
    webhookAdded = false;
    console.error(`helius add address failed for ${wallet}: ${errorText(e)}`);   // residual O3: the webhook URL carries HELIUS_API_KEY
  }
  // R297 / contracts 3.4, review I3: 'leash' only when the bound delegation is exactly the one named for leashPda(wallet, garden);
  // anything else (the puller, a rotated puller, a garden id that is not an address) is 'puller', which after go-live plants nothing
  // and asks for a re-link: the classification fails toward the safe side.
  const linkModel = (await leashDelegationPda(wallet, link.userPubkey, link.nonce)) === link.delegationPda ? "leash" : "puller";
  await repo.addWallet({ pubkey: wallet, userPubkey: link.userPubkey, delegationPda: link.delegationPda, dailyCapCents: Number(delegation.amountPerPeriodRaw / 10_000n), webhookAdded, linkModel });
  await repo.addEvent({ userPubkey: link.userPubkey, walletPubkey: wallet, kind: "wallet_linked", detail: { webhookAdded, linkModel } });
  const user = await repo.getUser(link.userPubkey);
  return NextResponse.json({ linked: true, skrName: user?.skrName ?? null });
}

/** 10-31: a failed confirm, tied to the code's owner while the code is live. */
async function confirmWho(req: Request) {
  const b = (await req.json().catch(() => null)) as { code?: unknown; wallet?: unknown } | null;
  return { userPubkey: await linkOwner(b?.code), walletPubkey: addressOrNull(b?.wallet) };
}
export const POST = withFailureLog("link_failed", "confirm", confirmWho, confirm);
