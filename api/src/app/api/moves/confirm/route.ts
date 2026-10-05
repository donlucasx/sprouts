import { NextResponse } from "next/server";
import { z } from "zod";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { Instruction } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { verifyPostedTransaction, type PostedTx } from "@/lib/verify-tx";
import { buildUserTransaction, sendPosted, waitConfirmed, settleUnconfirmed, userAddress } from "@/lib/user-tx";
import { json } from "@/lib/json";
import { buildMove, buildUnwrapWsol } from "@/lib/venues/user-builders";
import { latestMoveBuild, moveDetail } from "@/lib/moves";
import { KLEND_PROGRAM, JLEND_PROGRAM } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 60;
const Body = z.object({ id: z.string().min(1), signedTransactions: z.array(z.string()).length(2) });
const PROGRAMS = [KLEND_PROGRAM, JLEND_PROGRAM, ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS];
const MAY_STILL = "It may still go through. Check Activity in a minute before you try again.";
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The posted transaction carries exactly the instructions the server builds (program, data, every account, in order). */
function matches(posted: PostedTx, expected: Instruction[]): boolean {
  const want = expected.map((ix) => ({ program: ix.programAddress as string, data: Buffer.from(ix.data ?? []).toString("hex"), accounts: (ix.accounts ?? []).map((x) => x.address as string) }));
  const got = posted.instructions.map((ix) => ({ program: ix.program as string, data: Buffer.from(ix.data).toString("hex"), accounts: ix.accounts as string[] }));
  return want.length === got.length && want.every((w, i) => w.program === got[i].program && w.data === got[i].data && same(w.accounts, got[i].accounts));
}

/** Send, then poll; a send that throws may still have gone out, so its signature is asked a few more times; "pending" settles by blockhash. */
async function land(posted: PostedTx): Promise<"confirmed" | "failed" | "pending" | "expired"> {
  let status;
  try {
    await sendPosted(posted.wire);
    status = await waitConfirmed(posted.signature);
  } catch {
    status = await waitConfirmed(posted.signature, 3);
  }
  return status === "pending" ? settleUnconfirmed(posted) : status;
}

/**
 * Contracts 5.4: `[redeem, deposit]` signed in one session. Each is checked against the transaction the server rebuilds from ITS
 * OWN amounts for this move (the newest `move_built`), never from an amount in the posted bytes; the redeem is sent first and must
 * confirm before the deposit is sent. A landed redeem with a deposit that can no longer land is the partial outcome, said plainly.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const p = await repo.getMoveProposal(parsed.data.id);
  if (!p || p.userPubkey !== user.seedVaultPubkey) return NextResponse.json({ error: "No such move." }, { status: 404 });
  if (p.status === "done") return NextResponse.json({ move: { id: p.id, status: "done", redeemSignature: p.redeemSignature, depositSignature: p.depositSignature } });
  if (p.status !== "open") return NextResponse.json({ error: "This move is no longer open." }, { status: 409 });
  const built = await latestMoveBuild(repo, user.seedVaultPubkey, p.id);
  if (!built) return NextResponse.json({ error: "Build this move first." }, { status: 409 });
  const owner = userAddress(user.seedVaultPubkey);
  let redeem: PostedTx;
  let deposit: PostedTx;
  try {
    redeem = verifyPostedTransaction({ base64: parsed.data.signedTransactions[0], feePayer: owner, programs: PROGRAMS });
    deposit = verifyPostedTransaction({ base64: parsed.data.signedTransactions[1], feePayer: owner, programs: PROGRAMS });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const parts = { user: owner, asset: built.asset, from: built.from, to: built.to, receiptRaw: built.receiptRaw, depositRaw: built.depositRaw };
  if (!matches(redeem, await buildMove({ ...parts, part: "redeem" })) || !matches(deposit, await buildMove({ ...parts, part: "deposit" })))
    return NextResponse.json({ error: "That move is not the one Sprouts built." }, { status: 400 });

  const coin = p.asset === "USDC_LEND" ? "USDC" : "SOL";
  let redeemStatus;
  try {
    redeemStatus = await land(redeem);
  } catch (e) {
    console.error(`moves confirm: the redeem send failed for ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: MAY_STILL }, { status: 409 });
  }
  if (redeemStatus !== "confirmed")
    return NextResponse.json({ error: redeemStatus === "failed" ? "The move failed on chain. Nothing moved." : redeemStatus === "expired" ? "It did not go through. Nothing moved. Try again." : MAY_STILL }, { status: 409 });
  await repo.setMoveProposalStatus(p.id, "open", { redeem: redeem.signature });

  let depositStatus;
  try {
    depositStatus = await land(deposit);
  } catch (e) {
    console.error(`moves confirm: redeem ${redeem.signature} CONFIRMED; the deposit send failed for ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: MAY_STILL }, { status: 409 });
  }
  if (depositStatus === "pending") return NextResponse.json({ error: MAY_STILL }, { status: 409 });
  if (depositStatus !== "confirmed") {
    await repo.setMoveProposalStatus(p.id, "failed", { redeem: redeem.signature });
    // SOL: the redeemed SOL sits in the user's WSOL account (the deposit's closing CloseAccount reverted with it). Hand back the
    // one-instruction unwrap so it comes back as plain SOL; any later SOL withdraw or move closes the same account too.
    let unwrapTransaction: string | undefined;
    if (p.asset === "SOL_LEND") {
      try { unwrapTransaction = await buildUserTransaction(owner, await buildUnwrapWsol({ user: owner })); } catch { unwrapTransaction = undefined; }
    }
    return NextResponse.json({ error: `Your ${coin} is back in your wallet; the move did not finish.`, partial: true, ...(unwrapTransaction ? { unwrapTransaction } : {}) }, { status: 409 });
  }
  await repo.setMoveProposalStatus(p.id, "done", { redeem: redeem.signature, deposit: deposit.signature });
  try {
    await repo.addEvent({ userPubkey: user.seedVaultPubkey, walletPubkey: null, kind: "move_done", detail: moveDetail({ ...p, receiptRaw: built.receiptRaw }, "done") });
  } catch (e) {
    console.error(`moves confirm: CONFIRMED ${p.id} but the move_done event was not written for ${user.seedVaultPubkey}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return NextResponse.json(json({ move: { id: p.id, status: "done", redeemSignature: redeem.signature, depositSignature: deposit.signature } }));
}
