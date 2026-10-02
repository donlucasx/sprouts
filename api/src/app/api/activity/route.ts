import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import type { Asset, Split } from "@/domain/coins";
import { dayOf } from "@/domain/day";
import { requireSession } from "@/lib/auth-guard";
import { priceUsd } from "@/lib/jupiter";
import { SKR_MINT } from "@/lib/constants";

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
  // R140: the dollar beside every planting row, the four new coins included. SKR at the live SKR price, as Home shows it; the
  // other coins at that day's snapshot price; null when there is none (the app then shows the amount alone).
  const skrUsd = await priceUsd(SKR_MINT).catch(() => null);
  const dayPrices = new Map<string, number | null>();
  const usdPrices: (number | null)[][] = [];
  for (const [i, p] of plantings.entries()) {
    const day = dayOf(p.ts);
    usdPrices[i] = [];
    for (const l of legs[i]) {
      const key = `${day}|${l.asset as Asset}`;
      if (!dayPrices.has(key)) dayPrices.set(key, l.asset === "SKR" ? skrUsd : ((await repo.getCoinDay(day, l.asset))?.priceUsd ?? null));
      usdPrices[i].push(dayPrices.get(key) ?? null);
    }
  }
  const events = await repo.listEvents(session.pubkey, ["split_changed", "split_undone"], LIMIT);
  type Detail = { by?: "manager" | "you"; from: Split; to: Split; stop?: string; why?: string | null; fallback?: string | null };
  const splits = events.map((e) => {
    const d = e.detail as Detail;
    return { ts: e.ts, by: e.kind === "split_undone" ? "undo" : (d.by ?? "manager"), from: d.from, to: d.to, stop: d.stop ?? null, why: d.why ?? null, fallback: d.fallback ?? null };
  });
  return NextResponse.json(str({
    splits,
    swaps: swaps.map((s) => ({ signature: s.signature, ts: s.ts, walletPubkey: s.walletPubkey, usdSizeCents: s.usdSizeCents, class: s.class, roundupCents: s.roundupCents, plantingId: s.plantingId })),
    plantings: plantings.map((p, i) => ({
      id: p.id, ts: p.ts, status: p.status, signature: p.signature, usdcPulledCents: p.usdcPulledCents, networkFeeCents: p.networkFeeCents,
      legs: legs[i].map((l, j) => ({ asset: l.asset, usdcInCents: l.usdcInCents, amountOutRaw: l.amountOutRaw, feeAmountRaw: l.feeAmountRaw, feeCents: l.feeCents, usdPrice: usdPrices[i][j] })),
    })),
    withdrawals: withdrawals.map((w) => ({
      id: w.id, ts: w.unstakeTs, asset: w.asset, source: w.source, amountRaw: w.amountRaw, principalRaw: w.principalRaw,
      unstakeSignature: w.unstakeSignature, withdrawSignature: w.withdrawSignature, cancelled: w.cancelSignature !== null, delivered: w.withdrawSignature !== null,
    })),
  }));
}
