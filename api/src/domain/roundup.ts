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
  /** 11-12: swaps under $1 (down to SMALL_SWAP_FLOOR_CENTS) count too. Off by default (his ruling). */
  smallOn: boolean;
  /** 11-12: a set amount added to every swap, for small regular buys that are whole dollars (a daily DCA). Off by default. */
  perSwapOn: boolean;
  perSwapCents: number;
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
  smallOn: false,
  perSwapOn: false,
  perSwapCents: 10,
  plantThresholdCents: 200,
  plantMaxDays: 7,
  dailyCapCents: 500,
  managed: false,
  stop: "balanced",
  pins: {},
  allocation: { ...SKR_ONLY },
};

/** 11-08 (his ruling "Min $1 swap"): a swap under $1 is recorded but saves nothing (a $0.01 dust sale rounded up 99c), unless smallOn. */
export const MIN_ROUNDUP_SWAP_CENTS = 100;
/** 11-12 (his ruling "ignore under 10c"): with smallOn, swaps under 10 cents are dust and still save nothing. */
export const SMALL_SWAP_FLOOR_CENTS = 10;
/** The set amounts "add to every swap" offers (his ruling 11-12: 5, 10 or 25 cents). */
export const PER_SWAP_CENTS = [5, 10, 25] as const;

/**
 * The change a swap produces: up to the next dollar (a whole-dollar swap has no spare change, R484, his call 10-08), plus the set
 * amount when "add to every swap" is on, plus the percentage when the swap is at least the threshold. Swaps under $1 produce
 * nothing unless smallOn, and never under SMALL_SWAP_FLOOR_CENTS. An unpriced swap (null) produces nothing. The daily limit caps
 * what is pulled, not this.
 */
export function computeRoundupCents(sizeCents: number | null, rules: Rules): number {
  if (sizeCents === null) return 0;
  if (sizeCents < (rules.smallOn ? SMALL_SWAP_FLOOR_CENTS : MIN_ROUNDUP_SWAP_CENTS)) return 0;
  let out = 0;
  if (rules.perSwapOn) out += rules.perSwapCents;
  if (rules.roundupOn) {
    const remainder = sizeCents % rules.roundupToCents;
    out += remainder === 0 ? 0 : rules.roundupToCents - remainder;
  }
  if (rules.pctOn && sizeCents >= rules.pctThresholdCents) out += Math.floor((sizeCents * rules.pctBps) / 10_000);
  return out;
}
