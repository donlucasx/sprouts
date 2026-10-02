import { formatUsd } from "./format";

/** The daily planting job runs at 14:00 UTC (R164). */
const RUN_HOUR_UTC = 14;

export type NextPlantingRow = {
  state: "first" | "usual" | "reached" | "empty";
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

/** Home's progress row (R164). Precedence: threshold reached, then nothing saved, then before the first planting, then usual. */
export function nextPlantingRow(p: { pendingCents: number; thresholdCents: number; hasPlant: boolean; now: Date }): NextPlantingRow {
  const { pendingCents: pending, thresholdCents: threshold } = p;
  const fraction = threshold > 0 ? Math.min(1, Math.max(0, pending / threshold)) : 0;
  const of = `${formatUsd(pending)} of ${formatUsd(threshold)}`;
  if (pending >= threshold) return { state: "reached", label: "Next planting", value: nextRunLabel(p.now), fraction: 1 };
  if (pending <= 0) return { state: "empty", label: "Next planting", value: of, fraction: 0 };
  if (!p.hasPlant) return { state: "first", label: "First planting", value: of, fraction };
  return { state: "usual", label: "Next planting", value: of, fraction };
}
