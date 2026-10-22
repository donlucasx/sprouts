import { NextResponse } from "next/server";
import { z } from "zod";
import { address, type Base64EncodedWireTransaction } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { requireSession } from "@/lib/auth-guard";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { settleUnconfirmed, waitConfirmed } from "@/lib/user-tx";
import { checkTopUp, COMPUTE_BUDGET, topUpAccounts, TOPUP_CONFIRM } from "@/lib/topup";
import { JUPITER_AGGREGATOR } from "@/lib/jupiter";
import { SYSTEM_PROGRAM } from "@/lib/constants";
import { rpc } from "@/lib/rpc";

export const runtime = "nodejs";
export const maxDuration = 60; // the send plus the confirm poll (up to 30 s)
const Body = z.object({ signedTransaction: z.string() });

/**
 * Sends the top-up the wallet signed: only the session wallet's own transaction, and only a top-up (the build's check again, on what
 * was signed: SOL to the wallet's own USDC account, nothing else). Then waits for it: 200 { status: "confirmed", usdcRaw }; a failure
 * the chain reports is 400; a blockhash that expired unlanded is 409 (nothing moved); still unknown is 202 { status: "pending" }.
 */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const me = address(session.pubkey);
  let posted;
  let plan;
  try {
    posted = verifyPostedTransaction({
      base64: parsed.data.signedTransaction, feePayer: me,
      programs: [address(JUPITER_AGGREGATOR), SYSTEM_PROGRAM, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS, address(COMPUTE_BUDGET)],
    });
    plan = checkTopUp(posted.instructions.map((ix) => ({ program: ix.program, accounts: ix.accounts, data: ix.data })), { user: me, ...(await topUpAccounts(me)) });
  } catch (e) {
    console.error(`/api/topup/confirm: refused for ${me}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: TOPUP_CONFIRM.notTopUp }, { status: 400 });
  }
  try {
    await rpc().sendTransaction(posted.wire as Base64EncodedWireTransaction, { encoding: "base64", preflightCommitment: "confirmed" }).send();
  } catch (e) {
    // A lost answer is not a lost send: the signature's status below decides.
    console.error(`/api/topup/confirm: send answered with an error for ${me}: ${e instanceof Error ? e.message : String(e)}`);
  }
  let status: "confirmed" | "failed" | "pending" | "expired" = await waitConfirmed(posted.signature);
  if (status === "pending") status = await settleUnconfirmed(posted);
  if (status === "confirmed") return NextResponse.json({ status, signature: posted.signature, usdcRaw: plan.outRaw.toString() });
  if (status === "failed") return NextResponse.json({ error: TOPUP_CONFIRM.failed }, { status: 400 });
  if (status === "expired") return NextResponse.json({ error: TOPUP_CONFIRM.expired }, { status: 409 });
  return NextResponse.json({ status, signature: posted.signature, message: TOPUP_CONFIRM.pending }, { status: 202 });
}
