import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { readPosition, userStakePda } from "@/lib/staking";
import { CANCEL_UNSTAKE_DISCRIMINATOR } from "@/generated/staking";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { sendPosted, waitConfirmed, userAddress } from "@/lib/user-tx";
import { SKR_STAKING_PROGRAM } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ signedTransaction: z.string() });
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Sends the cancel-unstake the Seed Vault signed; once the chain shows nothing unstaking, the basket row is closed as cancelled. */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
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
  if (status !== "confirmed") return NextResponse.json({ error: status === "failed" ? "The cancel failed on chain. The basket stands." : "The chain has not confirmed the cancel yet. Check again in a minute." }, { status: 409 });
  let after = await readPosition(owner);
  for (let i = 0; i < 3 && after.unstakingRaw !== 0n; i++) {
    await new Promise((r) => setTimeout(r, 1_000));
    after = await readPosition(owner);
  }
  if (after.unstakingRaw !== 0n) return NextResponse.json({ error: "The chain still shows the basket. Check again in a minute." }, { status: 409 });
  await repo.setWithdrawalCancelled(pending.id, posted.signature);
  return NextResponse.json({ cancelled: true });
}
