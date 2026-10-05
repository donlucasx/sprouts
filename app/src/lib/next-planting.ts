import { formatUsd } from "./format";
import { pauseState } from "./me-state";
import type { MeResponse } from "./api";
import type { Scene } from "@/model/garden";

/** The daily planting job runs at 14:00 UTC (R164). */
const RUN_HOUR_UTC = 14;

export type NextPlantingRow = {
  /** The amount axis: nothing saved, saving toward the threshold, or threshold reached. */
  state: "empty" | "saving" | "reached" | "paused";
  label: "First planting" | "Next planting";
  value: string;
  /** 0 to 1, how far the saved change is toward the threshold. */
  fraction: number;
};

/** "7 AM" on the hour, "7:30 AM" otherwise: the phone's own clock. */
function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}${m === 0 ? "" : `:${String(m).padStart(2, "0")}`} ${h < 12 ? "AM" : "PM"}`;
}

/** The job's next run after `now`, in the phone's time zone: "Today, 7 AM" when it is later today there, else "Tomorrow, 7 AM". */
export function nextRunLabel(now: Date): string {
  const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_HOUR_UTC));
  if (run.getTime() <= now.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  const sameDay = run.getFullYear() === now.getFullYear() && run.getMonth() === now.getMonth() && run.getDate() === now.getDate();
  return `${sameDay ? "Today" : "Tomorrow"}, ${clock(run)}`;
}

/** Home's progress row (R164). Two independent axes: the label follows whether any planting exists; the value and bar follow the amount saved. */
export function nextPlantingRow(p: { pendingCents: number; thresholdCents: number; hasPlant: boolean; now: Date; paused?: boolean }): NextPlantingRow {
  const { pendingCents: pending, thresholdCents: threshold } = p;
  const label = p.hasPlant ? "Next planting" : "First planting";
  // His note 10-05: paused, the row says so instead of a run time; the bar keeps what was saved, dimmed (NextPlanting).
  if (p.paused) return { state: "paused", label, value: "Paused", fraction: Math.min(1, Math.max(0, pending) / Math.max(1, threshold)) };
  if (pending >= threshold) return { state: "reached", label, value: nextRunLabel(p.now), fraction: 1 };
  const of = `${formatUsd(Math.max(0, pending))} of ${formatUsd(threshold)}`;
  if (pending <= 0) return { state: "empty", label, value: of, fraction: 0 };
  return { state: "saving", label, value: of, fraction: pending / threshold };
}

/** The Next planting row from one read, Home's and the widget's alike (his note 10-05: the widget said "$1.35 of $0.10" where Home said
 * "Tomorrow, 7 AM"): paused while every linked wallet is paused (Home's switch), "Next planting" once the garden holds a plant. */
export function nextPlantingFor(me: Pick<MeResponse, "nextPlanting" | "wallets">, scene: Pick<Scene, "parts">, now: Date): NextPlantingRow {
  const pause = pauseState(me.wallets);
  return nextPlantingRow({
    pendingCents: me.nextPlanting.pendingCents,
    thresholdCents: me.nextPlanting.thresholdCents,
    hasPlant: scene.parts.some((p) => p.kind === "plant"),
    now,
    paused: pause.shown && !pause.on,
  });
}

/** The row as one line (the widget has no bar): "Next planting · Tomorrow, 7 AM". */
export const nextPlantingText = (row: NextPlantingRow): string => `${row.label} · ${row.value}`;
