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

// ---- Infra lights ----

/** Ruling R2: Pyth sponsored-feed access ends here; the Prices light shows the countdown. */
export const PYTH_ACCESS_ENDS = new Date("2026-12-31T23:59:59Z");

export function swapWatchingLight(input: { linked: string[]; onWebhook: string[] }): Light {
  const mk = (state: LightState, fact: string): Light => ({ key: "swapWatching", label: "Swap watching", state, fact });
  const linked = [...new Set(input.linked)];
  if (linked.length === 0) return mk("info", "no linked wallets to watch");
  const watched = new Set(input.onWebhook);
  const missing = linked.filter((w) => !watched.has(w)).length; // count only, never addresses
  if (missing > 0) return mk("red", `${missing} linked wallet${missing === 1 ? "" : "s"} not watched`);
  return mk("green", `all ${linked.length} linked wallet${linked.length === 1 ? "" : "s"} on the webhook`);
}

export function swapsArrivingLight(input: { now: Date; linkedCount: number; lastSwapAt: Date | null; unpriced24h: number }): Light {
  const mk = (state: LightState, fact: string): Light => ({ key: "swapsArriving", label: "Swaps arriving", state, fact });
  const { now, linkedCount, lastSwapAt, unpriced24h } = input;
  if (linkedCount === 0) return mk("info", "no linked wallets, so no swaps expected");
  if (!lastSwapAt) return mk("red", `no swap ever recorded with ${linkedCount} linked`);
  const age = now.getTime() - lastSwapAt.getTime();
  if (age < 0) return mk("unknown", "latest swap time is in the future (clock skew?)");
  const fact = `last swap ${ageText(age)} ago, ${unpriced24h} unpriced in 24 h`;
  if (age > 72 * HOUR) return mk("red", fact);
  if (age > 24 * HOUR || unpriced24h > 0) return mk("amber", fact);
  return mk("green", fact);
}

const PRICE_RED_MS = 15 * MIN;
const PRICE_AHEAD_MS = 60_000; // publish time may run slightly ahead of our clock

export function pricesLight(input: {
  now: Date;
  feeds: { name: "SOL" | "cbBTC" | "ORE"; publishTime: Date; maxAgeS: number }[];
  skr: "ok" | "failed" | "no-key";
  accessEnds: Date;
}): Light {
  const { now, feeds, skr, accessEnds } = input;
  const days = Math.max(0, Math.ceil((accessEnds.getTime() - now.getTime()) / DAY));
  const countdown = `${days} days of Pyth access left`;
  const mk = (state: LightState, fact: string): Light => ({ key: "prices", label: "Prices", state, fact: `${fact}; ${countdown}` });

  const red: string[] = [];
  const amber: string[] = [];
  const unknown: string[] = [];
  for (const f of feeds) {
    let age = now.getTime() - f.publishTime.getTime();
    if (age < 0) {
      if (age < -PRICE_AHEAD_MS) { unknown.push(`${f.name} publish time is in the future`); continue; }
      age = 0;
    }
    if (age > PRICE_RED_MS) red.push(`${f.name} ${ageText(age)} old`);
    else if (age > f.maxAgeS * 1000) amber.push(`${f.name} ${ageText(age)} old`);
  }
  if (skr === "failed") red.push("SKR fetch failed");
  const skrNote = skr === "no-key" ? "SKR deferred (no PYTH_API_KEY)" : null;
  const withNote = (parts: string[]) => [...parts, ...(skrNote ? [skrNote] : [])].join("; ");

  if (red.length) return mk("red", withNote(red));
  if (feeds.length === 0) return mk("unknown", withNote(["no push feeds were checked"]));
  if (unknown.length) return mk("unknown", withNote(unknown));
  if (amber.length) return mk("amber", withNote(amber));
  const ok = `${feeds.map((f) => f.name).join(", ")} fresh`;
  return mk("green", skr === "ok" ? `${ok}, SKR ok` : withNote([ok]));
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

export function gasLight(input: { lamports: bigint }): Light {
  const { lamports } = input;
  const shown = (Number(lamports) / 1e9).toFixed(3);
  const fact = `puller holds ${shown} SOL`;
  const mk = (state: LightState): Light => ({ key: "gas", label: "Gas", state, fact });
  if (lamports > LAMPORTS_PER_SOL / 2n) return mk("green");
  if (lamports >= LAMPORTS_PER_SOL / 10n) return mk("amber");
  return mk("red");
}

/** `names` (optional) labels each leg by index; without it the fact says "leg N" (1-based). */
export function programLight(input: { enabled: boolean[]; expected: boolean[]; leashLive: boolean; names?: string[] }): Light {
  const { enabled, expected, leashLive, names } = input;
  const live = `LEASH_LIVE=${leashLive}`;
  const mk = (state: LightState, fact: string): Light => ({ key: "program", label: "Program", state, fact });
  if (expected.length === 0) return mk("unknown", `no expected legs to compare, ${live}`);
  if (enabled.length !== expected.length) return mk("red", `${enabled.length} legs read, ${expected.length} expected, ${live}`);
  const differ = expected.flatMap((e, i) => (enabled[i] !== e ? [i] : []));
  if (differ.length) {
    const who = names ? differ.map((i) => names[i] ?? `leg ${i + 1}`).join(", ") : `leg ${differ.map((i) => i + 1).join(", ")}`;
    return mk("red", `${who} differ${differ.length === 1 ? "s" : ""} from expected, ${live}`);
  }
  return mk("green", `all ${expected.length} legs match, ${live}`);
}

export function supportLight(input: { now: Date; count7d: number; newestAt: Date | null }): Light {
  const { now, count7d, newestAt } = input;
  const plural = `${count7d} support message${count7d === 1 ? "" : "s"} in 7 d`;
  const fact = count7d === 0 ? plural : newestAt ? `${plural}, newest ${ageText(now.getTime() - newestAt.getTime())} ago` : plural;
  return { key: "support", label: "Support", state: "info", fact };
}
