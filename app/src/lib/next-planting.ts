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
  /** R466: Home's one line over the bar, "$1.20 saved · planted tomorrow morning" (the widget keeps `label` and `value`). */
  line: string;
};

/** "7 AM" on the hour, "7:30 AM" otherwise: the phone's own clock. */
function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 === 0 ? 12 : h % 12}${m === 0 ? "" : `:${String(m).padStart(2, "0")}`} ${h < 12 ? "AM" : "PM"}`;
}

/** The job's next run after `now`, in the phone's time zone: "Today, 7 AM" when it is later today there, else "Tomorrow, 7 AM". */
function nextRun(now: Date): Date {
  const run = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_HOUR_UTC));
  if (run.getTime() <= now.getTime()) run.setUTCDate(run.getUTCDate() + 1);
  return run;
}
/** The job's next run as the phone's clock alone, "7 AM": the widget's short form of nextRunLabel (R363, "Next: 7 AM"). */
export const nextRunClock = (now: Date): string => clock(nextRun(now));
/** R466: when the next run lands in the phone's words, "tomorrow morning" (7 AM in California; the part of day follows the clock elsewhere). */
export function nextRunWords(now: Date): string {
  const run = nextRun(now);
  const sameDay = run.getFullYear() === now.getFullYear() && run.getMonth() === now.getMonth() && run.getDate() === now.getDate();
  const h = run.getHours();
  const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
  return sameDay ? (part === "evening" ? "tonight" : `this ${part}`) : `tomorrow ${part}`;
}
export function nextRunLabel(now: Date): string {
  const run = nextRun(now);
  const sameDay = run.getFullYear() === now.getFullYear() && run.getMonth() === now.getMonth() && run.getDate() === now.getDate();
  return `${sameDay ? "Today" : "Tomorrow"}, ${clock(run)}`;
}

/** Home's progress row (R164). Two independent axes: the label follows whether any planting exists; the value and bar follow the amount saved. */
export function nextPlantingRow(p: { pendingCents: number; thresholdCents: number; hasPlant: boolean; now: Date; paused?: boolean }): NextPlantingRow {
  const { pendingCents: pending, thresholdCents: threshold } = p;
  const label = p.hasPlant ? "Next planting" : "First planting";
  // R466: the threshold left Rules, so Home names only what was saved and, once it is enough, when it is planted.
  const saved = `${formatUsd(Math.max(0, pending))} saved`;
  // His note 10-05: paused, the row says so instead of a run time; the bar keeps what was saved, dimmed (NextPlanting).
  if (p.paused) return { state: "paused", label, value: "Paused", fraction: Math.min(1, Math.max(0, pending) / Math.max(1, threshold)), line: `${saved} · paused` };
  if (pending >= threshold) return { state: "reached", label, value: nextRunLabel(p.now), fraction: 1, line: `${saved} · planted ${nextRunWords(p.now)}` };
  const of = `${formatUsd(Math.max(0, pending))} of ${formatUsd(threshold)}`;
  // R590 (10-10, his note: when it says "0.00 saved" "should it say something like waiting for the next swap"): nothing saved yet
  if (pending <= 0) return { state: "empty", label, value: of, fraction: 0, line: "Waiting for your next swap" };
  return { state: "saving", label, value: of, fraction: pending / threshold, line: saved };
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
/** The widget's one line, short enough for a 2-cell widget (his note 10-05: "Tomorrow, 7 ..." was cut): "Next: Tomorrow, 7 AM". */
export const nextPlantingText = (row: NextPlantingRow): string => `${row.label === "Next planting" ? "Next" : "First"}: ${row.value}`;
