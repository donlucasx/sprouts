import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { createNoopSigner } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { buildCancelUnstakeIx } from "@/lib/staking";
import { buildUserTransaction, userAddress } from "@/lib/user-tx";
import { withAppErrorLog } from "@/lib/failure-log";

export const runtime = "nodejs";

/** "Put it back": the cancel-unstake transaction for the Seed Vault to sign, while the basket is still ripening. */
async function postHandler(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  if (!(await repo.pendingWithdrawal(session.pubkey))) return apiError("basket_empty", { error: "Nothing in the basket." }, { status: 409 });
  const owner = userAddress(session.pubkey);
  const transaction = await buildUserTransaction(owner, [await buildCancelUnstakeIx({ user: createNoopSigner(owner) })]);
  return NextResponse.json({ transaction });
}
export const POST = withAppErrorLog("withdraw/cancel/build", postHandler);
