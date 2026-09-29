import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { config } from "@/lib/config";
import { verifySignIn, type SignInInput } from "@/lib/siws";
import { verifyGenesisHolder } from "@/lib/genesis";
import { skrNameOf } from "@/lib/skr";
import { issueSession } from "@/lib/session";
import { readPosition, sharePrice } from "@/lib/staking";
import { address } from "@solana/kit";

export const runtime = "nodejs";

const Body = z.object({
  input: z.object({
    domain: z.string(), address: z.string().optional(), statement: z.string(), uri: z.string(), version: z.string(),
    chainId: z.string(), nonce: z.string(), issuedAt: z.string(), expirationTime: z.string(),
  }),
  output: z.object({ address: z.string().min(32).max(44), signedMessage: z.string(), signature: z.string() }),
  /** The client's own installation id (R84: one live session per wallet per device); a client that names none shares one slot. */
  device: z.string().min(4).max(64).optional(),
});

/**
 * Step two of sign-in: verify the signature, consume the nonce, require a Genesis Token, register the Seeker, issue a session.
 * Every entitlement decision happens here, never on the phone.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { input, output } = parsed.data;

  const signedMessage = new Uint8Array(Buffer.from(output.signedMessage, "base64"));
  const signature = new Uint8Array(Buffer.from(output.signature, "base64"));
  if (signature.length !== 64 || signedMessage.length === 0) return NextResponse.json({ error: "Bad signature." }, { status: 400 });

  const verified = await verifySignIn({ input: input as SignInInput, output: { address: output.address, signedMessage, signature } });
  if (!verified.ok) return NextResponse.json({ error: "The signature did not verify." }, { status: 401 });

  const repo = await getRepo();
  if (!(await repo.useNonce(input.nonce, output.address))) return NextResponse.json({ error: "This sign-in request expired. Try again." }, { status: 401 });

  const rpcUrl = config().heliusRpcUrl;
  const genesis = await verifyGenesisHolder(rpcUrl, output.address);
  if (!genesis) return NextResponse.json({ error: "This wallet holds no Seeker Genesis Token. The vault needs a Seeker." }, { status: 403 });

  const skrName = await skrNameOf(rpcUrl, output.address);
  let created: boolean;
  try {
    ({ created } = await repo.upsertUser({ seedVaultPubkey: output.address, sgtMint: genesis.mint, skrName }));
  } catch (e) {
    if (e instanceof Error && e.message === "This Seeker is already registered.") return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
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
