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

/**
 * The round-ups a pull with room for `roomCents` of change covers: whole, oldest first (the list is oldest first); one that does not
 * fit is skipped and waits for a later planting (R361). With `aloneOverCents` (owner 11-13, cap carry): when the OLDEST round-up alone
 * is bigger than that, it never fits a planting, so it is taken alone and covers the room; its excess is never pulled. Everything
 * behind it waits.
 */
export function coveredOldestFirst<T extends { roundupCents: number }>(swaps: T[], roomCents: number, aloneOverCents?: number): { claim: T[]; covered: number } {
  if (aloneOverCents !== undefined && swaps.length > 0 && swaps[0].roundupCents > aloneOverCents) {
    return { claim: [swaps[0]], covered: Math.max(0, Math.min(swaps[0].roundupCents, roomCents)) };
  }
  const claim: T[] = [];
  let covered = 0;
  for (const s of swaps) if (covered + s.roundupCents <= roomCents) { claim.push(s); covered += s.roundupCents; }
  return { claim, covered };
}
