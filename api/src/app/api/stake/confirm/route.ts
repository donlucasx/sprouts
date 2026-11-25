import { langOf, lineText } from "@/lib/i18n";
import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { z } from "zod";
import { address, type Base64EncodedWireTransaction } from "@solana/kit";
import { forgetOwnerReads } from "@/lib/memo";
import { requireSession } from "@/lib/auth-guard";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { settleUnconfirmed, waitConfirmed } from "@/lib/user-tx";
import { COMPUTE_BUDGET } from "@/lib/topup";
import { SKR_STAKING_PROGRAM } from "@/lib/constants";
import { readPosition, sharePrice } from "@/lib/staking";
import { rpc } from "@/lib/rpc";
import { isHttp429 } from "@/lib/http429";
import { getRepo } from "@/db/repo";
import { withAppErrorLog } from "@/lib/failure-log";
import { bookPlantedStake, checkPlantSkr, markPlantSent, PLANT_CONFIRM, PLANT_COPY, plantRecorded, plantSkrAccounts, recordPlanted, stakePlantOff } from "@/lib/plant-skr";

export const runtime = "nodejs";
export const maxDuration = 60;
const Body = z.object({ signedTransaction: z.string() });
/** As topup/confirm (11-25, Kimi hotfix #6): the send retries and the poll together end by here, inside maxDuration. */
const CONFIRM_DEADLINE_MS = 45_000;
const SEND_RETRIES_ON_429 = 2;

/**
 * 0.1.13 Plant my SKR: sends the stake the wallet signed, only the session wallet's own and only the build's shape (checkPlantSkr on
 * what was signed). 503 while STAKE_PLANT_OFF=1 (Kimi #3: the switch stops the send). Marked before the send (skr_plant_sent); then the
 * top-up's 429 handling. 200 { status: "confirmed", amountRaw }: the Activity row (skr_planted) and the put in (an own_stake adjustment,
 * as reconcile books it, Kimi #2) are written once per signature (Kimi #5; a retry of the same signed transaction answers 200 again and
 * writes nothing). A failure the chain reports is 400; an expired blockhash 409 (nothing moved); still unknown 202 { status: "pending" }.
 */
async function postHandler(request: Request) {
  const lang = langOf(request);
  if (stakePlantOff()) return apiError("plant_off", { error: PLANT_COPY.off }, { status: 503 }, lang);
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  forgetOwnerReads(session.pubkey);
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("bad_request", { error: "Bad request." }, { status: 400 }, lang);
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return apiError("sign_in_first", { error: "Sign in first." }, { status: 401 }, lang);
  const me = address(user.seedVaultPubkey);
  let posted;
  let amountRaw: bigint;
  try {
    posted = verifyPostedTransaction({ base64: parsed.data.signedTransaction, feePayer: me, programs: [SKR_STAKING_PROGRAM, address(COMPUTE_BUDGET)] });
    ({ amountRaw } = checkPlantSkr(posted.instructions.map((ix) => ({ program: ix.program as string, accounts: ix.accounts as string[], data: ix.data })), { user: me, ...(await plantSkrAccounts(me)) }));
  } catch (e) {
    console.error(`/api/stake/confirm: refused for ${me}: ${e instanceof Error ? e.message : String(e)}`);
    return apiError("wrong_transaction", { error: PLANT_CONFIRM.notStake }, { status: 400 }, lang);
  }
  // Kimi #5: this very stake already landed and was recorded (a retry after a lost answer): the same answer, nothing sent or written again.
  if (await plantRecorded(repo, user.seedVaultPubkey, posted.signature)) {
    return NextResponse.json({ status: "confirmed", signature: posted.signature, amountRaw: amountRaw.toString() });
  }
  const mark = { user: user.seedVaultPubkey, signature: posted.signature, amountRaw: amountRaw.toString() };
  const sentAt = new Date();
  try {
    await markPlantSent(repo, mark);
  } catch (e) {
    console.error(`/api/stake/confirm: not marked, not sent, for ${me}: ${e instanceof Error ? e.message : String(e)}`);
    return apiError("wrong_transaction", { error: PLANT_CONFIRM.notMarked }, { status: 400 }, lang);
  }
  const deadlineMs = Date.now() + CONFIRM_DEADLINE_MS;
  const send = () => rpc().sendTransaction(posted.wire as Base64EncodedWireTransaction, { encoding: "base64", preflightCommitment: "confirmed" }).send().then(() => undefined);
  let sent = false;
  for (let attempt = 0; attempt <= SEND_RETRIES_ON_429 && !sent && Date.now() < deadlineMs; attempt++) {
    try {
      await send();
      sent = true;
    } catch (e) {
      // A lost answer is not a lost send: the signature's status below decides.
      console.error(`/api/stake/confirm: send answered with an error for ${me}: ${e instanceof Error ? e.message : String(e)}`);
      if (!isHttp429(e)) break;
      if (attempt < SEND_RETRIES_ON_429) await new Promise((r) => setTimeout(r, 1_500));
    }
  }
  let status: "confirmed" | "failed" | "pending" | "expired" = await waitConfirmed(posted.signature, 20, 1_500, { deadlineMs, ...(sent ? {} : { resend: send }) });
  if (status === "pending" && Date.now() < deadlineMs) status = await settleUnconfirmed(posted);
  forgetOwnerReads(session.pubkey);
  if (status === "confirmed") {
    // Kimi #2: the row first (its claim), then the put in, booked only by the signature's one row; any doubt leaves it to reconcile.
    if (await recordPlanted(repo, { ...mark, sentAt })) {
      await bookPlantedStake({ repo, user, amountRaw, chain: { readPosition: (u) => readPosition(address(u), "confirmed"), sharePrice } });
    }
    return NextResponse.json({ status, signature: posted.signature, amountRaw: amountRaw.toString() });
  }
  if (status === "failed") return apiError("tx_failed", { error: PLANT_CONFIRM.failed }, { status: 400 }, lang);
  if (status === "expired") return apiError("tx_expired", { error: PLANT_CONFIRM.expired }, { status: 409 }, lang);
  return NextResponse.json({ status, signature: posted.signature, message: lineText(PLANT_CONFIRM.pending, lang) }, { status: 202 });
}
export const POST = withAppErrorLog("stake/confirm", postHandler);
