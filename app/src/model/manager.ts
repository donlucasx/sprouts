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
// Owner ruling 11-15: "100% for every coin". Keep in sync with api/src/domain/split.ts and app/src/model/manager.ts.
export const PIN_MAX: Record<LiveAsset, number> = { SKR: 100, stORE: 100, USDC_LEND: 100, SOL_LEND: 100, hSOL: 100, cbBTC: 100 };
export const PIN_STEP = 5;

export const SWITCH_LABEL = "AI Yield Manager";
/** R348: the one line under the Yield Manager switch on Rules (replaces R178's). */
export const MANAGER_LINE = "Each morning, Claude Haiku 5.5 reads live rates and sends your new change where it pays best. It never sells what you hold.";
/** R347: the manager is branded Pro and included for everyone during launch. */
export const PRO_BADGE = "Pro";
export const PRO_LINE = "Included free during launch.";
/** R348: the one line above the split rows, so each control says what it does. 11-15: SKR has a switch too; one coin stays on. */
export const ROWS_LINE = { on: "Switch a coin off and the manager won't buy it. Keep at least one on.", off: "Set your own split. Switch a coin off and Sprouts won't buy it. Keep at least one on." } as const;
/** 11-15: the stop's SKR share is the manager's aim, not a user minimum. */
export const STOP_LINE = "Careful aims for about 50% in SKR, Balanced 35%, Bold 25%.";
export const UNDONE_TEXT = "Yesterday's split is back. The AI Yield Manager is off until you turn it on.";
export const STORE_ROW_NOTE = "ORE staked in ORE's program";
/** R-O1 (10-21); 11-15: stORE's 10% is a default, any stORE pin wins. */
export const STORE_FLOOR_LINE = {
  on: "stORE starts at 10% until you change it.",
  off: "stORE starts at 10% until you change it.",
} as const;

export type Row = { asset: LiveAsset; pct: number; mode: "auto" | "off" | "pinned"; bound: string | null };
export type RulesView = { managed: boolean; stop: Stop; pins: Pins; allocation: Split };

/** 11-15, the API's isOn: a coin is off iff its pin is exactly 0, in both modes, SKR included. */
const isOn = (pins: Pins, c: LiveAsset): boolean => pins[c] !== 0;

/** One row per coin. Off (addendum 11-15, no "rest"): every on coin, SKR included, reads "pinned" with its own number and steppers:
 * `preview` is the draft's shares (draftShares) while the user edits, else the split the API plants for the saved pins (manualSplit).
 * On (R346): every other row shows `preview` (the draft's split, from `managedPreview`) or the saved allocation, with the stop's
 * bound. In both modes a coin switched off (a 0 pin, SKR included since 11-15) reads "off". An old non-zero pin reads as on. */
export function splitRows(r: RulesView, preview?: Split): Row[] {
  if (!r.managed) {
    const shares = preview ?? manualSplit(r.pins);
    return ASSETS.map((asset) => (isOn(r.pins, asset) ? { asset, pct: shares[asset], mode: "pinned", bound: null } : { asset, pct: 0, mode: "off", bound: null }));
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

/**
 * The split the API plants with the manager off (api/src/domain/split.ts effectiveSplit, off): the pins, stORE at its default of 10
 * while it is on and unpinned, the rest to SKR when SKR is on, else to USDC lending if on, else the largest on coin. A 0 pin is a coin
 * switched off and stays 0. Addendum 11-15: the app saves pins that sum to exactly 100, so for them the rest is nothing; the rest rules
 * remain for pins saved before (0.1.10 sums under 100), which the screen shows as planted until the user edits them.
 */
export function manualSplit(pins: Pins): Split {
  const on = ASSETS.filter((c) => isOn(pins, c));
  const storeDefault = pins.stORE === undefined;
  if (on.length === 0) return zeroSplit();
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
    return out;
  }
  if (storeDefault) {
    // SKR off: stORE's default is set first, pins that leave it no room give way from the largest.
    out.stORE = STORE_FLOOR;
    const excess = NON_SKR.reduce((s, c) => s + out[c], 0) - 100;
    if (excess > 0) takeFrom(out, NON_SKR.filter(others), excess, () => 0);
  }
  const rest = 100 - NON_SKR.reduce((s, c) => s + out[c], 0);
  const restTo = rest > 0 ? restCoin(on, out) : null;
  if (restTo) out[restTo] += rest;
  return out;
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

/**
 * Addendum 11-15 (owner: "percentages should always add up to 100, there should be no rest"): with the manager off the screen's draft
 * holds every on coin's own number. Entering edit, every on coin is pinned at the share shown (manualSplit), so an untouched user's
 * SKR 90 / stORE 10 become explicit pins; nothing is saved until they save. In this draft a 0 pin is a coin switched off and an on
 * coin without a pin is at 0 (a 0 pin would read as off). Supersedes the final review's plantStore.
 */
export function explicitPins(pins: Pins): Pins {
  const shown = manualSplit(pins);
  const next: Pins = {};
  for (const c of ASSETS) {
    if (!isOn(pins, c)) next[c] = 0;
    else if (shown[c] > 0) next[c] = shown[c];
  }
  return next;
}

/** The draft's shares as they are (explicitPins' form): an on coin's pin or 0, an off coin 0. Nothing takes a rest. */
export function draftShares(pins: Pins): Split {
  const out = zeroSplit();
  for (const c of ASSETS) out[c] = pins[c] ?? 0;
  return out;
}

/** Addendum 11-15: "Total N%." under the rows and, off 100, what to fix; Save waits for exactly 100. */
export function splitTotal(shares: Split): { total: number; line: string; fix: string | null; ok: boolean } {
  const total = ASSETS.reduce((s, c) => s + shares[c], 0);
  const fix = total > 100 ? `Take ${total - 100}% from another coin to save.` : total < 100 ? `Add ${100 - total}% to another coin to save.` : null;
  return { total, line: `Total ${total}%.`, fix, ok: total === 100 };
}

/** The draft's pins as saved: stORE on at 0 (unpinned in the draft) goes as switched off, since the API plants an unpinned stORE at its
 *  default of 10. Every other pin goes as it is (the API drops a non-zero SKR pin and gives SKR 100 minus the others: its number). */
export function pinsToSave(pins: Pins): Pins {
  return pins.stORE === undefined ? { ...pins, stORE: 0 } : pins;
}

/** 10-23 (his ruling): with the manager off, switch a coin on or off (a 0 pin: never bought). 11-15: SKR too. Addendum 11-15: on the
 *  draft's explicit pins, on starts the coin at 0 (no pin) and off drops its share; nothing else moves. */
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

/** Move a pin by PIN_STEP inside 0 and the coin's pin max (manager off: the only steppers), on the draft's explicit pins (explicitPins).
 *  Addendum 11-15: only that coin moves; SKR and stORE step like the others; down to 0 the coin stays on (no pin, since a 0 pin is the
 *  off switch). A coin switched off is not stepped; a step that moves nothing writes nothing. */
export function stepPin(pins: Pins, asset: LiveAsset, dir: 1 | -1): Pins {
  if (pins[asset] === 0) return pins;
  const current = pins[asset] ?? 0;
  const next = Math.max(0, Math.min(PIN_MAX[asset], current + dir * PIN_STEP));
  if (next === current) return pins;
  const out: Pins = { ...pins };
  if (next === 0) delete out[asset];
  else out[asset] = next;
  return out;
}

/** Whether a pin's "+" may move it up by PIN_STEP.
 *  Off (addendum 11-15), on the draft's explicit pins: an on coin up to its pin max; the total may pass 100 in the draft (the total
 *  line asks for the fix and Save waits for 100).
 *  On, mirroring the API's validatePins: the pins must leave a free SKR the stop's share, or reach at most 100 with SKR pinned. */
export function canStepUp(r: RulesView, asset: LiveAsset): boolean {
  if (r.pins[asset] === 0) return false;
  const current = r.pins[asset] ?? 0;
  if (current + PIN_STEP > PIN_MAX[asset]) return false;
  if (!r.managed) return true;
  const next = (Object.values(r.pins) as number[]).reduce((s, v) => s + (v ?? 0), 0) + PIN_STEP;
  if (r.pins.SKR !== undefined || asset === "SKR") return next <= 100;
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
