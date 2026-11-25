import { NextResponse } from "next/server";
import { forgetOwnerReads } from "@/lib/memo";
import { z } from "zod";
import { address, type Base64EncodedWireTransaction } from "@solana/kit";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { requireSession } from "@/lib/auth-guard";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { settleUnconfirmed, waitConfirmed } from "@/lib/user-tx";
import { checkTopUp, COMPUTE_BUDGET, topUpAccounts, topUpCoinSymbol, topUpSourceAccounts, TOPUP_CONFIRM, type TopUpSourceAccounts } from "@/lib/topup";
import { JUPITER_AGGREGATOR } from "@/lib/jupiter";
import { SYSTEM_PROGRAM, WSOL_MINT } from "@/lib/constants";
import { rpc } from "@/lib/rpc";
import { isHttp429 } from "@/lib/http429";
import { getRepo } from "@/db/repo";
import { markTopUpSent, recordTopUpLanded } from "@/lib/topup-record";
import { withAppErrorLog } from "@/lib/failure-log";
import { takeSetupPrefix, TOPUP_SETUP_MAX } from "@/lib/user-setup";

export const runtime = "nodejs";
export const maxDuration = 60; // the send plus the confirm poll (up to 30 s)
const Body = z.object({ signedTransaction: z.string() });
/** 11-25 (Kimi hotfix #6): the send retries and the poll together end by here, so the route answers before maxDuration. */
const CONFIRM_DEADLINE_MS = 45_000;
const SEND_RETRIES_ON_429 = 2;

/**
 * Sends the top-up the wallet signed: only the session wallet's own transaction, and only a top-up (the build's check again, on what
 * was signed: SOL, or since Task 7 one of the wallet's own coins (the swap's fixed account 7, the source mint), to the wallet's own USDC
 * account, nothing else). Then waits for it: 200 { status: "confirmed", usdcRaw }; a failure
 * the chain reports is 400; a blockhash that expired unlanded is 409 (nothing moved); still unknown is 202 { status: "pending" }.
 */
async function postHandler(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  // 11-25 (load hotfix): this user's Home chain reads on this instance are read fresh after this write (memo.ts ownerCached).
  forgetOwnerReads(session.pubkey);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const me = address(session.pubkey);
  let posted;
  let plan;
  let source: TopUpSourceAccounts | undefined;
  let inputMint: string = WSOL_MINT;
  try {
    posted = verifyPostedTransaction({
      base64: parsed.data.signedTransaction, feePayer: me,
      programs: [address(JUPITER_AGGREGATOR), SYSTEM_PROGRAM, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS, address(COMPUTE_BUDGET)],
    });
    // The swap's source mint picks the rules: the wSOL mint (or no swap, refused by the SOL rules) is today's check; any other mint the
    // token check, its source accounts refused for USDC, a garden coin or a receipt (SKR allowed).
    // Task 17a (Kimi HIGH): the leading user-paid setup creates (at most 3, this wallet's own accounts for the 7 setup mints, paid by it)
    // are peeled off first, as the app does; the top-up check then reads the rest unchanged, so a setup create anywhere else is refused.
    const rest = await takeSetupPrefix(posted.instructions.map((ix) => ({ program: ix.program as string, accounts: ix.accounts as string[], data: ix.data })), me, TOPUP_SETUP_MAX);
    const mint = rest.find((ix) => ix.program === JUPITER_AGGREGATOR)?.accounts[7];
    if (mint !== undefined && mint !== WSOL_MINT) {
      source = await topUpSourceAccounts(me, address(mint));
      inputMint = mint;
    }
    plan = checkTopUp(rest, { user: me, ...(await topUpAccounts(me)), source });
  } catch (e) {
    console.error(`/api/topup/confirm: refused for ${me}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: TOPUP_CONFIRM.notTopUp }, { status: 400 });
  }
  // 10-27: marked BEFORE the send, so the swap booking can never round the top-up up; no mark, no send (Kimi F1: answered 400,
  // whose message the app shows as it is, so the user reads "nothing moved", never the "sent" line a 500 would map to).
  const repo = await getRepo();
  const sentAt = new Date();
  // 11-24: what paid, for Activity ("From SKR in this wallet"); a failed symbol lookup only leaves the coin unnamed.
  const coin = await topUpCoinSymbol(inputMint).catch(() => null);
  const mark = { user: session.pubkey, signature: posted.signature, usdcRaw: plan.outRaw.toString(), inputMint, coin };
  try {
    await markTopUpSent(repo, mark);
  } catch (e) {
    console.error(`/api/topup/confirm: not marked, not sent, for ${me}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: TOPUP_CONFIRM.notMarked }, { status: 400 });
  }
  // 11-25 (a $10 top-up was never broadcast: its send met Helius 429s past the transport's retries; Kimi hotfix #6-7): one deadline for
  // the whole answer, inside maxDuration 60; a send refused with 429 is tried twice more, then re-sent while the poll runs.
  const deadlineMs = Date.now() + CONFIRM_DEADLINE_MS;
  const send = () => rpc().sendTransaction(posted.wire as Base64EncodedWireTransaction, { encoding: "base64", preflightCommitment: "confirmed" }).send().then(() => undefined);
  let sent = false;
  for (let attempt = 0; attempt <= SEND_RETRIES_ON_429 && !sent && Date.now() < deadlineMs; attempt++) {
    try {
      await send();
      sent = true;
    } catch (e) {
      // A lost answer is not a lost send: the signature's status below decides.
      console.error(`/api/topup/confirm: send answered with an error for ${me}: ${e instanceof Error ? e.message : String(e)}`);
      if (!isHttp429(e)) break;
      if (attempt < SEND_RETRIES_ON_429) await new Promise((r) => setTimeout(r, 1_500));
    }
  }
  let status: "confirmed" | "failed" | "pending" | "expired" = await waitConfirmed(posted.signature, 20, 1_500, { deadlineMs, ...(sent ? {} : { resend: send }) });
  if (status === "pending" && Date.now() < deadlineMs) status = await settleUnconfirmed(posted);
  forgetOwnerReads(session.pubkey);
  if (status === "confirmed") {
    await recordTopUpLanded(repo, { ...mark, sentAt });
    return NextResponse.json({ status, signature: posted.signature, usdcRaw: plan.outRaw.toString() });
  }
  if (status === "failed") return NextResponse.json({ error: source ? TOPUP_CONFIRM.failedToken : TOPUP_CONFIRM.failed }, { status: 400 });
  if (status === "expired") return NextResponse.json({ error: TOPUP_CONFIRM.expired }, { status: 409 });
  return NextResponse.json({ status, signature: posted.signature, message: TOPUP_CONFIRM.pending }, { status: 202 });
}
export const POST = withAppErrorLog("topup/confirm", postHandler);
