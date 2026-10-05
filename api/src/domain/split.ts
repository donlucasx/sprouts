import { ASSETS, zeroSplit, type LiveAsset, type Split, type Stop } from "./coins";
import type { Pins } from "./roundup";

/**
 * Every rule of the Yield Manager, in one file and nowhere else (spec section 4). All functions are pure: the daily run and the
 * routes call them with what they read; the tests call them with literals.
 */

type NonSkr = Exclude<LiveAsset, "SKR">;
const NON_SKR: readonly NonSkr[] = ["stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC"] as const;

/** Lending spec 9 (R254-R303): the risk stops' maxes per leg; SKR's number is a floor. */
export const STOPS: Record<Stop, { floor: number; max: Record<NonSkr, number> }> = {
  careful: { floor: 50, max: { stORE: 10, USDC_LEND: 30, SOL_LEND: 15, hSOL: 15, cbBTC: 30 } },
  balanced: { floor: 35, max: { stORE: 20, USDC_LEND: 30, SOL_LEND: 25, hSOL: 25, cbBTC: 25 } },
  bold: { floor: 25, max: { stORE: 30, USDC_LEND: 20, SOL_LEND: 35, hSOL: 35, cbBTC: 20 } },
};
export const STOP_LABEL: Record<Stop, string> = { careful: "Careful", balanced: "Balanced", bold: "Bold" };
/** With the manager off, pins alone set the split and SKR still keeps a quarter (spec 4.1). */
export const MANUAL_FLOOR = 25;
export const PIN_MAX: Record<LiveAsset, number> = { SKR: 100, stORE: 50, USDC_LEND: 75, SOL_LEND: 75, hSOL: 75, cbBTC: 75 };
/** The app's stepper moves pins by this; the API accepts any whole percent so an undo can pin yesterday's exact values. */
export const PIN_STEP = 5;
/** R120: the manager's own daily move per coin, in points. The user's actions are not limited. */
export const MOVE_LIMIT = 10;
/** Contracts 1.2 (Claude's call 10-04): today's defaults with JitoSOL renamed USDC_LEND and JupSOL renamed SOL_LEND. */
export const STOP_DEFAULTS: Record<Stop, Split> = {
  careful: { SKR: 60, stORE: 0, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 20 },
  balanced: { SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 },
  bold: { SKR: 30, stORE: 0, USDC_LEND: 20, SOL_LEND: 15, hSOL: 25, cbBTC: 10 },
};

export const floorFor = (managed: boolean, stop: Stop): number => (managed ? STOPS[stop].floor : MANUAL_FLOOR);
export const stopMax = (stop: Stop, a: LiveAsset): number => (a === "SKR" ? 100 : STOPS[stop].max[a]);

/**
 * Spec 6.5 and 3, as ruled by R336 (+ Claude's follow-up, 10-04): a leg that cannot take money this planting (its leash flag is off
 * for a leashed user, or no lending venue is eligible) hands its share to the enabled legs, WATER-FILLED up to each one's stop max
 * for `stop` (one point at a time to the leg with the most headroom; ASSETS order on ties). What is left once every enabled leg is
 * at its max goes to USDC_LEND, the least volatile leg, even past its max. When USDC_LEND is itself disabled the remainder is left
 * unpulled: the split then sums under 100 and the planting run pulls only that share (plant-run). (The brief's "else the enabled
 * leg with the most headroom" is the fill itself: a remainder exists only when no enabled leg has headroom left.)
 * An enabled leg already over its max (a pin) keeps its share and takes nothing more. Null when no leg is enabled.
 */
export function redistributeDisabled(split: Split, disabled: readonly LiveAsset[], stop: Stop): Split | null {
  const enabled = ASSETS.filter((a) => !disabled.includes(a));
  if (enabled.length === 0) return null;
  const out: Split = { ...split };
  let moved = 0;
  for (const a of ASSETS) {
    if (!disabled.includes(a)) continue;
    moved += out[a];
    out[a] = 0;
  }
  const headroom = (a: LiveAsset) => Math.max(0, stopMax(stop, a) - out[a]);
  while (moved > 1e-9) {
    const best = enabled.reduce((b, a) => (headroom(a) > headroom(b) ? a : b), enabled[0]);
    const step = Math.min(1, moved, headroom(best));
    if (step <= 1e-9) break;
    out[best] += step;
    moved -= step;
  }
  if (moved > 1e-9 && enabled.includes("USDC_LEND")) out.USDC_LEND += moved;
  return out;
}

export type PinProblem = "sum" | "skr_floor" | "range";

/** Save-time rule (spec 4.2), the only place pin conflicts are resolved; the cron never resolves one. */
export function validatePins(pins: Pins, floor: number): PinProblem | null {
  for (const a of ASSETS) {
    const v = pins[a];
    if (v === undefined) continue;
    if (!Number.isInteger(v) || v < 0 || v > PIN_MAX[a]) return "range";
  }
  const total = ASSETS.reduce((s, a) => s + (pins[a] ?? 0), 0);
  if (total > 100) return "sum";
  if (pins.SKR !== undefined) return pins.SKR < floor ? "skr_floor" : null;
  return total > 100 - floor ? "sum" : null;
}

/** Largest-remainder rounding to whole percents that still sum to 100. */
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

/**
 * Clamp the free non-SKR coins to their bound and pour the excess into free coins with room, SKR last and unbounded. SKR takes the
 * leftover even when pinned: a pinned SKR is a floor, since SKR has no max (spec 4.3).
 */
function waterFill(x: Record<LiveAsset, number>, free: LiveAsset[], bound: (a: LiveAsset) => number) {
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
  if (excess > 1e-9) x.SKR += excess;
}

/** Take `deficit` from the largest donors first, never below `lower(a)`; returns what was taken. */
function takeFrom(x: Record<LiveAsset, number>, donors: LiveAsset[], deficit: number, lower: (a: LiveAsset) => number): number {
  let left = deficit;
  for (const a of [...donors].sort((p, q) => x[q] - x[p])) {
    if (left <= 0) break;
    const take = Math.min(x[a] - lower(a), left);
    if (take <= 0) continue;
    x[a] -= take;
    left -= take;
  }
  return deficit - left;
}

/**
 * The user's split (spec 4.3). Off: pins are the split and SKR is the rest. On: pinned coins fixed, the stop split's weights
 * over the free coins renormalised to what is left, clamped to the stop maxes, SKR kept at the floor, rounded to 100.
 */
export function effectiveSplit(a: { managed: boolean; stop: Stop; pins: Pins; stopSplit: Split; disabled?: readonly LiveAsset[] }): Split {
  const done = (s: Split): Split => (a.disabled?.length ? (redistributeDisabled(s, a.disabled, a.stop) ?? s) : s);
  if (!a.managed) {
    const out = zeroSplit();
    let rest = 100;
    for (const c of NON_SKR) {
      out[c] = a.pins[c] ?? 0;
      rest -= out[c];
    }
    out.SKR = rest;
    return done(out);
  }
  const floor = STOPS[a.stop].floor;
  const pinned = ASSETS.filter((c) => a.pins[c] !== undefined);
  const free = ASSETS.filter((c) => a.pins[c] === undefined);
  const R = 100 - pinned.reduce((s, c) => s + a.pins[c]!, 0);
  const bound = (c: LiveAsset) => (pinned.includes(c) ? PIN_MAX[c] : stopMax(a.stop, c));
  const x = zeroSplit() as Record<LiveAsset, number>;
  for (const c of pinned) x[c] = a.pins[c]!;
  const weight = free.reduce((s, c) => s + a.stopSplit[c], 0);
  for (const c of free) x[c] = weight > 0 ? (a.stopSplit[c] / weight) * R : c === "SKR" ? R : 0;
  waterFill(x, free, bound);
  if (free.includes("SKR") && x.SKR < floor) x.SKR += takeFrom(x, free.filter((c) => c !== "SKR"), floor - x.SKR, () => 0);
  const out = roundTo100(x);
  const total = ASSETS.reduce((s, c) => s + out[c], 0);
  const ok = total === 100 && ASSETS.every((c) => out[c] >= 0 && out[c] <= bound(c)) && (!free.includes("SKR") || out.SKR >= floor) && pinned.every((c) => (c === "SKR" ? out.SKR >= a.pins.SKR! : out[c] === a.pins[c]));
  if (ok) return done(out);
  // Fallback: pins fixed, SKR takes the rest, unpinned non-SKR coins 0 (never discard a pin).
  const fb = zeroSplit();
  for (const c of pinned) fb[c] = a.pins[c]!;
  fb.SKR = (a.pins.SKR ?? 0) + (pinned.includes("SKR") ? 0 : R);
  if (pinned.includes("SKR")) fb.SKR += R;
  return done(fb);
}

/**
 * The stop's daily split from a model answer (spec 6.3): a no-data coin is held at yesterday's share for the stop, at most the
 * stop max, 0 with no yesterday (R132: one bad pool read used to blank the coin for days through the move limit); each other
 * non-SKR coin inside its stop max and within MOVE_LIMIT of yesterday both ways; SKR takes the difference and is raised to the
 * floor from the largest coins if needed. Null when the result still breaks a bound (the caller falls back).
 */
export function clampSplit(a: { stop: Stop; proposed: Split; noData: LiveAsset[]; yesterday: Split | null }): Split | null {
  const floor = STOPS[a.stop].floor;
  const held = (c: LiveAsset) => (a.yesterday ? Math.min(a.yesterday[c], stopMax(a.stop, c)) : 0);
  const upper = (c: LiveAsset) => (a.noData.includes(c) ? held(c) : Math.min(stopMax(a.stop, c), a.yesterday ? a.yesterday[c] + MOVE_LIMIT : 100));
  const lower = (c: LiveAsset) => (a.noData.includes(c) ? held(c) : !a.yesterday ? 0 : Math.max(0, a.yesterday[c] - MOVE_LIMIT));
  const x = { ...a.proposed } as Record<LiveAsset, number>;
  for (const c of NON_SKR) x[c] = Math.min(upper(c), Math.max(lower(c), x[c]));
  // What the clamp removes goes to SKR by design, not water-filled into other coins with room: the plan's deliberate
  // simplification of spec 6.3 step 3 (ruling C). effectiveSplit water-fills; this does not, on purpose.
  x.SKR = 100 - NON_SKR.reduce((s, c) => s + x[c], 0);
  if (x.SKR < floor) x.SKR += takeFrom(x, [...NON_SKR], floor - x.SKR, lower);
  const out = roundTo100(x);
  const total = ASSETS.reduce((s, c) => s + out[c], 0);
  const ok = total === 100 && out.SKR >= floor && NON_SKR.every((c) => out[c] >= lower(c) && out[c] <= upper(c));
  return ok ? out : null;
}

/** When the model fails or breaks a rule (spec 6.5): SKR at least the floor, the rest to the highest measured growth, then the clamp. */
export function fallbackSplit(a: { stop: Stop; growth: Partial<Record<LiveAsset, number | null>>; noData: LiveAsset[]; yesterday: Split | null }): Split {
  const floor = STOPS[a.stop].floor;
  const base = a.yesterday ?? STOP_DEFAULTS[a.stop];
  const measured = NON_SKR.filter((c) => !a.noData.includes(c) && typeof a.growth[c] === "number");
  if (measured.length === 0) return clampSplit({ stop: a.stop, proposed: base, noData: a.noData, yesterday: a.yesterday }) ?? base;
  const x = zeroSplit();
  x.SKR = Math.max(floor, base.SKR);
  let rest = 100 - x.SKR;
  for (const c of measured.sort((p, q) => (a.growth[q] as number) - (a.growth[p] as number))) {
    const take = Math.min(rest, stopMax(a.stop, c));
    x[c] = take;
    rest -= take;
  }
  x.SKR += rest;
  return clampSplit({ stop: a.stop, proposed: x, noData: a.noData, yesterday: a.yesterday }) ?? base;
}

const ADVICE = /\b(should|buy|sell|recommend|advice|advise|portfolio|boost)\b/i;
const PERSONA = /\b(I|we|the watcher)\b/i;
const BANNED_GLYPHS = /\u2014|\p{Extended_Pictographic}/u;

/** The model's one line, or null (spec 6.4): stripped of URLs, under 140 characters, no exclamation marks, no persona or advice words, every number in the facts. */
export function checkWhy(line: string, facts: number[]): string | null {
  const s = line.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  if (!s || s.length > 140 || s.includes("!")) return null;
  if (ADVICE.test(s) || PERSONA.test(s) || BANNED_GLYPHS.test(s)) return null;
  const table = new Set(facts.map((n) => Math.round(n * 10) / 10));
  for (const n of s.match(/-?\d+(?:\.\d+)?/g) ?? []) if (!table.has(Math.round(Number(n) * 10) / 10)) return null;
  return s;
}

/** The line behind the model's (spec 6.4): the top measured coin, or the collecting line. */
export function templateWhy(a: { stop: Stop; top: { asset: LiveAsset; pct: number } | null }): string {
  if (!a.top) return `Collecting the first week of numbers; the split follows the limits for ${STOP_LABEL[a.stop]}.`;
  const source = a.top.asset === "stORE" ? ", from ORE mining fees" : "";   // R177: stORE's growth has a named source
  return `${a.top.asset} grew at ${(Math.round(a.top.pct * 10) / 10).toFixed(1)}% a year over the past week, the most of your coins${source}.`;
}
