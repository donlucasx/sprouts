import { describe, it, expect, vi, afterEach } from "vitest";
import { createWindowPace, createTokenLane, PaceRefused } from "@/lib/pace";
import {
  jupiterFetch, JupiterRateLimited, isJupiterRateLimit, jupiterLane, withJupiterRunLane, withJupiterTopUpBudget,
  JUPITER_LANE_INTERVAL_MS, JUPITER_USER_MAX_TURN_WAIT_MS, JUPITER_RUN_RETRY_AFTER_CAP_MS, JUPITER_RUN_WINDOW_WAIT_MS, JUPITER_TOPUP_RETRY_MS, JUPITER_TOPUP_MAX_WAIT_MS,
} from "@/lib/jupiter";

// 11-27 (Kimi pace scope items 1, 2, 4, 6): the run lane's 40-a-minute pace, its deadline-bound 429 waits, the top-up's longer budget.

const clock = () => {
  const c = { t: 1_000_000, slept: [] as number[] };
  return { c, now: () => c.t, sleep: async (ms: number) => { c.slept.push(ms); c.t += ms; } };
};

describe("createWindowPace", () => {
  it("11-28: Jupiter no longer uses the window pace; the shared lane spaces every call 1.1 s, a user turn at most 8 s away", () => {
    expect(JUPITER_LANE_INTERVAL_MS).toBe(1_100);
    expect(JUPITER_USER_MAX_TURN_WAIT_MS).toBe(8_000);
  });
  it("lets at most 40 requests start in any rolling 60 s; the 41st waits for the first one's window to end", async () => {
    const { c, now, sleep } = clock();
    const pace = createWindowPace({ max: 40, windowMs: 60_000, now, sleep, log: () => {} });
    const started: number[] = [];
    await Promise.all(Array.from({ length: 42 }, () => pace().then(() => started.push(c.t - 1_000_000))));
    expect(started.slice(0, 40).every((x) => x === 0)).toBe(true);
    expect(started.slice(40)).toEqual([60_000, 60_000]);
  });
  it("a caller whose turn would come only past its deadline is refused at once (no wait, no slot); the queue behind it goes on", async () => {
    const { c, now, sleep } = clock();
    const pace = createWindowPace({ max: 1, windowMs: 60_000, now, sleep, log: () => {} });
    await pace();
    const refused = pace({ notAfterMs: c.t + 5_000 }).catch((e) => e);
    const patient = pace();
    expect(await refused).toBeInstanceOf(PaceRefused);
    await patient;
    expect(c.slept).toEqual([60_000]);   // only the patient caller waited
  });
});

describe("jupiterFetch, run lane", () => {
  afterEach(() => vi.unstubAllGlobals());
  const script = (...rs: Array<{ status: number; headers?: Record<string, string> }>) => {
    const f = vi.fn(async () => { const r = rs.shift() ?? { status: 429 }; return new Response("x", { status: r.status, headers: r.headers }); });
    vi.stubGlobal("fetch", f);
    return f;
  };
  const noPace = async () => {};

  it("after the two short retries, one more try after a 10-20 s window wait (no Retry-After)", async () => {
    expect(JUPITER_RUN_WINDOW_WAIT_MS).toEqual([10_000, 20_000]);
    const f = script({ status: 429 }, { status: 429 }, { status: 429 }, { status: 200 });
    const { c, now, sleep } = clock();
    const res = await jupiterFetch("http://x", {}, "quote", { sleep, now, pace: noPace, lane: { kind: "run", deadlineMs: c.t + 200_000 } });
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(4);
    expect(c.slept.length).toBe(3);
    expect(c.slept[2]).toBeGreaterThanOrEqual(10_000);
    expect(c.slept[2]).toBeLessThanOrEqual(20_000);
  });
  it("four 429s reject JupiterRateLimited (a 'jupiter busy' for the run)", async () => {
    script();
    const { c, now, sleep } = clock();
    const e = await jupiterFetch("http://x", {}, "swap-instructions", { sleep, now, pace: noPace, lane: { kind: "run", deadlineMs: c.t + 200_000 } }).catch((x) => x);
    expect(e).toBeInstanceOf(JupiterRateLimited);
    expect(isJupiterRateLimit(e)).toBe(true);
  });
  it("item 6: a Retry-After is honored up to 20 s in the run lane (it stays cut at 3 s elsewhere)", async () => {
    expect(JUPITER_RUN_RETRY_AFTER_CAP_MS).toBe(20_000);
    script({ status: 429, headers: { "retry-after": "15" } }, { status: 429, headers: { "retry-after": "60" } }, { status: 200 });
    const run = clock();
    await jupiterFetch("http://x", {}, "quote", { sleep: run.sleep, now: run.now, pace: noPace, lane: { kind: "run", deadlineMs: run.c.t + 200_000 } });
    expect(run.c.slept).toEqual([15_000, 20_000]);
    script({ status: 429, headers: { "retry-after": "15" } }, { status: 200 });
    const user = clock();
    await jupiterFetch("http://x", {}, "quote", { sleep: user.sleep, now: user.now });
    expect(user.c.slept).toEqual([3_000]);
  });
  it("DEADLINE: no 429 wait ends past the run deadline; the call fails at once as busy instead", async () => {
    // A 20 s Retry-After with 5 s left: no wait at all.
    const f = script({ status: 429, headers: { "retry-after": "20" } }, { status: 200 });
    const a = clock();
    const deadline = a.c.t + 5_000;
    const e = await jupiterFetch("http://x", {}, "quote", { sleep: a.sleep, now: a.now, pace: noPace, lane: { kind: "run", deadlineMs: deadline } }).catch((x) => x);
    expect(e).toBeInstanceOf(JupiterRateLimited);
    expect(a.c.slept).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
    // No Retry-After, 5 s left: the two short waits fit, the 10-20 s window wait does not.
    script();
    const b = clock();
    const end = b.c.t + 5_000;
    await expect(jupiterFetch("http://x", {}, "quote", { sleep: b.sleep, now: b.now, pace: noPace, lane: { kind: "run", deadlineMs: end } })).rejects.toBeInstanceOf(JupiterRateLimited);
    expect(b.c.slept.length).toBe(2);
    expect(b.c.t).toBeLessThanOrEqual(end);
  });
  it("DEADLINE: a pace with no turn before the deadline sends nothing and waits nothing", async () => {
    const f = script({ status: 200 }, { status: 200 });
    const { c, now, sleep } = clock();
    const pace = createTokenLane({ intervalMs: 60_000, now, sleep, log: () => {} });
    const lane = { kind: "run" as const, deadlineMs: c.t + 30_000 };
    expect((await jupiterFetch("http://x", {}, "quote", { sleep, now, pace, lane })).status).toBe(200);
    const e = await jupiterFetch("http://x", {}, "quote", { sleep, now, pace, lane }).catch((x) => x);
    expect(e).toBeInstanceOf(JupiterRateLimited);
    expect(isJupiterRateLimit(e)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(c.slept).toEqual([]);
  });
  it("every retry takes its own pace turn", async () => {
    script({ status: 429 }, { status: 200 });
    const turns: unknown[] = [];
    const { c, now, sleep } = clock();
    await jupiterFetch("http://x", {}, "price", { sleep, now, pace: async (o) => { turns.push(o); }, lane: { kind: "run", deadlineMs: c.t + 100_000 } });
    expect(turns).toEqual([{ notAfterMs: c.t - c.slept[0] + 100_000, priority: "run" }, { notAfterMs: c.t - c.slept[0] + 100_000, priority: "run" }]);
  });
  it("the lane comes from withJupiterRunLane / withJupiterTopUpBudget and ends with them; no lane = today's two retries, unpaced", async () => {
    expect(jupiterLane.getStore()).toBeUndefined();
    expect(await withJupiterRunLane(123, async () => jupiterLane.getStore())).toEqual({ kind: "run", deadlineMs: 123 });
    expect(await withJupiterTopUpBudget(async () => jupiterLane.getStore())).toEqual({ kind: "topup" });
    expect(jupiterLane.getStore()).toBeUndefined();
    const f = script();
    const { sleep } = clock();
    await expect(jupiterFetch("http://x", {}, "quote", sleep)).rejects.toBeInstanceOf(JupiterRateLimited);
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe("jupiterFetch, top-up lane (item 4)", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("four retries ([500, 1500, 2500, 3000] jittered), all waits together at most 8 s, then busy", async () => {
    expect(JUPITER_TOPUP_RETRY_MS).toEqual([500, 1_500, 2_500, 3_000]);
    expect(JUPITER_TOPUP_MAX_WAIT_MS).toBe(8_000);
    for (const random of [() => 0, () => 0.999]) {
      const f = vi.fn(async () => new Response("x", { status: 429 }));
      vi.stubGlobal("fetch", f);
      const { c, now, sleep } = clock();
      const e = await jupiterFetch("http://x", {}, "quote", { sleep, now, random, lane: { kind: "topup" } }).catch((x) => x);
      expect(e).toBeInstanceOf(JupiterRateLimited);
      expect(c.slept.reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(8_000);
      expect(f.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(f.mock.calls.length).toBeLessThanOrEqual(5);
    }
  });
  it("a Retry-After stays cut at 3 s for the top-up", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("x", { status: 429, headers: { "retry-after": "30" } })).mockResolvedValueOnce(new Response("ok")));
    const { c, now, sleep } = clock();
    await jupiterFetch("http://x", {}, "quote", { sleep, now, lane: { kind: "topup" } });
    expect(c.slept).toEqual([3_000]);
  });
});
