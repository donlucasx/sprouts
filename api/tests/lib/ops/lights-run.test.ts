import { describe, it, expect } from "vitest";
import { dailyRunLight, firstPlantingLight, moneyOpsLight, BENIGN_SKIP_REASONS, type CronRunInput } from "@/lib/ops/lights";

const H = 3_600_000;
const D = 24 * H;
const at = (iso: string) => new Date(iso);
const NOW = at("2026-11-12T15:00:00Z");
const ago = (ms: number, now = NOW) => new Date(now.getTime() - ms);

function goodSummary(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    coins: 6, splits: [{ stop: "a", fallback: null }], applied: 0, venues: 2, moves: 0,
    planting: { planted: [{}], skipped: [{ wallet: "x", reason: "below threshold" }, { wallet: "y", reason: "no usdc" }] },
    withdrawals: { cranked: [], failed: [], skipped: [] },
    reconciled: { adjusted: [], skipped: [], deferred: [] },
    coverage: { missing: [], repaired: [] },
    ...over,
  };
}
function run(over: Partial<CronRunInput> = {}, summary: Record<string, unknown> = goodSummary()): CronRunInput {
  return { day: "2026-11-12", startedAt: ago(1 * H), finishedAt: ago(1 * H - 60_000), ok: true, summary, ...over };
}
const light = (latest: CronRunInput | null, movesEnabled = true, now = NOW) => dailyRunLight({ now, latest, movesEnabled });

describe("BENIGN_SKIP_REASONS", () => {
  it("is the exact list", () => {
    expect([...BENIGN_SKIP_REASONS]).toEqual(["no usdc", "paused", "below threshold", "cap reached", "revoked", "relink needed", "not first", "part in flight"]);
  });
});

describe("dailyRunLight", () => {
  it("green: finished ok, all sections, only benign skips", () => {
    const l = light(run());
    expect(l.state).toBe("green");
    expect(l.key).toBe("dailyRun");
  });
  it("amber: venues null names venues", () => {
    const l = light(run({}, goodSummary({ venues: null })));
    expect(l.state).toBe("amber");
    expect(l.fact).toContain("venues");
  });
  it("red: coverage null", () => {
    expect(light(run({}, goodSummary({ coverage: null }))).state).toBe("red");
  });
  it("green: coverage key absent (a row written before the cron recorded it: no opinion, only null is red)", () => {
    const s = goodSummary();
    delete s.coverage;
    expect(light(run({}, s)).state).toBe("green");
  });
  it("absent venues key is not a failed step (R3)", () => {
    const s = goodSummary();
    delete s.venues;
    expect(light(run({}, s)).state).toBe("green");
  });
  it("red: withdrawals null", () => {
    expect(light(run({}, goodSummary({ withdrawals: null }))).state).toBe("red");
  });
  it("red: ok false", () => {
    expect(light(run({ ok: false }, { error: "boom" })).state).toBe("red");
  });
  it("red: finished with ok null", () => {
    expect(light(run({ ok: null })).state).toBe("red");
  });
  it("amber: ok true but summary null", () => {
    const l = light(run({ summary: null }));
    expect(l.state).toBe("amber");
    expect(l.fact).toBe("The last run finished but left no report");
    expect(l.action).toBeTruthy();
  });
  it("red, not running: ok false with no finishedAt, 3 min old", () => {
    const l = light(run({ startedAt: ago(3 * 60_000), finishedAt: null, ok: false }));
    expect(l.state).toBe("red");
    expect(l.fact).not.toContain("running");
    expect(l.action).toBeTruthy();
  });
  it("red: started 11 min ago and not finished", () => {
    expect(light(run({ startedAt: ago(11 * 60_000), finishedAt: null, ok: null })).state).toBe("red");
  });
  it("amber: started 5 min ago and still running", () => {
    expect(light(run({ startedAt: ago(5 * 60_000), finishedAt: null, ok: null })).state).toBe("amber");
  });
  it("amber: non-benign skip reason shown", () => {
    const s = goodSummary({ planting: { planted: [], skipped: [{ wallet: "x", reason: "send unknown" }] } });
    const l = light(run({}, s));
    expect(l.state).toBe("amber");
    expect(l.fact).toContain("send unknown");
  });
  it("green: reconciled.adjusted is routine, and rides on the green fact", () => {
    const l = light(run({}, goodSummary({ reconciled: { adjusted: ["v", "w"], skipped: [], deferred: [] } })));
    expect(l.state).toBe("green");
    expect(l.fact).toBe("Ran 59 minutes ago, everything fine (routine cleanup corrected 2 saved amounts)");
    expect(l.action).toBeUndefined();
    expect(light(run({}, goodSummary({ reconciled: { adjusted: ["v"], skipped: [], deferred: [] } }))).fact).toContain("corrected 1 saved amount)");
  });
  it("failed last run says 'last', not 'yesterday'", () => {
    expect(light(run({ ok: false }, { error: "boom" })).fact).toBe("The last daily job failed");
  });
  it("durations are written in words, singular for 1", () => {
    expect(light(run({ startedAt: ago(5 * 60_000), finishedAt: null, ok: null })).fact).toBe("The daily job is running now (5 minutes so far)");
    expect(light(run({ startedAt: ago(60_000), finishedAt: null, ok: null })).fact).toBe("The daily job is running now (1 minute so far)");
    expect(light(run({ startedAt: ago(11 * 60_000), finishedAt: null, ok: null })).fact).toBe("The daily job started 11 minutes ago and got stuck");
    expect(light(run({ finishedAt: ago(27 * H) })).fact).toBe("The daily job has not run for 27 hours");
    expect(light(run({ finishedAt: ago(3 * D) })).fact).toBe("The daily job has not run for 3 days");
    expect(light(run({ finishedAt: ago(2 * D) })).fact).toBe("The daily job has not run for 2 days");
    expect(firstPlantingLight({ now: NOW, lastRunAt: ago(1 * H) }).fact).toBe("Ran 1 hour ago, new users get their first saving");
    expect(moneyOpsLight({ now: NOW, failures: [], oldestPendingWithdrawalAt: ago(14 * D) }).fact).toContain("14 days");
  });
  it("combined amber reasons give ONE action, the most urgent (today beats it-fixed-itself)", () => {
    const l = light(run({}, goodSummary({ coverage: { missing: ["a"], repaired: ["a"] }, withdrawals: { cranked: [], failed: [{}], skipped: [] } })));
    expect(l.state).toBe("amber");
    expect(l.fact).toContain("withdrawal failed");
    expect(l.fact).toContain("re-added");
    expect(l.action).toBe("Ask Claude to check them today.");
    expect(l.action).not.toMatch(/fixed itself/);
    const only = light(run({}, goodSummary({ coverage: { missing: ["a"], repaired: ["a"] } })));
    expect(only.action).toBe("Nothing, it fixed itself. Ask Claude if it repeats.");
  });
  it("amber stays amber with adjusted present, and the fact leaves reconcile out", () => {
    const l = light(run({}, goodSummary({ reconciled: { adjusted: ["v"] }, coverage: { missing: ["a"], repaired: ["a"] } })));
    expect(l.state).toBe("amber");
    expect(l.fact).not.toMatch(/cleanup|reconcile/);
  });
  it("amber: coverage re-added wallets", () => {
    expect(light(run({}, goodSummary({ coverage: { missing: ["a"], repaired: ["a"] } }))).state).toBe("amber");
  });
  it("amber: failed withdrawals", () => {
    expect(light(run({}, goodSummary({ withdrawals: { cranked: [], failed: [{}], skipped: [] } }))).state).toBe("amber");
  });
  it("red: no row", () => {
    expect(light(null).state).toBe("red");
  });
  it("green: 13:59 UTC with yesterday's good row finished 14:02", () => {
    const now = at("2026-11-12T13:59:00Z");
    const fin = at("2026-11-11T14:02:00Z");
    expect(light(run({ day: "2026-11-11", startedAt: ago(0, fin), finishedAt: fin }), true, now).state).toBe("green");
  });
  it("red: same row at 16:03 UTC today (> 26 h)", () => {
    const now = at("2026-11-12T16:03:00Z");
    const fin = at("2026-11-11T14:02:00Z");
    expect(light(run({ day: "2026-11-11", startedAt: ago(0, fin), finishedAt: fin }), true, now).state).toBe("red");
  });
  it("green: moves null while moves are disabled", () => {
    expect(light(run({}, goodSummary({ moves: null })), false).state).toBe("green");
  });
  it("amber: moves null while moves are enabled", () => {
    const l = light(run({}, goodSummary({ moves: null })), true);
    expect(l.state).toBe("amber");
    expect(l.fact).toContain("moves");
  });
});

describe("firstPlantingLight", () => {
  const l = (ms: number | null) => firstPlantingLight({ now: NOW, lastRunAt: ms === null ? null : ago(ms) }).state;
  it("green at 1 h", () => expect(l(1 * H)).toBe("green"));
  const full = (ms: number | null) => firstPlantingLight({ now: NOW, lastRunAt: ms === null ? null : ago(ms) });
  it("never ran: new-user wording and the 2 h hint", () => {
    expect(full(null).fact).toBe("No hourly run recorded since the last deploy");
    expect(full(null).action).toBe("Nothing yet if you just deployed; it runs every hour. Ask Claude if it is still red in 2 hours.");
  });
  it("over 6 h keeps the check-the-job action", () => expect(full(7 * H).action).toBe("Ask Claude to check the hourly job."));
  it("green has no action", () => expect(full(1 * H).action).toBeUndefined());
  it("amber at 3 h", () => expect(l(3 * H)).toBe("amber"));
  it("red at 7 h", () => expect(l(7 * H)).toBe("red"));
  it("red when never", () => expect(l(null)).toBe("red"));
  const r = (reasons?: Record<string, number>) => firstPlantingLight({ now: NOW, lastRunAt: ago(1 * H), reasons });
  it("amber when the last run skipped for a non-benign reason", () => {
    const x = r({ "send unknown": 1 });
    expect(x.state).toBe("amber");
    expect(x.fact).toContain("send unknown");
  });
  it("green when the last run skipped only benign reasons", () => expect(r({ "no usdc": 3 }).state).toBe("green"));
  it("old heartbeat without reasons still works", () => expect(r(undefined).state).toBe("green"));
});

describe("moneyOpsLight", () => {
  const m = (failures: { kind?: "pull_failed" | "withdraw_failed" | "move_failed" | "run_stopped"; age: number; resolved?: boolean }[], pending: number | null = null) =>
    moneyOpsLight({
      now: NOW,
      failures: failures.map((f) => ({ kind: f.kind ?? "pull_failed", ts: ago(f.age), resolved: f.resolved ?? false })),
      oldestPendingWithdrawalAt: pending === null ? null : ago(pending),
    });
  it("green: nothing", () => expect(m([]).state).toBe("green"));
  it("failure kinds are translated and pluralised", () => {
    const l = m([{ kind: "pull_failed", age: H }, { kind: "run_stopped", age: H }, { kind: "move_failed", age: H }, { kind: "withdraw_failed", age: H }]);
    expect(l.fact).toBe("4 money failures in the last 24 hours (could not collect a round-up, the daily job stopped early, a coin move failed, a withdrawal failed)");
    expect(l.fact).not.toMatch(/_failed|run_stopped|\(s\)/);
    expect(l.action).toBeTruthy();
  });
  it("green: failure older than 7 d", () => expect(m([{ age: 8 * D }]).state).toBe("green"));
  it("amber: resolved failure 2 d old", () => expect(m([{ age: 2 * D, resolved: true }]).state).toBe("amber"));
  it("amber: unresolved failure 3 d old", () => expect(m([{ age: 3 * D }]).state).toBe("amber"));
  it("red: failure 12 h old", () => expect(m([{ age: 12 * H }]).state).toBe("red"));
  it("red: resolved failure 12 h old still red", () => expect(m([{ age: 12 * H, resolved: true }]).state).toBe("red"));
  it("green: pending withdrawal 59 h", () => expect(m([], 59 * H).state).toBe("green"));
  it("red: pending withdrawal 61 h", () => expect(m([], 61 * H).state).toBe("red"));
});

describe("audit F1: leftover change not recorded", () => {
  it("Money ops names the new kind in plain English", () => {
    const l = moneyOpsLight({ now: NOW, failures: [{ kind: "remainder_unrecorded", ts: ago(H), resolved: false }], oldestPendingWithdrawalAt: null });
    expect(l.state).toBe("red");
    expect(l.fact).toContain("a user's leftover change wasn't recorded");
  });
  it("a resolved one this week counts as fixed", () => {
    const l = moneyOpsLight({ now: NOW, failures: [{ kind: "remainder_unrecorded", ts: ago(2 * D), resolved: true }], oldestPendingWithdrawalAt: null });
    expect(l).toMatchObject({ state: "amber", fact: "1 failure this week, 0 still open" });
  });
  it("an open one stays in view for 14 days (the retry window); other kinds still drop out after 7", () => {
    const f = (kind: "remainder_unrecorded" | "pull_failed", age: number) => ({ kind, ts: ago(age), resolved: false });
    expect(moneyOpsLight({ now: NOW, failures: [f("remainder_unrecorded", 10 * D)], oldestPendingWithdrawalAt: null })).toMatchObject({ state: "amber", fact: "1 failure in the last 14 days, 1 still open" });
    expect(moneyOpsLight({ now: NOW, failures: [f("pull_failed", 10 * D)], oldestPendingWithdrawalAt: null }).state).toBe("green");
    expect(moneyOpsLight({ now: NOW, failures: [{ ...f("remainder_unrecorded", 15 * D), resolved: true }], oldestPendingWithdrawalAt: null }).state).toBe("green");
  });
  it("M3: an unresolved one never ages out, however old (amber at least)", () => {
    const l = moneyOpsLight({ now: NOW, failures: [{ kind: "remainder_unrecorded", ts: ago(40 * D), resolved: false }], oldestPendingWithdrawalAt: null });
    expect(l.state).toBe("amber");
    expect(l.fact).toContain("1 still open");
    expect(l.fact).toContain("older than 14 days");
  });
  it("daily run: a remainders summary is fine; a null one (the step threw) is a failed part", () => {
    expect(light(run({}, goodSummary({ remainders: { retried: 2, recorded: 1, still_missing: 1, deferred: 0 } }))).state).toBe("green");
    const l = light(run({}, goodSummary({ remainders: null })));
    expect(l.state).toBe("amber");
    expect(l.fact).toContain("remainders");
  });
});

describe("kimi L1: first planting future timestamp", () => {
  it("a last-run time ahead of now is unknown, not green", () => {
    const l = firstPlantingLight({ now: NOW, lastRunAt: new Date(NOW.getTime() + 5 * H) });
    expect(l.state).toBe("unknown");
    expect(l.action).toBeTruthy();
  });
});

describe("kimi L5: deferred counts reach the daily-run light", () => {
  it("amber when any of the three is above zero, saying how many are left for tomorrow", () => {
    const l = light(run({}, goodSummary({ reconciled: { adjusted: [], skipped: [], deferred: ["a", "b"] }, withdrawals: { cranked: [], failed: [], skipped: [], deferred: ["w"] }, remainders: { retried: 3, recorded: 0, still_missing: 0, deferred: 4 } })));
    expect(l.state).toBe("amber");
    expect(l.fact).toContain("7 items were left for tomorrow");
  });
  it("one item reads in the singular; zero everywhere stays green", () => {
    expect(light(run({}, goodSummary({ withdrawals: { cranked: [], failed: [], skipped: [], deferred: ["w"] } }))).fact).toContain("1 item was left for tomorrow");
    expect(light(run({}, goodSummary({ withdrawals: { cranked: [], failed: [], skipped: [], deferred: [] }, remainders: { retried: 0, recorded: 0, still_missing: 0, deferred: 0 } }))).state).toBe("green");
  });
});
