import { SKR_ONLY, type Split, type Stop, type LiveAsset } from "./coins";

/** The user's own pins: a fixed percent per coin (spec 4.2); a missing coin is the manager's to set, or 0 when the manager is off. */
export type Pins = Partial<Record<LiveAsset, number>>;

/** The user's rules. All money in integer cents; percentages in basis points; the split in whole percents. */
export type Rules = {
  roundupOn: boolean;
  roundupToCents: number;
  pctOn: boolean;
  pctBps: number;
  pctThresholdCents: number;
  plantThresholdCents: number;
  plantMaxDays: number;
  dailyCapCents: number;
  /** The Yield Manager (R107): on or off, the risk stop, the pins, and the effective split the planting follows. */
  managed: boolean;
  stop: Stop;
  pins: Pins;
  allocation: Split;
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
  managed: false,
  stop: "balanced",
  pins: {},
  allocation: { ...SKR_ONLY },
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
