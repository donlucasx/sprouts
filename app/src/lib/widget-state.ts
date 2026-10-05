import { formatUsd } from "./format";
import { nextPlantingFor, nextRunClock } from "./next-planting";
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
