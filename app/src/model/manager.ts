import { ASSETS, type LiveAsset, type Pins, type Split, type Stop } from "@/lib/coins";
import type { SplitRow } from "@/lib/api";
import { COIN_NAME_LONG, dayLabel } from "@/lib/format";

/**
 * The Yield Manager as the app shows it (spec 3.1, 3.2). Pure. The tables mirror spec 4.1 for labels and stepper bounds only:
 * the API enforces them and answers with its own copy when a save breaks one.
 */
type NonSkr = Exclude<LiveAsset, "SKR">;
const NON_SKR: readonly NonSkr[] = ["stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC"] as const;

export const STOP_LABEL: Record<Stop, string> = { careful: "Careful", balanced: "Balanced", bold: "Bold" };
export const STOP_FLOOR: Record<Stop, number> = { careful: 50, balanced: 35, bold: 25 };
// Spec 9 (lending build, 10-04), the API's STOPS (api/src/domain/split.ts)
export const STOP_MAX: Record<Stop, Record<NonSkr, number>> = {
  careful: { stORE: 10, USDC_LEND: 30, SOL_LEND: 15, hSOL: 15, cbBTC: 30 },
  balanced: { stORE: 20, USDC_LEND: 30, SOL_LEND: 25, hSOL: 25, cbBTC: 25 },
  bold: { stORE: 30, USDC_LEND: 20, SOL_LEND: 35, hSOL: 35, cbBTC: 20 },
};
/** Spec 4.1 before 11-15: SKR's manual quarter. No longer a user minimum; the manual split with SKR on still keeps R-O1's donor order
 *  above it (the API's MANUAL_FLOOR), so saved splits do not change. */
export const MANUAL_FLOOR = 25;
/** R-O1 (10-21), the API's STORE_FLOOR, a DEFAULT since 11-15: stORE starts at 10% while it is on and has no pin. Any stORE pin wins. */
export const STORE_FLOOR = 10;
/** 11-15: the lowest stORE pin the stepper makes; below it is the off switch. */
const STORE_STEP_MIN = 5;
export const PIN_MAX: Record<LiveAsset, number> = { SKR: 100, stORE: 50, USDC_LEND: 75, SOL_LEND: 75, hSOL: 75, cbBTC: 75 };
export const PIN_STEP = 5;

export const SWITCH_LABEL = "AI Yield Manager";
/** R348: the one line under the Yield Manager switch on Rules (replaces R178's). */
export const MANAGER_LINE = "Each morning, Claude Haiku 5.5 reads live rates and sends your new change where it pays best. It never sells what you hold.";
/** R347: the manager is branded Pro and included for everyone during launch. */
export const PRO_BADGE = "Pro";
export const PRO_LINE = "Included free during launch.";
/** R348: the one line above the split rows, so each control says what it does. 11-15: SKR has a switch too; one coin stays on. */
export const ROWS_LINE = { on: "Switch a coin off and the manager won't buy it. Keep at least one on.", off: "Set your own split. Switch a coin off and Sprouts won't buy it." } as const;
/** 11-15: the stop's SKR share is the manager's aim, not a user minimum. */
export const STOP_LINE = "Careful aims for about 50% in SKR, Balanced 35%, Bold 25%.";
export const UNDONE_TEXT = "Yesterday's split is back. The AI Yield Manager is off until you turn it on.";
export const STORE_ROW_NOTE = "ORE staked in ORE's program";
/** R-O1 (10-21); 11-15: stORE's 10% is a default, any stORE pin wins. */
export const STORE_FLOOR_LINE = {
  on: "stORE starts at 10% until you change it.",
  off: "stORE starts at 10% until you change it.",
} as const;

export type Row = { asset: LiveAsset; pct: number; mode: "auto" | "off" | "pinned" | "the rest"; bound: string | null };
export type RulesView = { managed: boolean; stop: Stop; pins: Pins; allocation: Split };

/** 11-15, the API's isOn: a coin is off iff its pin is exactly 0, in both modes, SKR included. */
const isOn = (pins: Pins, c: LiveAsset): boolean => pins[c] !== 0;

/** One row per coin. Off: pins are the split and SKR is the rest. On (R346): every other row shows `preview` (the draft's split, from
 * `managedPreview`) or the saved allocation, with the stop's bound. In both modes a coin switched off (a 0 pin, SKR included since
 * 11-15) reads "off". An old non-zero pin reads as on. */
export function splitRows(r: RulesView, preview?: Split): Row[] {
  if (!r.managed) {
    const split = manualSplit(r.pins);
    return ASSETS.map((asset) => ({ asset, pct: split[asset], mode: !isOn(r.pins, asset) ? "off" : asset === "SKR" ? "the rest" : "pinned", bound: null }));
  }
  return ASSETS.map((asset) => {
    if (!isOn(r.pins, asset)) return { asset, pct: 0, mode: "off", bound: null };
    const bound = asset === "SKR" ? `aims for ${STOP_FLOOR[r.stop]}%` : `at most ${STOP_MAX[r.stop][asset]}%`;
    return { asset, pct: (preview ?? r.allocation)[asset], mode: "auto", bound };
  });
}

/*
 * The split rules, ported from api/src/domain/split.ts (effectiveSplit and its helpers, 11-15) so the Rules screen shows exactly what
 * the API will plant. Keep these in step with the API: tests/model/manager-flex.test.ts runs the API's own literals and a golden file
 * of the API's answers (tests/fixtures/gen-split-parity.mts) through manualSplit and managedPreview.
 */
const zeroSplit = (): Split => ({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 });
const stopMax = (stop: Stop, a: LiveAsset): number => (a === "SKR" ? 100 : STOP_MAX[stop][a]);

const largest = (cs: readonly LiveAsset[], split: Split): LiveAsset =>
  ASSETS.filter((c) => cs.includes(c)).reduce((b, c) => (split[c] > split[b] ? c : b));

/** The API's restCoin: SKR if on, else USDC_LEND if on, else the on coin with the largest share (ASSETS order on ties); with `pinned`,
 *  only on coins without a pin are candidates (every on coin pinned: the largest on coin). Null when nothing is on. */
function restCoin(on: readonly LiveAsset[], split: Split, pinned: readonly LiveAsset[] = []): LiveAsset | null {
  if (on.length === 0) return null;
  const free = on.filter((c) => !pinned.includes(c));
  if (free.length === 0) return largest(on, split);
  if (free.includes("SKR")) return "SKR";
  if (free.includes("USDC_LEND")) return "USDC_LEND";
  return largest(free, split);
}

/** The API's roundTo100: largest-remainder rounding to whole percents that still sum to 100. */
function roundTo100(x: Record<LiveAsset, number>): Split {
  const out = zeroSplit();
  let used = 0;
  for (const a of ASSETS) {
    out[a] = Math.floor(x[a]);
    used += out[a];
  }
  const order = [...ASSETS].sort((p, q) => x[q] - out[q] - (x[p] - out[p]));
  for (let i = 0; i < 100 - used; i++) out[order[i % order.length]] += 1;
  return out;
}

/** The API's waterFill: clamp the free non-SKR coins to their bound, pour the excess into free coins with room, the remainder to `rest()`. */
function waterFill(x: Record<LiveAsset, number>, free: LiveAsset[], bound: (a: LiveAsset) => number, rest: () => LiveAsset | null): LiveAsset | null {
  let excess = 0;
  for (const a of free) {
    if (a !== "SKR" && x[a] > bound(a)) {
      excess += x[a] - bound(a);
      x[a] = bound(a);
    }
  }
  let room = free.filter((a) => a !== "SKR" && x[a] < bound(a) - 1e-9);
  while (excess > 1e-9 && room.length) {
    const total = room.reduce((s, a) => s + bound(a) - x[a], 0);
    const pour = Math.min(excess, total);
    for (const a of room) x[a] += (pour * (bound(a) - x[a])) / total;
    excess -= pour;
    room = room.filter((a) => x[a] < bound(a) - 1e-9);
  }
  if (excess <= 1e-9) return null;
  const rc = rest();
  if (rc) x[rc] += excess;
  return rc;
}

/** The API's takeFrom: up to `deficit` from the donors, largest first, none below `lower`; answers what it took. */
function takeFrom(x: Record<LiveAsset, number>, donors: readonly LiveAsset[], deficit: number, lower: (c: LiveAsset) => number): number {
  let left = deficit;
  for (const c of [...donors].sort((p, q) => x[q] - x[p])) {
    if (left <= 0) break;
    const take = Math.min(x[c] - lower(c), left);
    if (take <= 0) continue;
    x[c] -= take;
    left -= take;
  }
  return deficit - left;
}

/** The API's raiseStore: stORE up to STORE_FLOOR from each donor tier in turn, SKR never below `skrMin`, stORE never its own donor. */
function raiseStore(out: Split, tiers: LiveAsset[][], skrMin: number): boolean {
  for (const tier of tiers) {
    const need = STORE_FLOOR - out.stORE;
    if (need <= 0) break;
    out.stORE += takeFrom(out, tier.filter((c) => c !== "stORE"), need, (c) => (c === "SKR" ? skrMin : 0));
  }
  return out.stORE >= STORE_FLOOR;
}

const others = (c: LiveAsset) => c !== "SKR" && c !== "stORE";

/** The manager-off split and where its rest went: the API's effectiveSplit (off) step by step, so restLine can name it. */
function manualParts(pins: Pins): { split: Split; rest: number; restTo: LiveAsset | null; storeDefault: boolean } {
  const on = ASSETS.filter((c) => isOn(pins, c));
  const storeDefault = pins.stORE === undefined;
  if (on.length === 0) return { split: zeroSplit(), rest: 0, restTo: null, storeDefault };
  // Pins are the split; a non-zero SKR pin is ignored (SKR is the rest, no stepper of its own).
  const out = zeroSplit();
  for (const c of NON_SKR) out[c] = pins[c] ?? 0;
  if (storeDefault && isOn(pins, "SKR")) {
    // SKR on (controller ruling 11-15): R-O1's donor order exactly as before, stORE's default from SKR above MANUAL_FLOOR first.
    out.stORE = STORE_FLOOR;
    out.SKR = 100 - NON_SKR.reduce((s, c) => s + out[c], 0);
    if (out.SKR < MANUAL_FLOOR) {
      out.stORE = 0;
      out.SKR = 100 - NON_SKR.reduce((s, c) => s + out[c], 0);
      raiseStore(out, [["SKR"], NON_SKR.filter(others)], MANUAL_FLOOR);
    }
    return { split: out, rest: out.SKR, restTo: "SKR", storeDefault };
  }
  if (storeDefault) {
    // SKR off: stORE's default is set first, pins that leave it no room give way from the largest.
    out.stORE = STORE_FLOOR;
    const excess = NON_SKR.reduce((s, c) => s + out[c], 0) - 100;
    if (excess > 0) takeFrom(out, NON_SKR.filter(others), excess, () => 0);
  }
  const rest = 100 - NON_SKR.reduce((s, c) => s + out[c], 0);
  const restTo = rest > 0 ? restCoin(on, out)! : null;
  if (restTo) out[restTo] += rest;
  return { split: out, rest: Math.max(0, rest), restTo, storeDefault };
}

/**
 * The split the API plants with the manager off (api/src/domain/split.ts effectiveSplit, off): the pins, stORE at its default of 10
 * while it is on and unpinned, the rest to SKR when SKR is on, else to USDC lending if on, else the largest on coin. A 0 pin is a coin
 * switched off and stays 0.
 */
export function manualSplit(pins: Pins): Split {
  return manualParts(pins).split;
}

/** R346: with the manager on, the only pins are 0 pins (the coins switched off, SKR included since 11-15); an old non-zero pin from
 *  before R346 becomes "on" at the next save. */
export function managedPins(pins: Pins): Pins {
  const next: Pins = {};
  for (const c of ASSETS) if (pins[c] === 0) next[c] = 0;
  return next;
}

/** R346: switch a coin on (the manager may buy it) or off (a 0 pin: never). 11-15: SKR too. */
export function setCoinOn(pins: Pins, asset: LiveAsset, on: boolean): Pins {
  const next = managedPins(pins);
  if (on) delete next[asset];
  else next[asset] = 0;
  return next;
}

/** 10-23 (his ruling): with the manager off, switch a coin on (back to no pin: stORE at its default, SKR the rest, the others at 0%)
 *  or off (a 0 pin: never bought). 11-15: SKR too. Other pins stay. */
export function setManualCoinOn(pins: Pins, asset: LiveAsset, on: boolean): Pins {
  const next: Pins = { ...pins };
  if (on) delete next[asset];
  else next[asset] = 0;
  return next;
}

/** The coins switched off (0 pins), sent to the API as `off` with every save that carries the split (10-23). 11-15: SKR included. */
export function offCoins(pins: Pins): LiveAsset[] {
  return ASSETS.filter((c) => pins[c] === 0);
}

/** 11-15: a switch may go off unless it is the last coin on (the API answers none_on). */
export function canSwitchOff(r: RulesView, asset: LiveAsset): boolean {
  return ASSETS.some((c) => c !== asset && isOn(r.pins, c));
}

/** 11-15: manager off with SKR off, where the rest goes: "The rest, N%, goes to <coin>.", N net of stORE's default (said first while
 *  it applies). Null when the manager is on, SKR is on (SKR is the rest, its row says so), or nothing is left over. */
export function restLine(r: RulesView): string | null {
  if (r.managed || isOn(r.pins, "SKR")) return null;
  const p = manualParts(r.pins);
  if (!p.restTo || p.rest <= 0) return null;
  const name = COIN_NAME_LONG[p.restTo];
  if (p.restTo === "stORE") return `The rest, ${p.split.stORE}%, goes to ${name}.`;
  return `${p.storeDefault ? `stORE starts at ${STORE_FLOOR}%. ` : ""}The rest, ${p.rest}%, goes to ${name}.`;
}

/**
 * The split the API will compute for the draft (api/src/domain/split.ts effectiveSplit, managed): pinned coins fixed (0 = off), the stop
 * split's weights over the free coins renormalised to what is left, clamped to the stop maxes with the excess poured into coins with
 * room and the rest coin last, a free SKR lifted to the stop's share, rounded to 100, stORE at its default while on and unpinned.
 * A preview only: the API's answer replaces it at save.
 */
export function managedPreview(stopSplit: Split, pins: Pins, stop: Stop): Split {
  const on = ASSETS.filter((c) => isOn(pins, c));
  if (on.length === 0) return zeroSplit();
  const storeDefault = pins.stORE === undefined;
  const floor = STOP_FLOOR[stop];
  const pinned = ASSETS.filter((c) => pins[c] !== undefined);
  const free = ASSETS.filter((c) => pins[c] === undefined);
  const R = 100 - pinned.reduce((s, c) => s + pins[c]!, 0);
  const bound = (c: LiveAsset) => (pinned.includes(c) ? PIN_MAX[c] : stopMax(stop, c));
  // A free SKR is lifted to the stop's share; a pinned SKR (0 = off) is exact.
  const skrMin = pins.SKR ?? floor;
  const x = zeroSplit() as Record<LiveAsset, number>;
  for (const c of pinned) x[c] = pins[c]!;
  const rest = () => restCoin(on, x, pinned);
  const weight = free.reduce((s, c) => s + stopSplit[c], 0);
  if (weight > 0) for (const c of free) x[c] = (stopSplit[c] / weight) * R;
  else if (R > 0 && free.length) {
    const rc = rest();
    if (rc) x[rc] = R;
  }
  const over = waterFill(x, free, bound, rest);
  const storeKeep = (c: LiveAsset) => (c === "stORE" && storeDefault ? Math.min(x.stORE, STORE_FLOOR) : 0);
  if (free.includes("SKR") && x.SKR < floor) x.SKR += takeFrom(x, free.filter((c) => c !== "SKR"), floor - x.SKR, storeKeep);
  const out = roundTo100(x);
  if (storeDefault) raiseStore(out, [free.filter(others), ["SKR"]], skrMin);
  const total = ASSETS.reduce((s, c) => s + out[c], 0);
  const ok = total === 100 && ASSETS.every((c) => out[c] >= 0 && (c === over || out[c] <= bound(c))) && (!free.includes("SKR") || out.SKR >= floor) && (!storeDefault || out.stORE >= STORE_FLOOR) && pinned.every((c) => c === over || out[c] === pins[c]);
  if (ok) return out;
  // The API's fallback: pins fixed, the rest to the rest coin, stORE's default then from the rest coin and the largest other pins.
  const fb = zeroSplit();
  for (const c of pinned) fb[c] = pins[c]!;
  const rc = restCoin(on, fb, pinned);
  if (rc && R > 0) fb[rc] += R;
  if (storeDefault && rc) raiseStore(fb, [[rc].filter((c) => c !== "stORE"), NON_SKR.filter(others)], skrMin);
  return fb;
}

/** Move a pin by PIN_STEP inside 0 and the coin's pin max (manager off: the only steppers). 11-15: stORE steps from its default of 10
 *  and stops at 5 (its off is the switch); a coin switched off is not stepped down. */
export function stepPin(pins: Pins, asset: LiveAsset, dir: 1 | -1): Pins {
  if (pins[asset] === 0 && dir === -1) return pins;
  const min = asset === "stORE" ? STORE_STEP_MIN : 0;
  const current = pins[asset] ?? (asset === "stORE" ? STORE_FLOOR : 0);
  const next = Math.max(min, Math.min(PIN_MAX[asset], current + dir * PIN_STEP));
  // 10-23: a 0 pin is the off switch, so stepping down to 0% leaves the coin on with no pin.
  if (next === 0) {
    const rest: Pins = { ...pins };
    delete rest[asset];
    return rest;
  }
  return { ...pins, [asset]: next };
}

/** Whether a pin's "+" may move it up by PIN_STEP, mirroring the API's validatePins: the coin's pin max and a total of at most 100.
 *  Off (11-15, no SKR quarter): stORE counts at its default while it is on and unpinned, so the pins the user sets are planted as set.
 *  On: the pins must leave a free SKR the stop's share, or reach at most 100 with SKR pinned. */
export function canStepUp(r: RulesView, asset: LiveAsset): boolean {
  const current = r.pins[asset] ?? (!r.managed && asset === "stORE" ? STORE_FLOOR : 0);
  if (current + PIN_STEP > PIN_MAX[asset]) return false;
  const counted = !r.managed && r.pins.stORE === undefined ? { ...r.pins, stORE: STORE_FLOOR } : r.pins;
  const next = (Object.values(counted) as number[]).reduce((s, v) => s + (v ?? 0), 0) + PIN_STEP;
  if (!r.managed || r.pins.SKR !== undefined || asset === "SKR") return next <= 100;
  return next <= 100 - STOP_FLOOR[r.stop];
}

/** The pins when the switch flips on (R346): the manual split's shares go (the manager sets them); a coin switched off stays off,
 *  since a 0 pin means "never" in both modes (10-23). */
export function pinsForOn(pins: Pins): Pins {
  return managedPins(pins);
}

/** "Changed {Mon D}." (F4: labelled by the day the manager changed the split, gated by undoAvailable). */
export function undoLine(changedDay: string | null): string | null {
  return changedDay ? `Changed ${dayLabel(changedDay)}.` : null;
}

/** "USDC lending 10 to 15, hSOL 20 to 15": every live leg that moved, in the spec's order; old rows' retired keys are not named (R281). */
export function changeSummary(from: Partial<Record<string, number>>, to: Partial<Record<string, number>>): string {
  return ASSETS.filter((a) => (from[a] ?? 0) !== (to[a] ?? 0)).map((a) => `${COIN_NAME_LONG[a]} ${from[a] ?? 0} to ${to[a] ?? 0}`).join(", ");
}

/** One Activity row (spec 3.2), dated by the API's UTC day so it agrees with the Rules card's "Changed {Mon D}." */
export function splitRowLine(s: SplitRow): string {
  const day = dayLabel(s.ts.slice(0, 10));
  const summary = changeSummary(s.from, s.to);
  if (s.by === "undo") return `${day}, undone. Yesterday's split is back; the AI Yield Manager is off.`;
  if (s.by === "you" && s.turnedOn) return `${day}, you: ${s.stop ? `${STOP_LABEL[s.stop as Stop] ?? s.stop}, ` : ""}on.`;
  if (s.by === "you") return summary ? `${day}, you: ${summary}.` : `${day}, you: ${s.stop ? STOP_LABEL[s.stop as Stop] ?? s.stop : "saved"}.`;
  if (s.fallback) return `${day}, chosen by rule today: ${summary}.`;
  return `${day}, ${summary}.${s.why ? ` ${s.why}` : ""}`;
}
