import { formatUsd } from "./format";
import { nextPlantingFor, nextRunClock, nextRunWords } from "./next-planting";
import { watcherLine } from "@/model/watcher";
import type { MeResponse } from "./api";
import type { Scene } from "@/model/garden";

/** The widget's one state line (R363), and whether it is the call to act (drawn in the accent green). */
export type WidgetState = { text: string; action: boolean };

export const BUD_LINE = "A bud is ready. Water it.";

/**
 * R363 (10-05, "Value + the one thing to do"): ONE line that invites a tap, decided from Home's own state so the two never disagree:
 * a bud waiting (Home's can in colour, watcherLine) -> "A bud is ready. Water it."; else Home's Next planting row (nextPlantingFor):
 * paused -> "Paused"; change saved below the threshold -> "+$1.35 waiting"; the threshold reached, waiting for the run -> its clock,
 * "Next: 7 AM" (Home: "Tomorrow, 7 AM"). Nothing saved yet (Claude's call; the ruling names no line for it) -> "No change waiting yet".
 */
export function widgetStateLine(me: Pick<MeResponse, "nextPlanting" | "wallets">, scene: Pick<Scene, "parts" | "unrevealed">, now: Date): WidgetState {
  if (watcherLine({ unrevealed: scene.unrevealed, failed: false, nudged: false }).can === "ready") return { text: BUD_LINE, action: true };
  const row = nextPlantingFor(me, scene, now);
  switch (row.state) {
    case "paused": return { text: me.wallets.some((w) => w.status === "paused" && w.pause?.reason === "no_usdc") ? "Wallet needs USDC" : "Paused", action: false };
    case "saving": return { text: `+${formatUsd(me.nextPlanting.pendingCents)} waiting`, action: false };
    case "reached": return { text: `Next: ${nextRunClock(now)}`, action: false };
    case "empty": return { text: "No change waiting yet", action: false };
  }
}

/** A planting this recent leads the widget ("Planted $0.82"): the widget keeps no memory of what it drew, so a clock decides. */
export const PLANTED_RECENT_MS = 24 * 60 * 60 * 1000;
/** Garden2's three lines (10-11, after Kimi's analysis): the headline (one small bold line), the line under it and its accent, the bottom
 *  line, and the bar's fill (null: no bar). */
export type WidgetHeadline = { big: string; label: string; line: string; fraction: number | null; action: boolean };
type Fit = (text: string) => boolean;

/**
 * Garden2 (his notes 10-11: "seeing $0.00 alone up there is not very inviting"; "too big 'swap to save', plus not the right kind of cta";
 * Kimi's widget analysis, ~/Documents/kimi/sprouts-widget-2026-10-11/WIDGET-ANALYSIS.md): the widget reports, it never asks for a swap (it
 * cannot do one, and neither can Sprouts). One small headline about the user's money, never "$0.00"; the bottom line is the fact the
 * headline leaves out. From Home's Next planting row (nextPlantingFor), so the two never disagree:
 * paused -> "Round-ups paused" / open to turn on (accent) / the total; reached -> "$2.15 saved" / when it plants / the total, bar full;
 * saving -> "$1.35 of $2.00" / "rounds up from every swap" / the total, bar; nothing pending after a planting in the last day ->
 * "Planted $0.82" / the total / "Waiting for your next swap"; nothing pending, money in the garden -> the total / "Waiting for your next
 * swap" / what plants; nothing yet -> "Your garden" / "Waiting for your first swap" / what plants.
 * Each text lists its forms longest first; a narrow widget takes the first that fits, else the last.
 */
export function widgetHeadline(
  me: Pick<MeResponse, "nextPlanting" | "wallets"> & { history?: Pick<MeResponse["history"], "plantings"> },
  scene: Pick<Scene, "parts">, now: Date, total: string, hasMoney: boolean,
  fits: { big?: Fit; label?: Fit; line?: Fit } = {},
): WidgetHeadline {
  const row = nextPlantingFor(me, scene, now), pending = Math.max(0, me.nextPlanting.pendingCents);
  const goal = formatUsd(me.nextPlanting.thresholdCents);
  const pick = (f: Fit | undefined, texts: string[]) => texts.find((t) => (f ?? (() => true))(t)) ?? texts[texts.length - 1];
  const big = (...t: string[]) => pick(fits.big, t), label = (...t: string[]) => pick(fits.label, t), line = (...t: string[]) => pick(fits.line, t);
  const inGarden = line(`${total} in your garden`, `${total} in garden`);
  const plantsAt = line(`Round-ups plant at ${goal}`, `Plants at ${goal}`);
  switch (row.state) {
    case "paused":
      // 10-26 copy review row 7: a pause for want of USDC asks for USDC in the wallet; the user's own pause keeps its words
      if (me.wallets.some((w) => w.status === "paused" && w.pause?.reason === "no_usdc"))
        return { big: big("Paused: wallet needs USDC", "Wallet needs USDC", "Needs USDC"), label: label("Open Sprouts to top up your wallet", "Open to top up"), line: inGarden, fraction: null, action: true };
      return { big: big("Round-ups paused", "Paused"), label: label("Open Sprouts to turn them on", "Open to turn on"), line: inGarden, fraction: null, action: true };
    case "reached": return { big: big(`${formatUsd(pending)} saved`, formatUsd(pending)), label: label(`plants ${nextRunWords(now)}`, `plants ${nextRunClock(now)}`), line: inGarden, fraction: 1, action: false };
    case "saving": return { big: big(`${formatUsd(pending)} of ${goal}`, formatUsd(pending)), label: label("rounds up from every swap", "from your swaps", "from swaps"), line: inGarden, fraction: row.fraction, action: false };
    case "empty": {
      const recent = (me.history?.plantings ?? []).filter((p) => { const t = Date.parse(p.ts); return t <= now.getTime() && now.getTime() - t < PLANTED_RECENT_MS; });
      const planted = recent.reduce((c, p) => c + p.usdcInCents, 0);
      if (planted > 0) return { big: big(`Planted ${formatUsd(planted)}`, formatUsd(planted)), label: label(`${total} in your garden`, `${total} in garden`), line: line("Waiting for your next swap", "No change waiting yet", "No change yet"), fraction: null, action: false };
      if (hasMoney) return { big: big(`${total} in your garden`, total), label: label("Waiting for your next swap", "No change waiting yet", "No change yet"), line: plantsAt, fraction: null, action: false };
      return { big: "Your garden", label: label("Waiting for your first swap", "No change yet"), line: plantsAt, fraction: null, action: false };
    }
  }
}
