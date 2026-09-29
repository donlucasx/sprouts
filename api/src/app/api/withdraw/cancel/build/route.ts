import { NextResponse } from "next/server";
import { createNoopSigner } from "@solana/kit";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { buildCancelUnstakeIx } from "@/lib/staking";
import { buildUserTransaction, userAddress } from "@/lib/user-tx";

export const runtime = "nodejs";

/** "Put it back": the cancel-unstake transaction for the Seed Vault to sign, while the basket is still ripening. */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  if (!(await repo.pendingWithdrawal(session.pubkey))) return NextResponse.json({ error: "Nothing in the basket." }, { status: 409 });
  const owner = userAddress(session.pubkey);
  const transaction = await buildUserTransaction(owner, [await buildCancelUnstakeIx({ user: createNoopSigner(owner) })]);
  return NextResponse.json({ transaction });
}
