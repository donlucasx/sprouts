import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";

// Inside a request: `after` is recorded, not run, so the test decides when the request ends.
const tasks: (() => Promise<unknown>)[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => Promise<unknown>) => { tasks.push(fn); } }));

const { countHelius, pendingHeliusCredits, _resetHeliusCredits, FLUSH_AT_CREDITS, FLUSH_AFTER_MS, setHeliusFlushTarget } = await import("@/lib/helius-credits");
const { getRepo } = await import("@/db/repo");

const credits = (repo: MemoryRepo) => repo.events.filter((e) => e.kind === "helius_credits").map((e) => (e.detail as { credits: number }).credits);
const endRequest = async () => { const t = tasks.splice(0); for (const f of t) await f(); return t.length; };

describe("countHelius inside a request: flushed per request, so an instance dies with little uncounted", () => {
  let repo: MemoryRepo;
  beforeEach(() => { _resetHeliusCredits(); tasks.length = 0; repo = new MemoryRepo(); setRepoForTests(repo); });

  it("the threshold is 50 credits and the age 60 s", () => {
    expect(FLUSH_AT_CREDITS).toBe(50);
    expect(FLUSH_AFTER_MS).toBe(60_000);
  });

  it("a request that crosses 50 schedules after() once, writes one row, and the next request schedules again", async () => {
    const t = new Date("2026-11-19T10:00:00Z");
    countHelius(30, t);
    expect(tasks).toHaveLength(0);
    countHelius(30, t);
    countHelius(30, t);   // still the same request: no second schedule
    expect(await endRequest()).toBe(1);
    expect(credits(repo)).toEqual([90]);
    expect(pendingHeliusCredits()).toBe(0);
    countHelius(60, t);   // scheduled was reset by the flush
    expect(await endRequest()).toBe(1);
    expect(credits(repo)).toEqual([90, 60]);
  });

  it("below 50, a count whose oldest unflushed credit is over 60 s old flushes (measured from that first count, not module load)", async () => {
    const t0 = new Date("2026-11-19T10:00:00Z");
    countHelius(1, t0);
    countHelius(1, new Date(t0.getTime() + 60_000));   // exactly 60 s: not yet
    expect(tasks).toHaveLength(0);
    countHelius(1, new Date(t0.getTime() + 60_001));
    expect(await endRequest()).toBe(1);
    expect(credits(repo)).toEqual([3]);
    // The clock restarts at the next first count, not at the flush or module load.
    const t1 = new Date(t0.getTime() + 10 * 60_000);
    countHelius(1, t1);
    expect(tasks).toHaveLength(0);
    countHelius(1, new Date(t1.getTime() + 60_001));
    expect(await endRequest()).toBe(1);
    expect(credits(repo)).toEqual([3, 2]);
  });

  it("a failed flush keeps the count and its age; the next count schedules again", async () => {
    const t = new Date("2026-11-19T10:00:00Z");
    const real = repo.addEvent.bind(repo);
    repo.addEvent = async () => { throw new Error("db down"); };
    countHelius(60, t);
    expect(await endRequest()).toBe(1);
    expect(pendingHeliusCredits()).toBe(60);
    repo.addEvent = real;
    countHelius(1, t);
    expect(await endRequest()).toBe(1);
    expect(credits(repo)).toEqual([61]);
  });

  it("db/repo.ts registers getRepo as the flush target at load; with no target (the app's tests) counts only accumulate", async () => {
    setHeliusFlushTarget(null);
    try {
      countHelius(500, new Date("2026-11-19T10:00:00Z"));
      expect(tasks).toHaveLength(0);
      expect(pendingHeliusCredits()).toBe(500);
    } finally {
      setHeliusFlushTarget(getRepo);
    }
    countHelius(1, new Date("2026-11-19T10:00:00Z"));
    expect(await endRequest()).toBe(1);
    expect(credits(repo)).toEqual([501]);
  });
});
