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
    expect([...BENIGN_SKIP_REASONS]).toEqual(["no usdc", "paused", "below threshold", "cap reached", "revoked", "relink needed", "not first"]);
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
  it("green: coverage key absent (R3, the cron never persists it)", () => {
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
    expect(l.fact).toBe("run finished but recorded no summary");
  });
  it("red, not running: ok false with no finishedAt, 3 min old", () => {
    const l = light(run({ startedAt: ago(3 * 60_000), finishedAt: null, ok: false }));
    expect(l.state).toBe("red");
    expect(l.fact).not.toContain("running");
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
  it("amber: reconciled.adjusted non-empty", () => {
    expect(light(run({}, goodSummary({ reconciled: { adjusted: ["v"], skipped: [], deferred: [] } }))).state).toBe("amber");
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
  it("green: failure older than 7 d", () => expect(m([{ age: 8 * D }]).state).toBe("green"));
  it("amber: resolved failure 2 d old", () => expect(m([{ age: 2 * D, resolved: true }]).state).toBe("amber"));
  it("amber: unresolved failure 3 d old", () => expect(m([{ age: 3 * D }]).state).toBe("amber"));
  it("red: failure 12 h old", () => expect(m([{ age: 12 * H }]).state).toBe("red"));
  it("red: resolved failure 12 h old still red", () => expect(m([{ age: 12 * H, resolved: true }]).state).toBe("red"));
  it("green: pending withdrawal 59 h", () => expect(m([], 59 * H).state).toBe("green"));
  it("red: pending withdrawal 61 h", () => expect(m([], 61 * H).state).toBe("red"));
});
