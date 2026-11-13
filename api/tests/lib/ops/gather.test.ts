import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { gatherOps, resetOpsCacheForTests } from "@/lib/ops/gather";
import type { OpsSources, OpsNumbers } from "@/lib/ops/sources";
import { programLight } from "@/lib/ops/lights";

const NOW = new Date("2026-11-12T12:00:00Z");
const W1 = "7YsvQ3mNpK9xT2bLhR8cVdFgJ4wZuE6aXyz1".padEnd(44, "A").slice(0, 44);
const W2 = "9ZkpRt5HnB2vWcQxM8jLdFg3yUe7aSXoP6qTrN4mKbCw".slice(0, 44);
const numbers = (n: number): OpsNumbers => ({
  now: { linkedNow: 2, active7d: 1 },
  funnel: { d1: { signIns: n, triedLink: 0, linkedEver: 0 }, d7: { signIns: n, triedLink: 0, linkedEver: 0 }, all: { signIns: n, triedLink: 0, linkedEver: 0 } },
  linkFailures7d: {}, activity7d: { swaps: 0, unpriced7d: 0, usdSwappedCents: 0, roundupCents: 0, feeCents: 0, byCoin: {} }, recentSwaps: [], recentPlantings: [],
});

function healthy(over: Partial<OpsSources> = {}): OpsSources & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const wrap = <T,>(name: string, v: () => Promise<T>) => () => { calls[name] = (calls[name] ?? 0) + 1; return v(); };
  const base: OpsSources = {
    cronLatest: wrap("cronLatest", async () => ({ day: "2026-11-12", startedAt: new Date(NOW.getTime() - 3_600_000), finishedAt: new Date(NOW.getTime() - 3_500_000), ok: true, summary: { venues: [], coins: [], splits: [], applied: [], moves: [], planting: {}, withdrawals: {}, reconciled: {} } })),
    firstPlantingLast: wrap("firstPlantingLast", async () => ({ at: new Date(NOW.getTime() - 600_000), reasons: {} })),
    failures: wrap("failures", async () => []),
    oldestPendingWithdrawalAt: wrap("oldestPendingWithdrawalAt", async () => null),
    linkedWallets: wrap("linkedWallets", async () => [W1, W2]),
    webhookAddresses: wrap("webhookAddresses", async () => [W1, W2]),
    swapStats: wrap("swapStats", async () => ({ lastSwapAt: new Date(NOW.getTime() - 600_000), unpriced: 0 })),
    feeds: wrap("feeds", async () => [{ name: "SOL" as const, publishTime: new Date(NOW.getTime() - 10_000), maxAgeS: 60 }]),
    skrPrice: wrap("skrPrice", async () => "ok" as const),
    pullerLamports: wrap("pullerLamports", async () => 2_000_000_000n),
    legsEnabled: wrap("legsEnabled", async () => [true, true, true, true, true, true, true, true]),
    support: wrap("support", async () => ({ count: 0, newestAt: null })),
    numbers: wrap("numbers", async () => numbers(1)),
  };
  return Object.assign({ ...base, ...over }, { calls });
}
const flags = { movesEnabled: true, leashLive: true };

beforeEach(() => resetOpsCacheForTests());
afterEach(() => vi.useRealTimers());

describe("gatherOps", () => {
  it("all healthy: 9 lights in key order, none unknown", async () => {
    const s = await gatherOps({ sources: healthy(), now: NOW, flags });
    expect(s.lights.map((l) => l.key)).toEqual(["dailyRun", "firstPlanting", "swapWatching", "swapsArriving", "prices", "gas", "moneyOps", "program", "support"]);
    expect(s.lights.filter((l) => l.state === "unknown")).toEqual([]);
    expect(s.numbers).not.toBeNull();
    expect(s.blindSpots).toHaveLength(4);
    expect(s.at).toBe(NOW.toISOString());
  });

  it("a hanging source times out at 5 s; only its light is unknown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const src = healthy({ webhookAddresses: () => new Promise(() => {}) });
    const p = gatherOps({ sources: src, now: NOW, flags });
    await vi.advanceTimersByTimeAsync(5_001);
    const s = await p;
    const by = Object.fromEntries(s.lights.map((l) => [l.key, l]));
    expect(by.swapWatching.state).toBe("unknown");
    expect(by.swapWatching.fact).toBe("Could not check this (a data source timed out)");
    expect(by.swapWatching.action).toBe("Try Refresh. If it stays grey, ask Claude.");
    expect(by.swapWatching.label).toBe("Swap watching");
    expect(by.swapsArriving.state).not.toBe("unknown");
    expect(by.dailyRun.state).toBe("green");
  });

  it("cronLatest throwing makes dailyRun unknown", async () => {
    const s = await gatherOps({ sources: healthy({ cronLatest: async () => { throw new Error("db down"); } }), now: NOW, flags });
    const l = s.lights.find((x) => x.key === "dailyRun")!;
    expect(l.state).toBe("unknown");
    expect(l.fact).toBe("Could not check this (a data source timed out)");
  });

  it("multi-source light names every failed source", async () => {
    const boom = async () => { throw new Error("x"); };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await gatherOps({ sources: healthy({ linkedWallets: boom, webhookAddresses: boom }), now: NOW, flags });
    // Source names never reach the fact (or the JSON), but the server log keeps them.
    expect(JSON.stringify(s)).not.toMatch(/linkedWallets|webhookAddresses/);
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/swapWatching: linkedWallets, webhookAddresses/);
    err.mockRestore();
  });

  it("caches 60 s, fresh bypasses, concurrent calls share one gather", async () => {
    const src = healthy();
    const [a, b] = await Promise.all([gatherOps({ sources: src, now: NOW, flags }), gatherOps({ sources: src, now: NOW, flags })]);
    expect(b).toBe(a);
    expect(src.calls.cronLatest).toBe(1);
    await gatherOps({ sources: src, now: new Date(NOW.getTime() + 59_000), flags });
    expect(src.calls.cronLatest).toBe(1);
    await gatherOps({ sources: src, now: new Date(NOW.getTime() + 61_000), flags });
    expect(src.calls.cronLatest).toBe(2);
    await gatherOps({ sources: src, now: NOW, flags, fresh: true });
    expect(src.calls.cronLatest).toBe(3);
  });

  it("numbers failing keeps the previous good numbers and numbersAt", async () => {
    let n = 0;
    const src = healthy({ numbers: async () => { if (n++ > 0) throw new Error("x"); return numbers(7); } });
    const first = await gatherOps({ sources: src, now: NOW, flags });
    const later = new Date(NOW.getTime() + 120_000);
    const second = await gatherOps({ sources: src, now: later, flags, fresh: true });
    expect(second.numbers).toEqual(first.numbers);
    expect(second.numbersAt).toBe(NOW.toISOString());
    expect(second.at).toBe(later.toISOString());
  });

  it("numbers failing with no previous numbers gives null", async () => {
    const s = await gatherOps({ sources: healthy({ numbers: async () => { throw new Error("x"); } }), now: NOW, flags });
    expect(s.numbers).toBeNull();
    expect(s.numbersAt).toBeNull();
  });

  it("passes window cutoffs computed from now", async () => {
    const seen: Record<string, string> = {};
    const s = healthy({
      swapStats: async (i) => { seen.swap = i; return { lastSwapAt: null, unpriced: 0 }; },
      failures: async (i) => { seen.fail = i; return []; },
      support: async (i) => { seen.support = i; return { count: 0, newestAt: null }; },
      numbers: async (i) => { seen.numbers = i; return numbers(1); },
    });
    await gatherOps({ sources: s, now: NOW, flags });
    expect(seen.swap).toBe(new Date(NOW.getTime() - 86_400_000).toISOString());
    expect(seen.fail).toBe(new Date(NOW.getTime() - 7 * 86_400_000).toISOString());
    expect(seen.support).toBe(seen.fail);
    expect(seen.numbers).toBe(NOW.toISOString());
  });

  it("program fact names coins, and a differing leg is red", async () => {
    const s = await gatherOps({ sources: healthy({ legsEnabled: async () => [true, true, true, false, true, true, true, true] }), now: NOW, flags });
    const l = s.lights.find((x) => x.key === "program")!;
    expect(l.state).toBe("red");
    expect(l.fact).toContain("USDC lend (Jupiter)");
    expect(l.fact).not.toMatch(/\bleg \d/);
  });

  it("liveOff follows the leashLive flag", async () => {
    expect((await gatherOps({ sources: healthy(), now: NOW, flags, fresh: true })).liveOff).toBe(false);
    expect((await gatherOps({ sources: healthy(), now: NOW, flags: { ...flags, leashLive: false }, fresh: true })).liveOff).toBe(true);
  });

  it("numbers carry now.{linkedNow,active7d}; funnel windows do not", async () => {
    const s = await gatherOps({ sources: healthy(), now: NOW, flags });
    expect(s.numbers!.now).toEqual({ linkedNow: 2, active7d: 1 });
    for (const w of ["d1", "d7", "all"] as const) expect(Object.keys(s.numbers!.funnel[w]).sort()).toEqual(["linkedEver", "signIns", "triedLink"]);
  });

  it("every amber/red/unknown light has an action; green/info never do; the action is in the snapshot JSON", async () => {
    const src = healthy({
      firstPlantingLast: async () => null,
      pullerLamports: async () => 10_000_000n,
      support: async () => { throw new Error("x"); },
      failures: async () => [{ kind: "withdraw_failed", ts: new Date(NOW.getTime() - 3_600_000), resolved: false }],
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await gatherOps({ sources: src, now: NOW, flags });
    err.mockRestore();
    const bad = s.lights.filter((l) => ["amber", "red", "unknown"].includes(l.state));
    expect(bad.length).toBeGreaterThanOrEqual(4);
    for (const l of bad) expect(l.action, l.key).toBeTruthy();
    for (const l of s.lights.filter((x) => x.state === "green" || x.state === "info")) expect(l.action).toBeUndefined();
    const parsed = JSON.parse(JSON.stringify(s));
    const money = parsed.lights.find((l: { key: string }) => l.key === "moneyOps");
    expect(money.action).toBe("Ask Claude to check today.");
    expect(money.fact).toContain("a withdrawal failed");
  });

  it("privacy: no full base58 string anywhere in the snapshot", async () => {
    const full = "4Nd1mYQzvgKQuYkVyiN8JSgSkYWwZZaZ5fXhqHzG4eXq";
    const src = healthy({
      linkedWallets: async () => [full, W1],
      webhookAddresses: async () => [W1],
      cronLatest: async () => ({ day: "d", startedAt: NOW, finishedAt: null, ok: null, summary: { wallet: full, planting: { skipped: [{ reason: full }] } } }),
    });
    const s = await gatherOps({ sources: src, now: NOW, flags });
    expect(JSON.stringify(s)).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  });
});

describe("gatherOps robustness", () => {
  it("garbage source data makes that light unknown, not a rejection", async () => {
    const bad = healthy({
      cronLatest: async () => ({ day: "d", startedAt: new Date("nope"), finishedAt: { getTime: () => { throw new Error("x"); } } as unknown as Date, ok: true, summary: null }),
      firstPlantingLast: async () => ({ at: {}, reasons: {} }) as unknown as { at: Date; reasons: Record<string, number> },
      feeds: async () => null as unknown as [],
    });
    const s = await gatherOps({ sources: bad, now: NOW, flags });
    const by = Object.fromEntries(s.lights.map((l) => [l.key, l]));
    expect(by.dailyRun.state).toBe("unknown");
    expect(by.prices.state).toBe("unknown");
    expect(s.lights).toHaveLength(9);
    expect(by.gas.state).toBe("green");
  });

  it("an older overlapping run cannot overwrite newer cache or numbers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = healthy({ numbers: async () => { await gate; return numbers(1); } });
    const fast = healthy({ numbers: async () => numbers(2) });
    const older = gatherOps({ sources: slow, now: NOW, flags });
    const newer = await gatherOps({ sources: fast, now: new Date(NOW.getTime() + 30_000), flags, fresh: true });
    release();
    await older;
    const again = await gatherOps({ sources: fast, now: new Date(NOW.getTime() + 31_000), flags });
    expect(again).toBe(newer);
    const failNums = healthy({ numbers: async () => { throw new Error("x"); } });
    const after = await gatherOps({ sources: failNums, now: new Date(NOW.getTime() + 200_000), flags, fresh: true });
    expect(after.numbers?.funnel.all.signIns).toBe(2);
    expect(after.numbersAt).toBe(new Date(NOW.getTime() + 30_000).toISOString());
  });

  it("redaction strips a full key that really lands in a fact", async () => {
    const full = "4Nd1mYQzvgKQuYkVyiN8JSgSkYWwZZaZ5fXhqHzG4eXq";
    const src = healthy({ cronLatest: async () => ({ day: "d", startedAt: new Date(NOW.getTime() - 3_600_000), finishedAt: new Date(NOW.getTime() - 3_500_000), ok: true, summary: { planting: { skipped: [{ reason: full }] } } }) });
    const s = await gatherOps({ sources: src, now: NOW, flags });
    const l = s.lights.find((x) => x.key === "dailyRun")!;
    expect(l.fact).toContain("skipped: 4Nd1…eXq");
    expect(l.fact).not.toContain(full);
  });
});

describe("programLight names", () => {
  it("uses names when given", () => {
    const l = programLight({ enabled: [true, false], expected: [true, true], leashLive: true, names: ["SKR", "stORE"] });
    expect(l.fact).toBe("Savings option stORE is not in its expected state.");
  });
});
