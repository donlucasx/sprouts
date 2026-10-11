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
    case "paused": return { text: "Paused", action: false };
    case "saving": return { text: `+${formatUsd(me.nextPlanting.pendingCents)} waiting`, action: false };
    case "reached": return { text: `Next: ${nextRunClock(now)}`, action: false };
    case "empty": return { text: "No change waiting yet", action: false };
  }
}

/** Garden2's headline: the change saved for the next planting (big), what it means or the call to act (label), and the bar's fill. */
export type WidgetHeadline = { big: string; label: string; fraction: number; action: boolean };

/**
 * Garden2 (his note 10-11: "showing 'next swap' data is more relevant than the total of the portfolio held. widget should act as a window
 * to the garden and also provide useful information that perhaps could drive the user to perform a swap/round up"): the widget leads with
 * Home's Next planting row (nextPlantingFor, so the two never disagree): the change saved, big; under it how far it is toward the next
 * planting, or, with nothing saved, the call to swap (drawn in the accent green); the bar is Home's fraction. Paused says so.
 */
export function widgetHeadline(me: Pick<MeResponse, "nextPlanting" | "wallets">, scene: Pick<Scene, "parts">, now: Date, fits: (label: string) => boolean = () => true): WidgetHeadline {
  const row = nextPlantingFor(me, scene, now), pending = Math.max(0, me.nextPlanting.pendingCents);
  const big = formatUsd(pending), goal = formatUsd(me.nextPlanting.thresholdCents);
  // each label longest first; a narrow widget takes the first that fits, else the last
  const pick = (labels: string[]) => labels.find(fits) ?? labels[labels.length - 1];
  switch (row.state) {
    case "paused": return { big, label: pick(["saved · paused", "paused"]), fraction: row.fraction, action: false };
    case "reached": return { big, label: pick([`saved · plants ${nextRunWords(now)}`, `plants ${nextRunClock(now)}`]), fraction: 1, action: false };
    case "saving": return { big, label: pick([`of ${goal} · swap to add more`, `of ${goal}`]), fraction: row.fraction, action: false };
    case "empty": return { big, label: pick(["Swap to round up your change", "Swap to round up", "Swap to save"]), fraction: 0, action: true };
  }
}
/** Garden2's bottom line (10-11): the whole garden's value, Home's number, under the painting; shorter where `fits` says the long one
 *  would wrap (a dense 2x2). */
export const widgetTotalLine = (total: string, fits: (text: string) => boolean = () => true): string =>
  fits(`${total} in your garden`) ? `${total} in your garden` : `${total} in garden`;
