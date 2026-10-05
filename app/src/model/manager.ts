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
export const MANUAL_FLOOR = 25;
export const PIN_MAX: Record<LiveAsset, number> = { SKR: 100, stORE: 50, USDC_LEND: 75, SOL_LEND: 75, hSOL: 75, cbBTC: 75 };
export const PIN_STEP = 5;

export const SWITCH_LABEL = "Yield Manager";
/** R178: the one line under the Yield Manager heading on Rules. */
export const MANAGER_LINE = "Moves new change toward the coins paying more. Never sells what you hold.";
export const STOP_LINE = "Careful keeps at least 50% in SKR, Balanced 35%, Bold 25%.";
export const UNDONE_TEXT = "Yesterday's split is back. The Yield Manager is off until you turn it on.";
export const SPLIT_SECTION = { title: "Your split", sub: "Each time the split changed, by the Yield Manager or by you.", empty: "No change yet." } as const;
export const STORE_ROW_NOTE = "ORE staked in ORE's program";

export type Row = { asset: LiveAsset; pct: number; mode: "auto" | "off" | "pinned" | "the rest"; bound: string | null };
export type RulesView = { managed: boolean; stop: Stop; pins: Pins; allocation: Split };

/** One row per coin. Off: pins are the split and SKR is the rest. On (R346): a coin the user switched off (a 0 pin) reads "off"; every other row shows
 * `preview` (the draft's split, from `managedPreview`) or the saved allocation, with the stop's bound. An old non-zero pin reads as on. */
export function splitRows(r: RulesView, preview?: Split): Row[] {
  if (!r.managed) {
    const pinned = NON_SKR.reduce((s, c) => s + (r.pins[c] ?? 0), 0);
    return ASSETS.map((asset) =>
      asset === "SKR" ? { asset, pct: 100 - pinned, mode: "the rest", bound: null } : { asset, pct: r.pins[asset] ?? 0, mode: "pinned", bound: null },
    );
  }
  return ASSETS.map((asset) => {
    if (asset !== "SKR" && r.pins[asset] === 0) return { asset, pct: 0, mode: "off", bound: null };
    const bound = asset === "SKR" ? `at least ${STOP_FLOOR[r.stop]}%` : `at most ${STOP_MAX[r.stop][asset]}%`;
    return { asset, pct: (preview ?? r.allocation)[asset], mode: "auto", bound };
  });
}

/** The caption beside a split row's percent (his note 5): nothing while the manager is off (every row is the user's own); on, "pinned", or the manager's bound, or nothing. */
export function modeWord(row: { mode: string; bound: string | null }, managed: boolean): string {
  if (!managed) return "";
  if (row.mode === "pinned") return "pinned";
  return row.bound ?? "";
}

/** R346: with the manager on, the only pins are 0 pins (the coins switched off); an old non-zero pin from before R346 becomes "on" at the next save. */
export function managedPins(pins: Pins): Pins {
  const next: Pins = {};
  for (const c of NON_SKR) if (pins[c] === 0) next[c] = 0;
  return next;
}

/** R346: switch a coin on (the manager may buy it) or off (a 0 pin: never). SKR stays on (its floor). */
export function setCoinOn(pins: Pins, asset: LiveAsset, on: boolean): Pins {
  const next = managedPins(pins);
  if (asset === "SKR") return next;
  if (on) delete next[asset];
  else next[asset] = 0;
  return next;
}

/**
 * The split the API will compute for the draft (api/src/domain/split.ts effectiveSplit, managed, 0 pins only): the stop split's weights over the coins
 * left on, clamped to the stop maxes with the excess poured into coins with room and SKR last, SKR raised to the floor, rounded to 100.
 * A preview only: the API's answer replaces it at save; tests/model/manager-preview.test.ts checks it against the API's function.
 */
export function managedPreview(stopSplit: Split, pins: Pins, stop: Stop): Split {
  const off = new Set(NON_SKR.filter((c) => pins[c] === 0));
  const free = ASSETS.filter((c) => !off.has(c as NonSkr));
  const bound = (c: LiveAsset) => (c === "SKR" ? Infinity : STOP_MAX[stop][c as NonSkr]);
  const x = Object.fromEntries(ASSETS.map((c) => [c, 0])) as Record<LiveAsset, number>;
  const weight = free.reduce((s, c) => s + stopSplit[c], 0);
  for (const c of free) x[c] = weight > 0 ? (stopSplit[c] / weight) * 100 : c === "SKR" ? 100 : 0;
  let excess = 0;
  for (const c of free) if (c !== "SKR" && x[c] > bound(c)) { excess += x[c] - bound(c); x[c] = bound(c); }
  let room = free.filter((c) => c !== "SKR" && x[c] < bound(c) - 1e-9);
  while (excess > 1e-9 && room.length) {
    const total = room.reduce((s, c) => s + bound(c) - x[c], 0);
    const pour = Math.min(excess, total);
    for (const c of room) x[c] += (pour * (bound(c) - x[c])) / total;
    excess -= pour;
    room = room.filter((c) => x[c] < bound(c) - 1e-9);
  }
  if (excess > 1e-9) x.SKR += excess;
  const floor = STOP_FLOOR[stop];
  if (x.SKR < floor) {
    let left = floor - x.SKR;
    for (const c of free.filter((d) => d !== "SKR").sort((p, q) => x[q] - x[p])) {
      if (left <= 0) break;
      const take = Math.min(x[c], left);
      x[c] -= take;
      left -= take;
      x.SKR += take;
    }
  }
  const out = Object.fromEntries(ASSETS.map((c) => [c, Math.floor(x[c])])) as Split;
  const used = ASSETS.reduce((s, c) => s + out[c], 0);
  const order = [...ASSETS].sort((p, q) => x[q] - out[q] - (x[p] - out[p]));
  for (let i = 0; i < 100 - used; i++) out[order[i % order.length]] += 1;
  return out;
}

/** Move a pin by PIN_STEP inside 0 and the coin's pin max. */
export function stepPin(pins: Pins, asset: LiveAsset, dir: 1 | -1): Pins {
  const current = pins[asset] ?? 0;
  const next = Math.max(0, Math.min(PIN_MAX[asset], current + dir * PIN_STEP));
  return { ...pins, [asset]: next };
}

/** Whether a pin's "+" may move it up by PIN_STEP, mirroring the API's validatePins in both modes: the coin's pin max; with SKR pinned, a total of at most 100;
 * else the pins must leave SKR its floor (the stop's when on, MANUAL_FLOOR when off). */
export function canStepUp(r: RulesView, asset: LiveAsset): boolean {
  const current = r.pins[asset] ?? 0;
  if (current + PIN_STEP > PIN_MAX[asset]) return false;
  const floor = r.managed ? STOP_FLOOR[r.stop] : MANUAL_FLOOR;
  const total = (Object.values(r.pins) as number[]).reduce((s, v) => s + (v ?? 0), 0);
  const next = total + PIN_STEP;
  if (r.pins.SKR !== undefined || asset === "SKR") return next <= 100;
  return next <= 100 - floor;
}

/** The pins when the switch flips on (R346): every coin starts on. The off-mode pins were a manual split; a 0 among them meant "nothing" (SKR was the rest), not "never". */
export function pinsForOn(_pins: Pins): Pins {
  return {};
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
  if (s.by === "undo") return `${day}, undone. Yesterday's split is back; the Yield Manager is off.`;
  if (s.by === "you" && s.turnedOn) return `${day}, you: ${s.stop ? `${STOP_LABEL[s.stop as Stop] ?? s.stop}, ` : ""}on.`;
  if (s.by === "you") return summary ? `${day}, you: ${summary}.` : `${day}, you: ${s.stop ? STOP_LABEL[s.stop as Stop] ?? s.stop : "saved"}.`;
  if (s.fallback) return `${day}, chosen by rule today: ${summary}.`;
  return `${day}, ${summary}.${s.why ? ` ${s.why}` : ""}`;
}
