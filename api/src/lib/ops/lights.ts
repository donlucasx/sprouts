// Ops dashboard lights: one pure function per light (inputs in, { state, fact } out). No I/O, no imports from @/lib.

export type LightState = "green" | "amber" | "red" | "unknown" | "info";
export type LightKey = "dailyRun" | "firstPlanting" | "swapWatching" | "swapsArriving" | "prices" | "gas" | "moneyOps" | "appErrors" | "amountsAddUp" | "program" | "support";
/** `action` is the "Do:" line: set on every amber/red/unknown light, never on green or info. */
export type Light = { key: LightKey; label: string; state: LightState; fact: string; action?: string };

export const LIGHT_LABELS: Record<LightKey, string> = {
  dailyRun: "Daily savings job",
  firstPlanting: "First savings for new users",
  swapWatching: "Swap watching",
  swapsArriving: "Swaps coming in",
  prices: "Price feeds",
  gas: "Network fee wallet",
  moneyOps: "Withdrawals and failures",
  appErrors: "App errors",
  amountsAddUp: "Amounts add up",
  program: "Savings settings",
  support: "Support inbox",
};

/** Builds a light's `mk`: label from LIGHT_LABELS, action attached only when given. */
const maker = (key: LightKey) => (state: LightState, fact: string, action?: string): Light => ({ key, label: LIGHT_LABELS[key], state, fact, ...(action ? { action } : {}) });

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Skip reasons `plant-run.ts` emits that need no attention (confirmed against its `reason:` literals). */
export const BENIGN_SKIP_REASONS: readonly string[] = ["no usdc", "paused", "below threshold", "cap reached", "revoked", "relink needed", "not first", "part in flight"];

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type CronRunInput = { day: string; startedAt: Date; finishedAt: Date | null; ok: boolean | null; summary: Record<string, unknown> | null };
export type FailureInput = { kind: "pull_failed" | "withdraw_failed" | "move_failed" | "run_stopped" | "remainder_unrecorded"; ts: Date; resolved: boolean };

/** Plain words for a duration ("14 minutes", "26 hours", "1 day"). Thresholds are unchanged from the old min/h/d text. */
function ageText(ms: number): string {
  if (ms < HOUR) return plural(Math.max(0, Math.round(ms / MIN)), "minute");
  if (ms < 2 * DAY) return plural(Math.round(ms / HOUR), "hour");
  return plural(Math.round(ms / DAY), "day");
}

const asObj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const lenOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/** Summary sections that are null when a cron step threw. Absent (undefined) means not recorded: no effect (R3). */
// Audit F1: `remainders` (the retry of unrecorded leftover change) is one too; its still-missing count is Money ops' to show, not this light's.
const SECTIONS = ["venues", "coins", "splits", "applied", "moves", "planting", "withdrawals", "reconciled", "coverage", "remainders"] as const;

export function dailyRunLight(input: { now: Date; latest: CronRunInput | null; movesEnabled: boolean }): Light {
  const { now, latest, movesEnabled } = input;
  const mk = maker("dailyRun");
  const ASK = "Ask Claude to check the daily job.";
  if (!latest) return mk("red", "The daily job has never run", ASK);

  if (latest.ok === false) return mk("red", "The last daily job failed", ASK);
  if (!latest.finishedAt) {
    const running = now.getTime() - latest.startedAt.getTime();
    return running > 10 * MIN
      ? mk("red", `The daily job started ${ageText(running)} ago and got stuck`, ASK)
      : mk("amber", `The daily job is running now (${ageText(running)} so far)`, "Nothing. Check again in 10 minutes.");
  }
  const since = now.getTime() - latest.finishedAt.getTime();
  if (since > 26 * HOUR) return mk("red", `The daily job has not run for ${ageText(since)}`, ASK);
  if (latest.ok !== true) return mk("red", "The last daily job did not finish cleanly", ASK);
  if (latest.summary === null) return mk("amber", "The last run finished but left no report", "Ask Claude; probably harmless.");

  const s = latest.summary;
  // Red: null coverage or withdrawals.
  const redNull = (["coverage", "withdrawals"] as const).filter((k) => s[k] === null);
  if (redNull.length) return mk("red", `A required part failed: ${redNull.map((k) => (k === "withdrawals" ? "withdrawal handling" : "the wallet-watcher check")).join(" and ")}`, ASK);

  // urgency: a higher number wins the single Do line when several amber reasons combine (no contradictory advice).
  const amber: { fact: string; action: string; urgency: number }[] = [];
  const failedSteps = SECTIONS.filter((k) => k !== "coverage" && k !== "withdrawals" && s[k] === null && !(k === "moves" && !movesEnabled));
  if (failedSteps.length) amber.push({ fact: `${failedSteps.length === 1 ? "One part" : "Some parts"} of the job failed (${failedSteps.join(", ")}); the rest ran`, action: "Ask Claude what this part does.", urgency: 1 });

  const skippedRaw = asObj(s.planting)?.skipped;
  const skipped = Array.isArray(skippedRaw) ? skippedRaw : [];
  const bad = [...new Set(skipped.map((e) => String(asObj(e)?.reason ?? "unknown")).filter((r) => !BENIGN_SKIP_REASONS.includes(r)))];
  if (bad.length) amber.push({ fact: `Some users were skipped: ${bad.join(", ")}`, action: "Ask Claude if this keeps showing up.", urgency: 1 });

  const failedW = lenOf(asObj(s.withdrawals)?.failed);
  if (failedW) amber.push({ fact: `${plural(failedW, "withdrawal")} failed in the last run`, action: "Ask Claude to check them today.", urgency: 2 });
  const repaired = lenOf(asObj(s.coverage)?.repaired);
  if (repaired) amber.push({ fact: `${plural(repaired, "wallet")} fell off the swap watcher and ${repaired === 1 ? "was" : "were"} re-added`, action: "Nothing, it fixed itself. Ask Claude if it repeats.", urgency: 0 });

  if (amber.length) return mk("amber", amber.map((a) => a.fact).join("; "), amber.reduce((best, a) => (a.urgency > best.urgency ? a : best)).action);
  // reconciled.adjusted is routine (14-27 a day in production): it never turns the light amber, it only rides on the green fact.
  const adjusted = lenOf(asObj(s.reconciled)?.adjusted);
  const note = adjusted ? ` (routine cleanup corrected ${plural(adjusted, "saved amount")})` : "";
  return mk("green", `Ran ${ageText(since)} ago, everything fine${note}`);
}

export function firstPlantingLight(input: { now: Date; lastRunAt: Date | null; reasons?: Record<string, number> }): Light {
  const mk = maker("firstPlanting");
  const RESTART = "Ask Claude to check the hourly job.";
  if (!input.lastRunAt) return mk("red", "No hourly run recorded since the last deploy", "Nothing yet if you just deployed; it runs every hour. Ask Claude if it is still red in 2 hours.");
  const age = input.now.getTime() - input.lastRunAt.getTime();
  if (age < 2 * HOUR) {
    const bad = Object.entries(input.reasons ?? {}).filter(([r]) => !BENIGN_SKIP_REASONS.includes(r));
    if (bad.length) return mk("amber", `Ran ${ageText(age)} ago, but skipped some users: ${bad.map(([r, n]) => `${r} (${n})`).join(", ")}`, "Ask Claude what this reason means.");
    return mk("green", `Ran ${ageText(age)} ago, new users get their first saving`);
  }
  if (age <= 6 * HOUR) return mk("amber", `Last ran ${ageText(age)} ago; it should run every hour`, "Ask Claude if it is still amber later today.");
  return mk("red", `Has not run for ${ageText(age)}; new users are not getting their first saving`, RESTART);
}

const PENDING_LIMIT_MS = 60 * HOUR;

const FAILURE_WORDS: Record<FailureInput["kind"], string> = {
  pull_failed: "could not collect a round-up",
  withdraw_failed: "a withdrawal failed",
  move_failed: "a coin move failed",
  run_stopped: "the daily job stopped early",
  remainder_unrecorded: "a user's leftover change wasn't recorded",
};

export function moneyOpsLight(input: { now: Date; failures: FailureInput[]; oldestPendingWithdrawalAt: Date | null }): Light {
  const { now } = input;
  const mk = maker("moneyOps");
  // Audit F1: an unrecorded remainder stays in view for its 14-day retry window; every other kind for 7 days.
  const windowOf = (k: FailureInput["kind"]) => (k === "remainder_unrecorded" ? 14 : 7) * DAY;
  const recent = input.failures.filter((f) => now.getTime() - f.ts.getTime() <= windowOf(f.kind));
  const span = recent.some((f) => now.getTime() - f.ts.getTime() > 7 * DAY) ? "in the last 14 days" : "this week";
  const last24 = recent.filter((f) => now.getTime() - f.ts.getTime() < DAY);
  const pending = input.oldestPendingWithdrawalAt ? now.getTime() - input.oldestPendingWithdrawalAt.getTime() : null;

  if (last24.length) return mk("red", `${plural(last24.length, "money failure")} in the last 24 hours (${[...new Set(last24.map((f) => FAILURE_WORDS[f.kind] ?? f.kind))].join(", ")})`, "Ask Claude to check today.");
  if (pending !== null && pending > PENDING_LIMIT_MS) return mk("red", `One withdrawal has been waiting ${ageText(pending)} (it should finish within 60 hours)`, "Ask Claude to look at it today.");
  if (recent.length) {
    const open = recent.filter((f) => !f.resolved).length;
    return mk("amber", `${plural(recent.length, "failure")} ${span}, ${open} still open`, open ? "Ask Claude about the open ones." : "Nothing, all of them were fixed.");
  }
  return mk("green", pending === null ? "No failures in 7 days, nothing waiting" : `No failures in 7 days; one withdrawal in progress (${ageText(pending)} so far, normal)`);
}

/** Plain words for a route step ("withdraw/confirm" -> "withdraw confirm"; the wallet placeholder is dropped). */
const stepWords = (step: string): string => step.split("/").filter((p) => !p.startsWith("[")).join(" ");

/** A server error on a withdraw route (including cancel and lend withdraw) is red on its own: that is a user's money in motion. */
const isWithdrawStep = (step: string): boolean => step.startsWith("withdraw/") || step.startsWith("lend/withdraw/");

/** Unexpected server errors on money routes in the last 24 h (`app_error` events). Green none; amber 1-2; red 3+ or any on a withdraw route. */
export function appErrorsLight(input: { errors: { step: string }[] }): Light {
  const mk = maker("appErrors");
  const n = input.errors.length;
  if (n === 0) return mk("green", "No app errors on money routes in the last 24 hours");
  const names = [...new Set(input.errors.map((e) => stepWords(e.step)))];
  const shown = names.length > 3 ? `${names.slice(0, 3).join(", ")}, and ${names.length - 3} more` : names.join(", ");
  const fact = `${plural(n, "app error")} in the last 24 hours (${shown})`;
  const red = n >= 3 || input.errors.some((e) => isWithdrawStep(e.step));
  return mk(red ? "red" : "amber", fact, "Ask Claude to check them today.");
}

/** One confirmed planting's three amounts, in cents. `id` is already the short form. `pulledCents` is net of the network fee. */
export type AddUpRow = { id: string; claimedCents: number; pulledCents: number; legsCents: number; legCount: number };

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * Confirmed plantings of the last 30 days: (1) the round-ups a planting claimed equal what it pulled (more than 1 cent apart is a
 * miss: claimed > pulled is red, claimed < pulled amber; a planting row does not record a deliberate partial pull, R336 share < 100,
 * so that case reads red), (2) its legs add up to what it pulled (the one leg per planting records pull minus the network fee, so
 * exact; 1 cent of rounding is allowed per extra leg, for older split plantings). Green all add up; red any off; amber only the
 * claimed < pulled kind.
 */
export function amountsAddUpLight(input: { rows: AddUpRow[] }): Light {
  const mk = maker("amountsAddUp");
  const gaps = input.rows.map((r) => {
    const over = r.claimedCents - r.pulledCents;
    const legGap = Math.abs(r.legsCents - r.pulledCents);
    const legsOff = legGap > Math.max(1, r.legCount - 1);
    return { red: over > 1 || legsOff, amber: over < -1, gap: Math.max(over > 1 ? over : 0, legsOff ? legGap : 0, over < -1 ? -over : 0) };
  });
  const red = gaps.filter((g) => g.red);
  if (red.length) return mk("red", `${red.length} ${red.length === 1 ? "saving doesn't" : "savings don't"} add up, biggest gap ${dollars(Math.max(...red.map((g) => g.gap)))}`, "Ask Claude to check them today.");
  const amber = gaps.filter((g) => g.amber);
  if (amber.length) return mk("amber", `${plural(amber.length, "saving")} pulled more than ${amber.length === 1 ? "its" : "their"} round-ups, biggest gap ${dollars(Math.max(...amber.map((g) => g.gap)))}`, "Ask Claude to check them today.");
  return mk("green", "Every saving in the last 30 days pulled what its round-ups say");
}

// ---- Infra lights ----

/** Ruling R2: Pyth sponsored-feed access ends here; the Prices light shows the countdown. */
export const PYTH_ACCESS_ENDS = new Date("2026-12-31T23:59:59Z");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function swapWatchingLight(input: { linked: string[]; onWebhook: string[] }): Light {
  const mk = maker("swapWatching");
  const linked = [...new Set(input.linked)];
  if (linked.length === 0) return mk("info", "No linked wallets yet, nothing to watch");
  const watched = new Set(input.onWebhook);
  const missing = linked.filter((w) => !watched.has(w)).length; // count only, never addresses
  if (missing > 0) return mk("red", `${plural(missing, "linked wallet")} ${missing === 1 ? "is" : "are"} not being watched; ${missing === 1 ? "its" : "their"} swaps will be missed`, "Ask Claude to re-add them.");
  return mk("green", linked.length === 1 ? "The 1 linked wallet is being watched" : `All ${linked.length} linked wallets are being watched`);
}

export function swapsArrivingLight(input: { now: Date; linkedCount: number; lastSwapAt: Date | null; unpriced24h: number }): Light {
  const mk = maker("swapsArriving");
  const { now, linkedCount, lastSwapAt, unpriced24h } = input;
  if (linkedCount === 0) return mk("info", "No linked wallets yet, so no swaps expected");
  const CHECK = "Ask Claude to check swap detection.";
  if (!lastSwapAt) return mk("red", `${plural(linkedCount, "wallet")} ${linkedCount === 1 ? "is" : "are"} linked but no swap has ever arrived`, CHECK);
  const age = now.getTime() - lastSwapAt.getTime();
  if (age < 0) return mk("unknown", "The newest swap's timestamp looks wrong", "Ask Claude.");
  const fact = `Last swap ${ageText(age)} ago${unpriced24h > 0 ? `; ${plural(unpriced24h, "swap")} ${unpriced24h === 1 ? "is" : "are"} missing a dollar value` : ""}`;
  if (age > 72 * HOUR) return mk("red", fact, CHECK);
  if (age > 24 * HOUR || unpriced24h > 0) {
    const actions: string[] = [];
    if (age > 24 * HOUR) actions.push("Nothing if swaps are simply quiet. Ask Claude if users say they swapped.");
    if (unpriced24h > 0) actions.push("Ask Claude if swaps keep missing a dollar value.");
    return mk("amber", fact, actions.join(" "));
  }
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
  const countdown = `Free price data ends in ${plural(days, "day")} (${MONTHS[accessEnds.getUTCMonth()]} ${accessEnds.getUTCDate()})`;
  const mk = (state: LightState, fact: string, action?: string): Light => ({ ...maker("prices")(state, `${fact}; ${countdown}`, action) });

  const red: string[] = [];
  const amber: string[] = [];
  const unknown: string[] = [];
  for (const f of feeds) {
    let age = now.getTime() - f.publishTime.getTime();
    if (age < 0) {
      if (age < -PRICE_AHEAD_MS) { unknown.push("A price timestamp looks wrong"); continue; }
      age = 0;
    }
    if (age > PRICE_RED_MS) red.push(`The ${f.name} price is ${ageText(age)} old; too stale to save safely`);
    else if (age > f.maxAgeS * 1000) amber.push(`The ${f.name} price is a few minutes old`);
  }
  if (skr === "failed") red.push("The SKR price could not be fetched");
  const skrNote = skr === "no-key" ? "SKR price checks are off (no API key set)" : null;
  const withNote = (parts: string[]) => [...parts, ...(skrNote ? [skrNote] : [])].join("; ");
  const CHECK = "Ask Claude to check the price feeds.";

  if (red.length) return mk("red", withNote(red), CHECK);
  if (feeds.length === 0) return mk("unknown", withNote(["No prices could be checked"]), "Try Refresh; if it stays, ask Claude.");
  if (unknown.length) return mk("unknown", withNote([...new Set(unknown)]), "Ask Claude.");
  if (amber.length) return mk("amber", withNote(amber), "Nothing; it usually recovers. Check again in 15 minutes.");
  const ok = `${feeds.map((f) => f.name).join(", ")}`;
  return mk("green", skr === "ok" ? `${ok}, SKR all up to date` : withNote([`${ok} all up to date`]));
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

export function gasLight(input: { lamports: bigint }): Light {
  const { lamports } = input;
  const shown = (Number(lamports) / 1e9).toFixed(3);
  const fact = `The wallet that pays network fees holds ${shown} SOL`;
  const mk = maker("gas");
  if (lamports > LAMPORTS_PER_SOL / 2n) return mk("green", fact);
  if (lamports >= LAMPORTS_PER_SOL / 10n) return mk("amber", fact, "Top it up soon; ask Claude how.");
  return mk("red", fact, "Savings will fail until it is topped up. Ask Claude today.");
}

/** `names` (optional) labels each option by index; without it the fact says "option N" (1-based). */
export function programLight(input: { enabled: boolean[]; expected: boolean[]; leashLive: boolean; names?: string[] }): Light {
  const { enabled, expected, leashLive, names } = input;
  const mk = maker("program");
  const live = leashLive ? "" : " The live savings switch is off.";
  if (expected.length === 0) return mk("unknown", "Nothing to compare the settings against", "Ask Claude.");
  if (enabled.length !== expected.length) return mk("red", `Read ${enabled.length} settings but expected ${expected.length}`, "Ask Claude.");
  const differ = expected.flatMap((e, i) => (enabled[i] !== e ? [i] : []));
  if (differ.length) {
    const who = differ.map((i) => (names ? names[i] ?? `option ${i + 1}` : `option ${i + 1}`)).join(", ");
    return mk("red", `${differ.length === 1 ? `Savings option ${who} is` : `Savings options ${who} are`} not in ${differ.length === 1 ? "its" : "their"} expected state.${live}`, "Ask Claude. Do not change anything yourself.");
  }
  const allOn = expected.every(Boolean);
  const fact = `All ${expected.length} savings options ${allOn ? "are on, as expected" : "match what is expected"}`;
  // A live switch that is off is worth saying, but it is not one of the 8 options, so the light stays green.
  return mk("green", leashLive ? fact : `${fact}.${live}`);
}

export function supportLight(input: { now: Date; count7d: number; newestAt: Date | null }): Light {
  const { now, count7d, newestAt } = input;
  const base = `${plural(count7d, "support message")} this week`;
  const fact = count7d === 0 ? base : newestAt ? `${base}, newest ${ageText(now.getTime() - newestAt.getTime())} ago` : base;
  return maker("support")("info", fact);
}
