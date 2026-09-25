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
