import { NextResponse } from "next/server";
import { z } from "zod";
import { address, type Address } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { rateLimited } from "@/lib/auth-guard";
import { buildRevokeIxs, readDelegation } from "@/lib/subscriptions";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { buildUserTransaction, sendPosted, waitConfirmed, settleUnconfirmed, STILL_WAITING } from "@/lib/user-tx";
import { SUBSCRIPTIONS_PROGRAM } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ signedTransaction: z.string() });

function parseWallet(raw: string): Address | null {
  try {
    return address(raw);
  } catch {
    return null;
  }
}

/**
 * The full revoke for a trading wallet to sign (the delegation and the USDC authority), no session needed: the wallet's own
 * signature is the proof. An unknown or already revoked wallet answers 200 with no transaction, so the route is not an oracle [A22].
 */
export async function GET(request: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet: raw } = await ctx.params;
  const wallet = parseWallet(raw);
  if (!wallet) return NextResponse.json({ error: "That does not look like a Solana address." }, { status: 400 });
  if (rateLimited(`revoke:${wallet}`)) return NextResponse.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  const row = await (await getRepo()).getWallet(wallet);
  if (!row || row.status === "revoked") return NextResponse.json({ transaction: null });
  const transaction = await buildUserTransaction(wallet, await buildRevokeIxs({ delegator: wallet, delegationPda: address(row.delegationPda) }));
  return NextResponse.json({ transaction });
}

/** Sends the revoke the wallet signed [A3]; once the delegation is gone from the chain, the wallet is marked revoked. */
export async function POST(request: Request, ctx: { params: Promise<{ wallet: string }> }) {
  const { wallet: raw } = await ctx.params;
  const wallet = parseWallet(raw);
  if (!wallet) return NextResponse.json({ error: "That does not look like a Solana address." }, { status: 400 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const row = await repo.getWallet(wallet);
  if (!row || row.status === "revoked") return NextResponse.json({ error: "Nothing to revoke." }, { status: 409 });

  let posted;
  try {
    posted = verifyPostedTransaction({ base64: parsed.data.signedTransaction, feePayer: wallet, programs: [SUBSCRIPTIONS_PROGRAM] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const pda = address(row.delegationPda);
  if (!posted.instructions.some((ix) => ix.accounts.includes(pda))) return NextResponse.json({ error: "This revoke is for another delegation." }, { status: 400 });
  let status;
  try {
    await sendPosted(posted.wire);
    status = await waitConfirmed(posted.signature);
  } catch {
    status = await waitConfirmed(posted.signature, 3); // review I3
  }
  const settled = status === "pending" ? await settleUnconfirmed(posted) : status;   // item 8
  if (settled !== "confirmed") return NextResponse.json({ error: settled === "failed" ? "The revoke failed on chain." : settled === "expired" ? "It did not go through. Nothing changed. Try again." : STILL_WAITING.revoke }, { status: 409 });
  let d = await readDelegation(pda);
  for (let i = 0; i < 3 && d.exists; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    d = await readDelegation(pda);
  }
  if (d.exists) return NextResponse.json({ error: "The chain still shows the delegation. Check again in a minute." }, { status: 409 });
  await repo.setWalletStatus(wallet, "revoked");
  await repo.addEvent({ userPubkey: row.userPubkey, walletPubkey: wallet, kind: "revoke_seen", detail: { signature: posted.signature, by: "user" } });
  return NextResponse.json({ revoked: true });
}
