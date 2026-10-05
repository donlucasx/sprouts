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
import { finishMove, latestMoveBuild, moveBuiltDetail, recentMoveBuilds, type MoveCarry } from "@/lib/moves";
import { KLEND_PROGRAM, JLEND_PROGRAM } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 60;
const Body = z.object({ id: z.string().min(1), signedTransactions: z.array(z.string()).length(2) });
const PROGRAMS = [KLEND_PROGRAM, JLEND_PROGRAM, ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS];
// Review minor 3: Home, not Activity: the open card (with its stored signatures) is what shows a move in flight.
const MAY_STILL = "It may still go through. Check Home in a minute before you try again.";
/** Fix round 1: 12 x 1.5 s per transaction, so two polls plus the sends and RPC reads fit the 60 s function limit. */
const POLL_TRIES = 12;
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
    status = await waitConfirmed(posted.signature, POLL_TRIES);
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
  // Review minor 4: any recent build of this move (each is the server's own amounts), newest first; none recent, the newest one.
  const recent = await recentMoveBuilds(repo, user.seedVaultPubkey, p.id, new Date());
  const latest = recent[0] ?? (await latestMoveBuild(repo, user.seedVaultPubkey, p.id));
  if (!latest) return NextResponse.json({ error: "Build this move first." }, { status: 409 });
  const candidates = recent.length ? recent : [latest];
  const owner = userAddress(user.seedVaultPubkey);
  let redeem: PostedTx;
  let deposit: PostedTx;
  try {
    redeem = verifyPostedTransaction({ base64: parsed.data.signedTransactions[0], feePayer: owner, programs: PROGRAMS });
    deposit = verifyPostedTransaction({ base64: parsed.data.signedTransactions[1], feePayer: owner, programs: PROGRAMS });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  let built: MoveCarry | null = null;
  for (const c of candidates) {
    const parts = { user: owner, asset: c.asset, from: c.from, to: c.to, receiptRaw: c.receiptRaw, depositRaw: c.depositRaw };
    if (matches(redeem, await buildMove({ ...parts, part: "redeem" })) && matches(deposit, await buildMove({ ...parts, part: "deposit" }))) { built = c; break; }
  }
  if (!built) return NextResponse.json({ error: "That move is not the one Sprouts built. Try the move again." }, { status: 400 });
  // An older build matched: record it again as the newest, so the carry reads the amounts that are about to be sent.
  if (built !== latest) await repo.addEvent({ userPubkey: user.seedVaultPubkey, walletPubkey: null, kind: "move_built", detail: moveBuiltDetail(built) });

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
  // Fix round 1 (review I1): both signatures are stored BEFORE the deposit goes out, so a deposit that settles after this function
  // (pending, or the function limit) is settled by the cron's proposeMoves: done with the carry, or failed; never expired.
  await repo.setMoveProposalStatus(p.id, "open", { redeem: redeem.signature, deposit: deposit.signature });

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
  await finishMove(repo, p, { redeem: redeem.signature, deposit: deposit.signature }, built.receiptRaw);
  return NextResponse.json(json({ move: { id: p.id, status: "done", redeemSignature: redeem.signature, depositSignature: deposit.signature } }));
}
