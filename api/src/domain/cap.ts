/** What the on-chain daily limit still allows this period, never negative. */
export function capLeftCents(dailyCapCents: number, pulledInPeriodCents: number): number {
  return Math.max(0, dailyCapCents - pulledInPeriodCents);
}

export type PlantAmount = { pullCents: number; changeCents: number };

/**
 * How much to pull today: the pending change, bounded by the cap left after the pass-through network fee.
 * Nothing is planted when the change that fits is below the minimum (the threshold, or zero when the 7-day rule forces it).
 */
export function plantAmountCents(a: { pendingCents: number; capLeftCents: number; feeCents: number; minCents: number }): PlantAmount {
  const change = Math.min(a.pendingCents, a.capLeftCents - a.feeCents);
  if (change <= 0 || change < a.minCents) return { pullCents: 0, changeCents: 0 };
  return { pullCents: change + a.feeCents, changeCents: change };
}

/** The round-ups a pull with room for `roomCents` of change covers: whole (what each still owes), oldest first (the list is oldest first); one that does not fit is skipped and waits for a later planting (R361). */
export function coveredOldestFirst<T extends { owedCents: number }>(swaps: T[], roomCents: number): { claim: T[]; covered: number } {
  const claim: T[] = [];
  let covered = 0;
  for (const s of swaps) if (covered + s.owedCents <= roomCents) { claim.push(s); covered += s.owedCents; }
  return { claim, covered };
}

/**
 * Cap carry (owner 11-13): what a planting bounded by the cap claims. The round-ups the cap left covers after the fee, whole (what
 * each still owes), oldest first; the rest wait for the following days. Round 2: an OLDEST round-up owing more than a whole day
 * (cap - fee) never fits, so on a full day (cap left = cap) the planting pulls a PART of it, cap - fee, and claims nothing: the swap
 * stays pending and owes the rest (nothing is lost). On a day the cap is partly used nothing is taken (nothing behind it jumps ahead,
 * so it cannot be starved); it gets its part on the next fresh day.
 */
export function capCarryClaim<T extends { owedCents: number }>(swaps: T[], a: { capCents: number; capLeftCents: number; feeCents: number }): { claim: T[]; covered: number; part: { swap: T; cents: number } | null } {
  const day = a.capCents - a.feeCents;
  if (swaps.length > 0 && swaps[0].owedCents > day) {
    return a.capLeftCents >= a.capCents && day > 0 ? { claim: [], covered: day, part: { swap: swaps[0], cents: day } } : { claim: [], covered: 0, part: null };
  }
  return { ...coveredOldestFirst(swaps, a.capLeftCents - a.feeCents), part: null };
}
