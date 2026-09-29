import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import { requireSession } from "@/lib/auth-guard";

export const runtime = "nodejs";

const LIMIT = 50;
const str = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

/** The recent swaps, plantings and withdrawals of the signed-in Seeker, newest first, for the Activity list. */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  const [swaps, plantings, withdrawals] = await Promise.all([
    repo.listSwaps(session.pubkey, LIMIT), repo.listPlantings(session.pubkey, LIMIT), repo.listWithdrawals(session.pubkey, LIMIT),
  ]);
  const legs = await Promise.all(plantings.map((p) => repo.plantingLegs(p.id)));
  return NextResponse.json(str({
    swaps: swaps.map((s) => ({ signature: s.signature, ts: s.ts, walletPubkey: s.walletPubkey, usdSizeCents: s.usdSizeCents, class: s.class, roundupCents: s.roundupCents, plantingId: s.plantingId })),
    plantings: plantings.map((p, i) => ({
      id: p.id, ts: p.ts, status: p.status, signature: p.signature, usdcPulledCents: p.usdcPulledCents, networkFeeCents: p.networkFeeCents,
      legs: legs[i].map((l) => ({ asset: l.asset, usdcInCents: l.usdcInCents, amountOutRaw: l.amountOutRaw, feeAmountRaw: l.feeAmountRaw })),
    })),
    withdrawals: withdrawals.map((w) => ({
      id: w.id, ts: w.unstakeTs, asset: w.asset, source: w.source, amountRaw: w.amountRaw, principalRaw: w.principalRaw,
      unstakeSignature: w.unstakeSignature, withdrawSignature: w.withdrawSignature, cancelled: w.cancelSignature !== null, delivered: w.withdrawSignature !== null,
    })),
  }));
}
