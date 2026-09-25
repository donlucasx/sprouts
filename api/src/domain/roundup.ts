/** The user's rules. All money in integer cents; percentages in basis points. */
export type Rules = {
  roundupOn: boolean;
  roundupToCents: number;
  pctOn: boolean;
  pctBps: number;
  pctThresholdCents: number;
  plantThresholdCents: number;
  plantMaxDays: number;
  dailyCapCents: number;
  allocation: { SKR: number; stORE: number };
};

export const DEFAULT_RULES: Rules = {
  roundupOn: true,
  roundupToCents: 100,
  pctOn: true,
  pctBps: 100,
  pctThresholdCents: 10_000,
  plantThresholdCents: 200,
  plantMaxDays: 7,
  dailyCapCents: 500,
  allocation: { SKR: 100, stORE: 0 },
};

/**
 * The change a swap produces: up to the next dollar (a whole-dollar swap rounds up a full dollar, Acorns' rule),
 * plus the percentage when the swap is at least the threshold. An unpriced swap (null) produces nothing.
 */
export function computeRoundupCents(sizeCents: number | null, rules: Rules): number {
  if (sizeCents === null || sizeCents <= 0) return 0;
  let out = 0;
  if (rules.roundupOn) {
    const remainder = sizeCents % rules.roundupToCents;
    out += remainder === 0 ? rules.roundupToCents : rules.roundupToCents - remainder;
  }
  if (rules.pctOn && sizeCents >= rules.pctThresholdCents) out += Math.floor((sizeCents * rules.pctBps) / 10_000);
  return out;
}
