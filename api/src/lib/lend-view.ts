import type { PlantingLegRow, VenueDayRow } from "@/db/types";
import { LEND_ASSETS, isLendAsset, type LendAsset } from "@/domain/coins";
import { VENUE_SHORT, type AutoVenue } from "@/domain/venues";
import type { LendingPositionOut } from "./holdings";

export type LendSign = { line1: "USDC" | "SOL"; line2: string; venue: AutoVenue; ratePct: number } | null;

/**
 * Contracts 7.2: the two-line garden sign. The venue is today's pick for the asset, else the venue of the user's largest position;
 * the rate is that venue's supply rate in `rows` (the newest snapshot); no venue or no rate, no sign (null).
 */
export function lendSignsFor(a: { picks: Partial<Record<LendAsset, AutoVenue | null>>; positions: LendingPositionOut[]; rows: VenueDayRow[] }): Record<LendAsset, LendSign> {
  const out = {} as Record<LendAsset, LendSign>;
  for (const asset of LEND_ASSETS) {
    const largest = a.positions.filter((p) => p.asset === asset).sort((p, q) => (q.valueUsd ?? 0) - (p.valueUsd ?? 0))[0];
    const venue = a.picks[asset] ?? largest?.venue ?? null;
    const ratePct = venue ? (a.rows.find((r) => r.venue === venue && r.asset === asset)?.supplyPct ?? null) : null;
    out[asset] = venue && ratePct !== null ? { line1: asset === "USDC_LEND" ? "USDC" : "SOL", line2: `${VENUE_SHORT[venue]} ${ratePct.toFixed(1)}%`, venue, ratePct } : null;
  }
  return out;
}

/** A lending leg's delivery in the underlying's units (receipt x the venue's rate at planting, floored; USDC 6 / SOL 9 decimals); null for coin legs or an unknown rate. */
export const underlyingOutRaw = (l: PlantingLegRow): bigint | null => (isLendAsset(l.asset) && l.rateAtPlanting !== null ? BigInt(Math.floor(Number(l.amountOutRaw) * l.rateAtPlanting)) : null);
/** A lending leg's `amountOutRaw`, named: the venue receipt it delivered (kUSDC/kSOL 6 dp, Jupiter f-tokens); null for coin legs. */
export const receiptOutRaw = (l: PlantingLegRow): bigint | null => (isLendAsset(l.asset) ? l.amountOutRaw : null);
