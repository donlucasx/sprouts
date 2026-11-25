import { NextResponse } from "next/server";
import { forgetOwnerReads } from "@/lib/memo";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { readPosition, userStakePda } from "@/lib/staking";
import { CANCEL_UNSTAKE_DISCRIMINATOR } from "@/generated/staking";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { sendPosted, waitConfirmed, settleUnconfirmed, STILL_WAITING, userAddress } from "@/lib/user-tx";
import { SKR_STAKING_PROGRAM } from "@/lib/constants";
import { withAppErrorLog } from "@/lib/failure-log";
import { alertFounder } from "@/lib/founder-alert";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ signedTransaction: z.string() });
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Sends the cancel-unstake the Seed Vault signed; once the chain shows nothing unstaking, the basket row is closed as cancelled. */
async function postHandler(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  // 11-25 (load hotfix): this user's Home chain reads on this instance are read fresh after this write (memo.ts ownerCached).
  forgetOwnerReads(session.pubkey);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const pending = await repo.pendingWithdrawal(session.pubkey);
  if (!pending) return NextResponse.json({ error: "Nothing in the basket." }, { status: 409 });

  const owner = userAddress(session.pubkey);
  let posted;
  try {
    posted = verifyPostedTransaction({ base64: parsed.data.signedTransaction, feePayer: owner, programs: [SKR_STAKING_PROGRAM] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const ix = posted.instructions[0];
  if (posted.instructions.length !== 1 || !same(ix.data.slice(0, 8), CANCEL_UNSTAKE_DISCRIMINATOR)) return NextResponse.json({ error: "That is not a cancel." }, { status: 400 });
  if (!ix.accounts.includes(await userStakePda(owner))) return NextResponse.json({ error: "That cancel is for another position." }, { status: 400 });

  let status;
  try {
    await sendPosted(posted.wire);
    status = await waitConfirmed(posted.signature);
  } catch {
    status = await waitConfirmed(posted.signature, 3); // review I3: the send's answer was lost, the chain decides
  }
  const settled = status === "pending" ? await settleUnconfirmed(posted) : status;   // item 8
  if (settled !== "confirmed") return NextResponse.json({ error: settled === "failed" ? "The cancel failed on chain. The basket stands." : settled === "expired" ? "It did not go through. Your SKR is still in the basket. Try again." : STILL_WAITING.cancel }, { status: 409 });
  let after = await readPosition(owner);
  for (let i = 0; i < 3 && after.unstakingRaw !== 0n; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    after = await readPosition(owner);
  }
  if (after.unstakingRaw !== 0n) return NextResponse.json({ error: "The chain still shows the basket. Check again in a minute." }, { status: 409 });
  // 11-14 (ops #6): the row may have closed while the cancel was in flight (the crank closes a superseded row): never overwrite it.
  // The cancel did land (nothing unstaking on chain), so the user hears it worked; the founder checks the bookkeeping.
  if (!(await repo.setWithdrawalCancelled(pending.id, posted.signature))) {
    const row = pending.id.slice(0, 8), sig = posted.signature.slice(0, 8);
    console.error(`withdraw/cancel/confirm: cancel ${posted.signature} landed but row ${pending.id} was already closed; not booked`);
    await alertFounder({ channel: "ops", title: "Cancel landed on an already-closed withdrawal", text: `Row ${row}… was already closed; cancel ${sig}… landed on chain and is not on any row`, todo: "Check that row; book the cancel by hand if the basket should show as put back" }).catch(() => {});
  }
  return NextResponse.json({ cancelled: true });
}
export const POST = withAppErrorLog("withdraw/cancel/confirm", postHandler);
