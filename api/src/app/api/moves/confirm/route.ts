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
import { failMove, finishMove, latestMoveBuild, moveBuiltDetail, recentMoveBuilds, type MoveCarry } from "@/lib/moves";
import type { Repo } from "@/db/repo";
import type { MoveProposalRow } from "@/db/types";
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

const done = (p: MoveProposalRow) => NextResponse.json({ move: { id: p.id, status: "done", redeemSignature: p.redeemSignature, depositSignature: p.depositSignature } });
const coinOf = (p: MoveProposalRow) => (p.asset === "USDC_LEND" ? "USDC" : "SOL");

/** The partial outcome (the redeem landed, the deposit did not): said plainly; SOL also gets the one-instruction unwrap back. */
async function partial(p: MoveProposalRow, owner: ReturnType<typeof userAddress>) {
  // SOL: the redeemed SOL sits in the user's WSOL account (the deposit's closing CloseAccount reverted with it). Hand back the
  // one-instruction unwrap so it comes back as plain SOL; any later SOL withdraw or move closes the same account too.
  let unwrapTransaction: string | undefined;
  if (p.asset === "SOL_LEND") {
    try { unwrapTransaction = await buildUserTransaction(owner, await buildUnwrapWsol({ user: owner })); } catch { unwrapTransaction = undefined; }
  }
  return NextResponse.json({ error: `Your ${coinOf(p)} is back in your wallet; the move did not finish.`, partial: true, ...(unwrapTransaction ? { unwrapTransaction } : {}) }, { status: 409 });
}

/** A compare-and-set lost (C-I2: the cron's settle, a second confirm): read the card again and answer from the winner's state, never a 500. */
async function fromState(repo: Repo, id: string, owner: ReturnType<typeof userAddress>) {
  const now = await repo.getMoveProposal(id);
  if (now?.status === "done") return done(now);
  if (now?.status === "failed" && now.redeemSignature) return partial(now, owner);
  if (now?.status === "open" && now.redeemSignature) return NextResponse.json({ error: MAY_STILL }, { status: 409 });
  return NextResponse.json({ error: "This move is no longer open." }, { status: 409 });
}

/**
 * Contracts 5.4: `[redeem, deposit]` signed in one session. Each is checked against the transaction the server rebuilds from ITS
 * OWN amounts for this move (the newest `move_built`), never from an amount in the posted bytes. Both signatures are stored (a
 * compare-and-set on an open card with none) BEFORE the redeem is sent, so the cron can always settle what went out; the redeem must
 * confirm before the deposit is sent. A card in flight takes only the very pair it stored (a retry after a lost answer). A landed
 * redeem with a deposit that can no longer land is the partial outcome, said plainly.
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
  const owner = userAddress(user.seedVaultPubkey);
  if (p.status !== "open") return fromState(repo, p.id, owner);
  // Review minor 4: any recent build of this move (each is the server's own amounts), newest first; none recent, the newest one.
  const recent = await recentMoveBuilds(repo, user.seedVaultPubkey, p.id, new Date());
  // In flight: the build the stored pair was pinned to is a candidate too, however old.
  const pinned = p.redeemSignature ? await latestMoveBuild(repo, user.seedVaultPubkey, p.id, p.redeemSignature) : null;
  const latest = recent[0] ?? pinned ?? (await latestMoveBuild(repo, user.seedVaultPubkey, p.id));
  if (!latest) return NextResponse.json({ error: "Build this move first." }, { status: 409 });
  const candidates = [...(recent.length ? recent : [latest]), ...(pinned ? [pinned] : [])];
  let redeem: PostedTx;
  let deposit: PostedTx;
  try {
    redeem = verifyPostedTransaction({ base64: parsed.data.signedTransactions[0], feePayer: owner, programs: PROGRAMS });
    deposit = verifyPostedTransaction({ base64: parsed.data.signedTransactions[1], feePayer: owner, programs: PROGRAMS });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const samePair = (c: MoveProposalRow) => c.redeemSignature === redeem.signature && c.depositSignature === deposit.signature;
  // In flight (K-I2): only the stored pair goes on (the same signatures: the chain sends each at most once); any other pair would be
  // a second redeem under one card, so it is refused before anything is checked or sent.
  if (p.redeemSignature && !samePair(p)) return NextResponse.json({ error: MAY_STILL }, { status: 409 });
  let built: MoveCarry | null = null;
  for (const c of candidates) {
    const parts = { user: owner, asset: c.asset, from: c.from, to: c.to, receiptRaw: c.receiptRaw, depositRaw: c.depositRaw };
    if (matches(redeem, await buildMove({ ...parts, part: "redeem" })) && matches(deposit, await buildMove({ ...parts, part: "deposit" }))) { built = c; break; }
  }
  if (!built) return NextResponse.json({ error: "That move is not the one Sprouts built. Try the move again." }, { status: 400 });

  if (!p.redeemSignature) {
    // C-I2 1 + 2: both signatures BEFORE the redeem goes out, and only onto an open card that has none (never over a stored one).
    if (!(await repo.storeMoveSignatures(p.id, { redeem: redeem.signature, deposit: deposit.signature }))) {
      const now = await repo.getMoveProposal(p.id);
      if (!(now?.status === "open" && samePair(now))) return fromState(repo, p.id, owner);
    }
    // The build these signatures belong to, pinned to the redeem signature: the carry reads it, whatever is built after.
    await repo.addEvent({ userPubkey: user.seedVaultPubkey, walletPubkey: null, kind: "move_built", detail: moveBuiltDetail({ ...built, redeemSignature: redeem.signature }) });
  }
  const card: MoveProposalRow = { ...p, redeemSignature: redeem.signature, depositSignature: deposit.signature };

  let redeemStatus;
  try {
    redeemStatus = await land(redeem);
  } catch (e) {
    console.error(`moves confirm: the redeem send failed for ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: MAY_STILL }, { status: 409 });
  }
  if (redeemStatus === "failed" || redeemStatus === "expired") {
    // Nothing moved: the card is an ordinary open card again (retry, Not now, or the cron's expiry all work as before).
    await repo.clearMoveSignatures(p.id, redeem.signature);
    return NextResponse.json({ error: redeemStatus === "failed" ? "The move failed on chain. Nothing moved." : "It did not go through. Nothing moved. Try again." }, { status: 409 });
  }
  if (redeemStatus !== "confirmed") return NextResponse.json({ error: MAY_STILL }, { status: 409 });

  let depositStatus;
  try {
    depositStatus = await land(deposit);
  } catch (e) {
    console.error(`moves confirm: redeem ${redeem.signature} CONFIRMED; the deposit send failed for ${p.id}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: MAY_STILL }, { status: 409 });
  }
  if (depositStatus === "pending") return NextResponse.json({ error: MAY_STILL }, { status: 409 });
  if (depositStatus !== "confirmed") {
    if (!(await failMove(repo, card))) return fromState(repo, p.id, owner);
    return partial(card, owner);
  }
  if (!(await finishMove(repo, card, built.receiptRaw))) return fromState(repo, p.id, owner);
  return NextResponse.json(json({ move: { id: p.id, status: "done", redeemSignature: redeem.signature, depositSignature: deposit.signature } }));
}
