// Ops dashboard lights: one pure function per light (inputs in, { state, fact } out). No I/O, no imports from @/lib.

export type LightState = "green" | "amber" | "red" | "unknown" | "info";
export type LightKey = "dailyRun" | "firstPlanting" | "swapWatching" | "swapsArriving" | "prices" | "gas" | "moneyOps" | "program" | "support";
export type Light = { key: LightKey; label: string; state: LightState; fact: string };

/** Skip reasons `plant-run.ts` emits that need no attention (confirmed against its `reason:` literals). */
export const BENIGN_SKIP_REASONS: readonly string[] = ["no usdc", "paused", "below threshold", "cap reached", "revoked", "relink needed", "not first"];

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type CronRunInput = { day: string; startedAt: Date; finishedAt: Date | null; ok: boolean | null; summary: Record<string, unknown> | null };
export type FailureInput = { kind: "pull_failed" | "withdraw_failed" | "move_failed" | "run_stopped"; ts: Date; resolved: boolean };

function ageText(ms: number): string {
  if (ms < HOUR) return `${Math.max(0, Math.round(ms / MIN))} min`;
  if (ms < 2 * DAY) return `${Math.round(ms / HOUR)} h`;
  return `${Math.round(ms / DAY)} d`;
}

const asObj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const lenOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** Summary sections that are null when a cron step threw. Absent (undefined) means not recorded: no effect (R3). */
const SECTIONS = ["venues", "coins", "splits", "applied", "moves", "planting", "withdrawals", "reconciled", "coverage"] as const;

export function dailyRunLight(input: { now: Date; latest: CronRunInput | null; movesEnabled: boolean }): Light {
  const { now, latest, movesEnabled } = input;
  const mk = (state: LightState, fact: string): Light => ({ key: "dailyRun", label: "Daily run", state, fact });
  if (!latest) return mk("red", "no daily run recorded");

  if (latest.ok === false) return mk("red", "last run failed");
  if (!latest.finishedAt) {
    const running = now.getTime() - latest.startedAt.getTime();
    return running > 10 * MIN ? mk("red", `started ${ageText(running)} ago and never finished`) : mk("amber", `running for ${ageText(running)}`);
  }
  const since = now.getTime() - latest.finishedAt.getTime();
  if (since > 26 * HOUR) return mk("red", `last run finished ${ageText(since)} ago`);
  if (latest.ok !== true) return mk("red", "last run finished without ok = true");
  if (latest.summary === null) return mk("amber", "run finished but recorded no summary");

  const s = latest.summary;
  // Red: null coverage or withdrawals.
  const redNull = (["coverage", "withdrawals"] as const).filter((k) => s[k] === null);
  if (redNull.length) return mk("red", `step failed: ${redNull.join(", ")}`);

  const amber: string[] = [];
  const failedSteps = SECTIONS.filter((k) => k !== "coverage" && k !== "withdrawals" && s[k] === null && !(k === "moves" && !movesEnabled));
  if (failedSteps.length) amber.push(`step failed: ${failedSteps.join(", ")}`);

  const skippedRaw = asObj(s.planting)?.skipped;
  const skipped = Array.isArray(skippedRaw) ? skippedRaw : [];
  const bad = [...new Set(skipped.map((e) => String(asObj(e)?.reason ?? "unknown")).filter((r) => !BENIGN_SKIP_REASONS.includes(r)))];
  if (bad.length) amber.push(`skipped: ${bad.join(", ")}`);

  const failedW = lenOf(asObj(s.withdrawals)?.failed);
  if (failedW) amber.push(`${failedW} withdrawal(s) failed`);
  const adjusted = lenOf(asObj(s.reconciled)?.adjusted);
  if (adjusted) amber.push(`${adjusted} stake(s) adjusted by reconcile`);
  const repaired = lenOf(asObj(s.coverage)?.repaired);
  if (repaired) amber.push(`${repaired} wallet(s) re-added to the webhook`);

  if (amber.length) return mk("amber", amber.join("; "));
  return mk("green", `finished ${ageText(since)} ago, all steps ok`);
}

export function firstPlantingLight(input: { now: Date; lastRunAt: Date | null }): Light {
  const mk = (state: LightState, fact: string): Light => ({ key: "firstPlanting", label: "First planting", state, fact });
  if (!input.lastRunAt) return mk("red", "no hourly run recorded");
  const age = input.now.getTime() - input.lastRunAt.getTime();
  const fact = `last ran ${ageText(age)} ago`;
  if (age < 2 * HOUR) return mk("green", fact);
  if (age <= 6 * HOUR) return mk("amber", fact);
  return mk("red", fact);
}

const PENDING_LIMIT_MS = 60 * HOUR;

export function moneyOpsLight(input: { now: Date; failures: FailureInput[]; oldestPendingWithdrawalAt: Date | null }): Light {
  const { now } = input;
  const mk = (state: LightState, fact: string): Light => ({ key: "moneyOps", label: "Money ops", state, fact });
  const recent = input.failures.filter((f) => now.getTime() - f.ts.getTime() <= 7 * DAY);
  const last24 = recent.filter((f) => now.getTime() - f.ts.getTime() < DAY);
  const pending = input.oldestPendingWithdrawalAt ? now.getTime() - input.oldestPendingWithdrawalAt.getTime() : null;

  if (last24.length) return mk("red", `${last24.length} failure(s) in the last 24 h (${[...new Set(last24.map((f) => f.kind))].join(", ")})`);
  if (pending !== null && pending > PENDING_LIMIT_MS) return mk("red", `withdrawal pending ${ageText(pending)} (limit 60 h)`);
  if (recent.length) {
    const open = recent.filter((f) => !f.resolved).length;
    return mk("amber", `${recent.length} failure(s) in 7 d, ${open} unresolved`);
  }
  return mk("green", pending === null ? "no failures in 7 d, no withdrawal pending" : `no failures in 7 d, oldest withdrawal pending ${ageText(pending)}`);
}
