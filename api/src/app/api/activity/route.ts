import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import type { Asset, LiveAsset, Split } from "@/domain/coins";
import { addDays, dayOf } from "@/domain/day";
import { requireSession } from "@/lib/auth-guard";
import { priceUsd } from "@/lib/jupiter";
import { latestCoinDays } from "@/lib/holdings";
import { underlyingOutRaw, receiptOutRaw } from "@/lib/lend-view";
import { isLendAsset } from "@/domain/coins";
import { isAutoVenue } from "@/domain/venues";
import type { EventKind, MoveStatus } from "@/db/types";
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
  await Promise.all([...wanted].map(async ([key, { day, asset }]) => { dayPrices.set(key, (await repo.getCoinDay(day, asset as LiveAsset))?.priceUsd ?? null); }));   // a retired leg reads its own history rows (0008 keeps them)
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
  // Contracts 5.7: a lending position back to the wallet (underlyingRaw = what came back, from the confirmed tx; null when unknown),
  // the moves the user approved or turned down, and the scout's finds of the last 7 days.
  const lendEvents = await repo.listEvents(session.pubkey, ["lend_withdrawn", "move_proposed", "move_done", "move_dismissed", "move_failed"], LIMIT);
  // Event details are validated, never cast through: a malformed row is skipped rather than served with undefined fields.
  type EvDetail = Record<string, unknown>;
  const digits = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
  const str_ = (v: unknown): v is string => typeof v === "string" && v.length > 0;
  // No route writes a move_* event yet (Tasks 18/19 own moves); a status outside MoveStatus reads from the event kind.
  const MOVE_STATUS: Partial<Record<EventKind, MoveStatus>> = { move_proposed: "open", move_done: "done", move_dismissed: "dismissed", move_failed: "failed" };
  const MOVE_STATUSES: readonly MoveStatus[] = ["open", "dismissed", "expired", "done", "failed"];
  const lendWithdrawals = lendEvents.filter((e) => e.kind === "lend_withdrawn").flatMap((e) => {
    const d = (e.detail ?? {}) as EvDetail;
    if (!str_(d.asset) || !isLendAsset(d.asset) || !str_(d.venue) || !isAutoVenue(d.venue) || !digits(d.receiptRaw) || !str_(d.signature)) return [];
    return [{ ts: e.ts, asset: d.asset, venue: d.venue, receiptRaw: d.receiptRaw, underlyingRaw: digits(d.underlyingRaw) ? d.underlyingRaw : null, signature: d.signature, ...(typeof d.whole === "boolean" ? { whole: d.whole } : {}) }];
  });
  const moves = lendEvents.filter((e) => e.kind !== "lend_withdrawn").flatMap((e) => {
    const d = (e.detail ?? {}) as EvDetail;
    if (!str_(d.asset) || !isLendAsset(d.asset) || !str_(d.from) || !isAutoVenue(d.from) || !str_(d.to) || !isAutoVenue(d.to)) return [];
    if (d.receiptRaw !== undefined && !digits(d.receiptRaw)) return [];
    const status = MOVE_STATUSES.includes(d.status as MoveStatus) ? (d.status as MoveStatus) : MOVE_STATUS[e.kind];
    if (!status) return [];
    return [{ ts: e.ts, asset: d.asset, from: d.from, to: d.to, receiptRaw: digits(d.receiptRaw) ? d.receiptRaw : "0", status }];
  });
  const found = (await repo.listFoundVenues(addDays(dayOf(new Date()), -7), 20)).map((f) => ({ day: f.day, project: f.project, symbol: f.symbol, asset: f.asset, apyBasePct: f.apyBasePct, tvlUsd: f.tvlUsd, note: f.note }));
  return NextResponse.json(str({
    splits,
    swaps: swaps.map((s) => ({ signature: s.signature, ts: s.ts, walletPubkey: s.walletPubkey, usdSizeCents: s.usdSizeCents, class: s.class, roundupCents: s.roundupCents, plantingId: s.plantingId })),
    plantings: plantings.map((p, i) => ({
      id: p.id, ts: p.ts, status: p.status, signature: p.signature, usdcPulledCents: p.usdcPulledCents, networkFeeCents: p.networkFeeCents,
      legs: legs[i].map((l) => ({ asset: l.asset, usdcInCents: l.usdcInCents, amountOutRaw: l.amountOutRaw, feeAmountRaw: l.feeAmountRaw, feeCents: l.feeCents, usdPrice: priceOf(dayOf(p.ts), l.asset),
        venue: l.venue, receiptOutRaw: receiptOutRaw(l), underlyingOutRaw: underlyingOutRaw(l) })),
    })),
    withdrawals: withdrawals.map((w) => ({
      id: w.id, ts: w.unstakeTs, asset: w.asset, source: w.source, amountRaw: w.amountRaw, principalRaw: w.principalRaw,
      unstakeSignature: w.unstakeSignature, withdrawSignature: w.withdrawSignature, cancelled: w.cancelSignature !== null, delivered: w.withdrawSignature !== null,
    })),
    lendWithdrawals,
    moves,
    found,
  }));
}
