import { NextResponse } from "next/server";
import { z } from "zod";
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";
import { verifyPostedTransaction } from "@/lib/verify-tx";
import { sendPosted, waitConfirmed, settleUnconfirmed, userAddress, STILL_WAITING } from "@/lib/user-tx";
import { json } from "@/lib/json";
import { receiptBalanceRaw } from "@/lib/holdings";
import { klendRate } from "@/lib/venues/klend";
import { jlendRate } from "@/lib/venues/jlend";
import { buildLendWithdraw } from "@/lib/venues/user-builders";
import { KLEND_PROGRAM, JLEND_PROGRAM } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 60;
const Body = z.object({ signedTransaction: z.string(), asset: z.enum(["USDC_LEND", "SOL_LEND"]), venue: z.enum(["kamino_klend", "jupiter_lend"]) });
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Contracts 5.3: only the redeem the API would build for this user (rebuilt with the posted amount and compared byte for byte) is sent. */
export async function POST(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { asset, venue } = parsed.data;
  const owner = userAddress(user.seedVaultPubkey);
  const program = venue === "kamino_klend" ? KLEND_PROGRAM : JLEND_PROGRAM;
  let posted;
  try {
    posted = verifyPostedTransaction({ base64: parsed.data.signedTransaction, feePayer: owner, programs: [program, ASSOCIATED_TOKEN_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  // A replayed confirm (same signature) answers with the record already written and books nothing twice.
  const prior = (await repo.listEvents(user.seedVaultPubkey, ["lend_withdrawn"], 200)).find((e) => (e.detail as { signature?: string } | null)?.signature === posted.signature);
  if (prior) return NextResponse.json(json({ withdrawn: prior.detail }));
  const redeem = posted.instructions.filter((ix) => ix.program === program).at(-1);
  if (!redeem || redeem.data.length !== 16) return NextResponse.json({ error: "That is not a withdrawal." }, { status: 400 });
  const receiptRaw = Buffer.from(redeem.data).readBigUInt64LE(8);
  if (receiptRaw === 0n || receiptRaw > (await receiptBalanceRaw(owner, asset, venue))) return NextResponse.json({ error: "That withdrawal is larger than your position." }, { status: 400 });
  const expected = await buildLendWithdraw({ user: owner, asset, venue, receiptRaw });
  const want = expected.map((ix) => ({ program: ix.programAddress as string, data: Buffer.from(ix.data ?? []).toString("hex"), accounts: (ix.accounts ?? []).map((x) => x.address as string) }));
  const got = posted.instructions.map((ix) => ({ program: ix.program as string, data: Buffer.from(ix.data).toString("hex"), accounts: ix.accounts as string[] }));
  if (want.length !== got.length || want.some((w, i) => w.program !== got[i].program || w.data !== got[i].data || !same(w.accounts, got[i].accounts))) return NextResponse.json({ error: "That withdrawal is not the one Sprouts built." }, { status: 400 });
  try {
    let status;
    try {
      await sendPosted(posted.wire);
      status = await waitConfirmed(posted.signature);
    } catch {
      status = await waitConfirmed(posted.signature, 3);
    }
    const settled = status === "pending" ? await settleUnconfirmed(posted) : status;
    if (settled !== "confirmed") return NextResponse.json({ error: settled === "failed" ? "The withdrawal failed on chain. Nothing moved." : settled === "expired" ? "It did not go through. Nothing moved. Try again." : STILL_WAITING.withdraw }, { status: 409 });
  } catch (e) {
    // The send may have gone out: whatever threw while sending or confirming, the answer is the "may still go through" one, never a bare 500.
    console.error(`lend withdraw confirm: failed during the send for ${user.seedVaultPubkey}: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: STILL_WAITING.withdraw }, { status: 409 });
  }
  // What came back in the underlying's units: the redeemed receipt at the venue's rate now [estimate: for SOL the WSOL account is created
  // and closed in the same tx, so the delivery is not in its token balances]. The money already moved: a failed rate read records null
  // (contracts 5.7: the app shows the line without an amount), never a 500 that skips the event.
  let underlyingRaw: bigint | null = null;
  try {
    const r = venue === "kamino_klend" ? await klendRate(asset) : await jlendRate(asset);
    underlyingRaw = (receiptRaw * r.rn) / r.rd;
  } catch {
    underlyingRaw = null;
  }
  const withdrawn = { asset, venue, receiptRaw: receiptRaw.toString(), underlyingRaw: underlyingRaw === null ? null : underlyingRaw.toString(), signature: posted.signature };
  // Confirmed: the money moved. A failed record write is logged, never told to the user as "may still go through".
  try {
    await repo.addEvent({ userPubkey: user.seedVaultPubkey, walletPubkey: null, kind: "lend_withdrawn", detail: withdrawn });
  } catch (e) {
    console.error(`lend withdraw confirm: CONFIRMED ${posted.signature} but the lend_withdrawn event was not written for ${user.seedVaultPubkey}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return NextResponse.json(json({ withdrawn }));
}
