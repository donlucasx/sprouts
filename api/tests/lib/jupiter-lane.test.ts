import { describe, it, expect, vi, afterEach } from "vitest";
import { createTokenLane, PaceRefused } from "@/lib/pace";
import { jupiterFetch, JupiterRateLimited, JUPITER_LANE_INTERVAL_MS, JUPITER_USER_MAX_TURN_WAIT_MS } from "@/lib/jupiter";

// 11-28 (Kimi Jupiter re-assessment fix 2): one shared Jupiter lane per process, a start every 1.1 s, user calls before the run,
// nothing bypasses it, the run's deadline refuses a turn instead of waiting past it.

const clock = () => {
  const c = { t: 1_000_000, slept: [] as number[] };
  // A sleep that yields to the event loop first, then moves the clock: what a granted caller does next happens at its own turn's time.
  return { c, now: () => c.t, sleep: async (ms: number) => { c.slept.push(ms); await new Promise((r) => setImmediate(r)); c.t += ms; } };
};

describe("createTokenLane", () => {
  it("no bursts: 10 calls asked at once start one interval apart, never two closer", async () => {
    const { c, now, sleep } = clock();
    const lane = createTokenLane({ intervalMs: JUPITER_LANE_INTERVAL_MS, now, sleep, log: () => {} });
    const starts: number[] = [];
    await Promise.all(Array.from({ length: 10 }, () => lane().then(() => starts.push(c.t - 1_000_000))));
    expect(starts).toEqual(Array.from({ length: 10 }, (_, i) => i * 1_100));
    // A later call after a quiet spell goes at once, and the next one still waits a full interval.
    c.t += 60_000;
    const t0 = c.t;
    await lane();
    expect(c.t).toBe(t0);
    await lane();
    expect(c.t).toBe(t0 + 1_100);
  });

  it("priority: a user call asked after waiting run calls goes before them; run calls keep their order", async () => {
    const c = { t: 0 };
    const wakes: (() => void)[] = [];
    const sleep = (ms: number) => new Promise<void>((r) => wakes.push(() => { c.t += ms; r(); }));
    const lane = createTokenLane({ intervalMs: 1_000, now: () => c.t, sleep, log: () => {} });
    const order: string[] = [];
    const runs = ["r1", "r2", "r3"].map((n) => lane({ priority: "run" }).then(() => order.push(n)));
    await Promise.resolve();
    expect(order).toEqual(["r1"]);   // r1 at once; the lane now sleeps one interval before r2
    const user = lane({ priority: "user" }).then(() => order.push("u"));
    const all = Promise.all([...runs, user]);
    for (let i = 0; i < 10 && order.length < 4; i++) { await new Promise((r) => setImmediate(r)); wakes.shift()?.(); }
    await all;
    expect(order).toEqual(["r1", "u", "r2", "r3"]);
  });

  it("deadline: a run call whose turn would come past its deadline is refused at once and takes no turn", async () => {
    const { c, now, sleep } = clock();
    const lane = createTokenLane({ intervalMs: 1_000, now, sleep, log: () => {} });
    await lane({ priority: "run" });
    const late = lane({ priority: "run", notAfterMs: c.t + 500 }).catch((e) => e);
    const patient = lane({ priority: "run" });
    expect(await late).toBeInstanceOf(PaceRefused);
    await patient;
    expect(c.slept).toEqual([1_000]);   // only the patient call waited, one interval (the refused one took no turn)
  });

  it("deadline: a user call arriving ahead of a waiting run call that would then miss its deadline refuses that run call", async () => {
    const { c, now, sleep } = clock();
    const lane = createTokenLane({ intervalMs: 1_000, now, sleep, log: () => {} });
    await lane({ priority: "user" });
    const run = lane({ priority: "run", notAfterMs: c.t + 1_500 }).catch((e) => e);   // its turn: +1 000, inside the deadline
    const user = lane({ priority: "user" });                                           // now the user's turn is +1 000, the run's +2 000
    expect(await run).toBeInstanceOf(PaceRefused);
    await user;
  });
});

describe("jupiterFetch in the shared lane", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a user call (no lane) takes a user turn bounded at 8 s; a run call takes a run turn bounded by its deadline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok")));
    const turns: unknown[] = [];
    const { c, now, sleep } = clock();
    await jupiterFetch("http://x", {}, "price", { sleep, now, pace: async (o) => { turns.push(o); } });
    await jupiterFetch("http://x", {}, "quote", { sleep, now, pace: async (o) => { turns.push(o); }, lane: { kind: "topup" } });
    await jupiterFetch("http://x", {}, "quote", { sleep, now, pace: async (o) => { turns.push(o); }, lane: { kind: "run", deadlineMs: 5 } });
    expect(turns).toEqual([
      { notAfterMs: c.t + JUPITER_USER_MAX_TURN_WAIT_MS, priority: "user" },
      { notAfterMs: c.t + JUPITER_USER_MAX_TURN_WAIT_MS, priority: "user" },
      { notAfterMs: 5, priority: "run" },
    ]);
  });

  it("a user call behind a queue longer than 8 s answers busy (JupiterRateLimited) and sends nothing", async () => {
    const f = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", f);
    const { now, sleep } = clock();
    const lane = createTokenLane({ intervalMs: 1_100, now, sleep, log: () => {} });
    // Eight user calls already queued (the last one's turn is 7.7 s away), then a ninth: its turn at 8.8 s is past 8 s.
    const queued = Array.from({ length: 8 }, () => lane({ priority: "user" }));
    const e = await jupiterFetch("http://x", {}, "price", { sleep, now, pace: lane }).catch((x) => x);
    expect(e).toBeInstanceOf(JupiterRateLimited);
    expect(f).not.toHaveBeenCalled();
    await Promise.all(queued);
  });

  it("a 429 retry waits its turn in the lane too (nothing bypasses it)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("x", { status: 429 })).mockResolvedValueOnce(new Response("ok")));
    let turns = 0;
    const { sleep, now } = clock();
    await jupiterFetch("http://x", {}, "price", { sleep, now, random: () => 0.5, pace: async () => { turns++; } });
    expect(turns).toBe(2);
  });
});
