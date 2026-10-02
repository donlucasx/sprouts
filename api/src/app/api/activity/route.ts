import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import type { Asset, Split } from "@/domain/coins";
import { dayOf } from "@/domain/day";
import { requireSession } from "@/lib/auth-guard";
import { priceUsd } from "@/lib/jupiter";
import { latestCoinDays } from "@/lib/holdings";
import { SKR_MINT, STORE_MINT } from "@/lib/constants";

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
  // other coins at that day's snapshot price, read once per day and coin, all at once. A planting from before its coin's first
  // snapshot takes the week's latest row, then the live stORE price, as /api/me prices the receipt; null when nothing is known.
  const wanted = new Map<string, { day: string; asset: Asset }>();
  for (const [i, p] of plantings.entries()) for (const l of legs[i]) if (l.asset !== "SKR") wanted.set(`${dayOf(p.ts)}|${l.asset}`, { day: dayOf(p.ts), asset: l.asset });
  const skrUsdRead = priceUsd(SKR_MINT).catch(() => null);
  const dayPrices = new Map<string, number | null>();
  await Promise.all([...wanted].map(async ([key, { day, asset }]) => { dayPrices.set(key, (await repo.getCoinDay(day, asset))?.priceUsd ?? null); }));
  const skrUsd = await skrUsdRead;
  const missing = [...wanted.values()].filter(({ day, asset }) => dayPrices.get(`${day}|${asset}`) === null).map(({ asset }) => asset);
  const latest = missing.length ? await latestCoinDays(repo, dayOf(new Date())) : {};
  const storeUsd = missing.includes("stORE") && latest.stORE?.priceUsd == null ? await priceUsd(STORE_MINT).catch(() => null) : null;
  const priceOf = (day: string, asset: Asset): number | null =>
    asset === "SKR" ? skrUsd : (dayPrices.get(`${day}|${asset}`) ?? latest[asset]?.priceUsd ?? (asset === "stORE" ? storeUsd : null));
  const events = await repo.listEvents(session.pubkey, ["split_changed", "split_undone"], LIMIT);
  type Detail = { by?: "manager" | "you"; from: Split; to: Split; stop?: string; why?: string | null; fallback?: string | null; managed?: boolean; managedWas?: boolean };
  const splits = events.map((e) => {
    const d = e.detail as Detail;
    // `managed` is the switch after a save by you; `turnedOn` only when that save moved it off to on ("you: Balanced, on.", spec 3.2).
    return { ts: e.ts, by: e.kind === "split_undone" ? "undo" : (d.by ?? "manager"), from: d.from, to: d.to, stop: d.stop ?? null, why: d.why ?? null, fallback: d.fallback ?? null, managed: d.managed ?? null, turnedOn: d.managed === true && d.managedWas === false };
  });
  return NextResponse.json(str({
    splits,
    swaps: swaps.map((s) => ({ signature: s.signature, ts: s.ts, walletPubkey: s.walletPubkey, usdSizeCents: s.usdSizeCents, class: s.class, roundupCents: s.roundupCents, plantingId: s.plantingId })),
    plantings: plantings.map((p, i) => ({
      id: p.id, ts: p.ts, status: p.status, signature: p.signature, usdcPulledCents: p.usdcPulledCents, networkFeeCents: p.networkFeeCents,
      legs: legs[i].map((l) => ({ asset: l.asset, usdcInCents: l.usdcInCents, amountOutRaw: l.amountOutRaw, feeAmountRaw: l.feeAmountRaw, feeCents: l.feeCents, usdPrice: priceOf(dayOf(p.ts), l.asset) })),
    })),
    withdrawals: withdrawals.map((w) => ({
      id: w.id, ts: w.unstakeTs, asset: w.asset, source: w.source, amountRaw: w.amountRaw, principalRaw: w.principalRaw,
      unstakeSignature: w.unstakeSignature, withdrawSignature: w.withdrawSignature, cancelled: w.cancelSignature !== null, delivered: w.withdrawSignature !== null,
    })),
  }));
}
