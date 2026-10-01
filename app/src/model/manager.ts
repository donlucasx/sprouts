import { ASSETS } from "@/lib/api";
import type { Asset, Pins, Split, SplitRow, Stop } from "@/lib/api";
import { dayLabel, shareLine } from "@/lib/format";

/**
 * The Yield Manager as the app shows it (spec 3.1, 3.2). Pure. The tables mirror spec 4.1 for labels and stepper bounds only:
 * the API enforces them and answers with its own copy when a save breaks one.
 */
type NonSkr = Exclude<Asset, "SKR">;
const NON_SKR: readonly NonSkr[] = ["stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const;

export const STOP_LABEL: Record<Stop, string> = { careful: "Careful", balanced: "Balanced", bold: "Bold" };
export const STOP_FLOOR: Record<Stop, number> = { careful: 50, balanced: 35, bold: 25 };
export const STOP_MAX: Record<Stop, Record<NonSkr, number>> = {
  careful: { stORE: 5, hSOL: 15, JitoSOL: 15, JupSOL: 15, cbBTC: 30 },
  balanced: { stORE: 10, hSOL: 25, JitoSOL: 25, JupSOL: 25, cbBTC: 25 },
  bold: { stORE: 20, hSOL: 35, JitoSOL: 35, JupSOL: 35, cbBTC: 20 },
};
export const MANUAL_FLOOR = 25;
export const PIN_MAX: Record<Asset, number> = { SKR: 100, stORE: 50, hSOL: 75, JitoSOL: 75, JupSOL: 75, cbBTC: 75 };
export const PIN_STEP = 5;

export const SWITCH_LABEL = "Yield Manager";
export const OFF_TEXT = "Sprouts can choose how new change is split across six coins, inside limits you set. Nothing you hold is ever sold.";
export const ON_TEXT = "Sprouts chooses the split each day inside these limits. Pin a coin to fix its share. Nothing you hold is ever sold.";
export const STOP_LINE = "Careful keeps at least 50% in SKR, Balanced 35%, Bold 25%.";
export const UNDONE_TEXT = "Yesterday's split is back. The Yield Manager is off until you turn it on.";
export const SPLIT_SECTION = { title: "Your split", sub: "Each time the split changed, by the Yield Manager or by you.", empty: "No change yet." } as const;
export const STORE_ROW_NOTE = "ORE staked in ORE's program";

export type Row = { asset: Asset; pct: number; mode: "auto" | "pinned" | "the rest"; bound: string | null };
export type RulesView = { managed: boolean; stop: Stop; pins: Pins; allocation: Split };

/** One row per coin. Off: pins are the split and SKR is the rest. On: pinned rows show the pin, free rows show the allocation with the stop's bound. */
export function splitRows(r: RulesView): Row[] {
  if (!r.managed) {
    const pinned = NON_SKR.reduce((s, c) => s + (r.pins[c] ?? 0), 0);
    return ASSETS.map((asset) =>
      asset === "SKR" ? { asset, pct: 100 - pinned, mode: "the rest", bound: null } : { asset, pct: r.pins[asset] ?? 0, mode: "pinned", bound: null },
    );
  }
  return ASSETS.map((asset) => {
    const pin = r.pins[asset];
    if (pin !== undefined) return { asset, pct: pin, mode: "pinned", bound: null };
    const bound = asset === "SKR" ? `at least ${STOP_FLOOR[r.stop]}%` : `at most ${STOP_MAX[r.stop][asset]}%`;
    return { asset, pct: r.allocation[asset], mode: "auto", bound };
  });
}

/** Pin a coin at the percent its row shows, or release it. */
export function togglePin(pins: Pins, asset: Asset, on: boolean, currentPct: number): Pins {
  const next: Pins = { ...pins };
  if (on) next[asset] = currentPct;
  else delete next[asset];
  return next;
}

/** Move a pin by PIN_STEP inside 0 and the coin's pin max. */
export function stepPin(pins: Pins, asset: Asset, dir: 1 | -1): Pins {
  const current = pins[asset] ?? 0;
  const next = Math.max(0, Math.min(PIN_MAX[asset], current + dir * PIN_STEP));
  return { ...pins, [asset]: next };
}

/** The pins to carry when the switch flips on: a 0 pin while off meant "nothing" (SKR was the rest), and carried into on-mode it would stop the manager from ever buying that coin. */
export function pinsForOn(pins: Pins): Pins {
  const next: Pins = {};
  for (const [a, v] of Object.entries(pins) as [Asset, number][]) if (v > 0) next[a] = v;
  return next;
}

/** The clauses the plain sentence on Rules gains (spec 3.1): the manager when on, then one share line per non-SKR pin. */
export function managerSentence(r: RulesView): string {
  const parts: string[] = [];
  if (r.managed) parts.push(`The Yield Manager splits new change across six coins, ${STOP_LABEL[r.stop]}.`);
  for (const c of NON_SKR) if ((r.pins[c] ?? 0) > 0) parts.push(shareLine(c, r.pins[c] as number));
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/** "Changed {Mon D}." (F4: labelled by the day the manager changed the split, gated by undoAvailable). */
export function undoLine(changedDay: string | null): string | null {
  return changedDay ? `Changed ${dayLabel(changedDay)}.` : null;
}

/** "hSOL 15 to 20, cbBTC 10 to 5": every coin that moved, in the registry's order. */
export function changeSummary(from: Split, to: Split): string {
  return ASSETS.filter((a) => from[a] !== to[a]).map((a) => `${a} ${from[a]} to ${to[a]}`).join(", ");
}

const rowDay = (ts: string) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** One Activity row (spec 3.2). */
export function splitRowLine(s: SplitRow): string {
  const day = rowDay(s.ts);
  const summary = changeSummary(s.from, s.to);
  if (s.by === "undo") return `${day}, undone. Yesterday's split is back; the Yield Manager is off.`;
  if (s.by === "you") return summary ? `${day}, you: ${summary}.` : `${day}, you: ${s.stop ? STOP_LABEL[s.stop as Stop] ?? s.stop : "saved"}.`;
  if (s.fallback) return `${day}, chosen by rule today: ${summary}.`;
  return `${day}, ${summary}.${s.why ? ` ${s.why}` : ""}`;
}
