import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import type { CoinDayRow } from "@/db/types";
import { snapshotCoins, growth, priceChange, type CoinReads } from "@/lib/coin-data";
import { COINS } from "@/domain/coins";

const NOW = new Date("2026-10-02T14:00:00Z");
const u64 = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };
/** A minimal pool account: totals at the fixed offsets and an all-None tail (the parser's layout). */
function poolBytes(total: bigint, supply: bigint, epoch: bigint, lastSupply: bigint, lastTotal: bigint): Uint8Array {
  return Buffer.concat([Buffer.from([1]), Buffer.alloc(32 * 3), Buffer.from([255]), Buffer.alloc(32 * 5), u64(total), u64(supply), u64(epoch), Buffer.alloc(48), Buffer.alloc(16),
    Buffer.from([0, 0, 0]), Buffer.alloc(16), Buffer.alloc(16), Buffer.from([0, 0, 0]), Buffer.alloc(16), Buffer.from([0, 0]), Buffer.alloc(16), Buffer.from([0]), u64(lastSupply), u64(lastTotal)]);
}
function fakeReads(over: Partial<CoinReads> = {}): CoinReads {
  return {
    accountData: async () => poolBytes(1_200_000n, 1_000_000n, 1046n, 999_000n, 1_198_000n),
    skrSharePrice: async () => 1_147_028_992n,
    storeRate: async () => 1_049_604_560n,
    currentEpoch: async () => 1046n,
    prices: async (mints) => Object.fromEntries(mints.map((m) => [m, { usdPrice: 100, liquidity: 1e8, priceChange24h: 0.5, decimals: 9 }])),
    quoteOk: async () => true,
    ...over,
  };
}

describe("snapshotCoins (spec 5.2)", () => {
  it("writes one row per coin with the rate for its kind, prices, and tradeable", async () => {
    const repo = new MemoryRepo();
    const rows = await snapshotCoins({ repo, now: NOW, reads: fakeReads() });
    expect(rows.length).toBe(6);
    const by = Object.fromEntries(rows.map((r) => [r.asset, r]));
    expect(by.hSOL.rate).toBeCloseTo(1.2, 6);
    expect(by.hSOL.ratePrev).toBeCloseTo(1.198 / 0.999, 6);
    expect(by.hSOL.ratePrevDays).toBe(2);
    expect(by.SKR.rate).toBeCloseTo(1.147029, 6);
    expect(by.stORE.rate).toBeCloseTo(1.0496, 4);
    expect(by.cbBTC.rate).toBeNull();
    expect(rows.every((r) => r.ok && r.tradeable && r.priceUsd === 100)).toBe(true);
    expect((await repo.getCoinDay("2026-10-02", "JupSOL"))?.ok).toBe(true);
  });

  it("one coin's failed read does not block the others, and is marked no data with an event", async () => {
    const repo = new MemoryRepo();
    const rows = await snapshotCoins({ repo, now: NOW, reads: fakeReads({ storeRate: async () => { throw new Error("rpc down"); } }) });
    const by = Object.fromEntries(rows.map((r) => [r.asset, r]));
    expect(by.stORE.ok).toBe(false);
    expect(by.hSOL.ok).toBe(true);
    expect(repo.events.some((e) => e.kind === "coin_no_data" && (e.detail as { asset: string }).asset === "stORE")).toBe(true);
  });

  it("a pool two epochs behind is no data; SKR never needs a quote; a bad quote makes a coin not tradeable", async () => {
    const repo = new MemoryRepo();
    const quoted: string[] = [];
    const rows = await snapshotCoins({ repo, now: NOW, reads: fakeReads({ currentEpoch: async () => 1048n, quoteOk: async (a) => { quoted.push(a); return a !== "cbBTC"; } }) });
    const by = Object.fromEntries(rows.map((r) => [r.asset, r]));
    expect(by.hSOL.ok).toBe(false);
    expect(by.JitoSOL.ok).toBe(false);
    expect(quoted).not.toContain("SKR");
    expect(by.SKR.tradeable).toBe(true);
    expect(by.cbBTC.tradeable).toBe(false);
    expect(by.cbBTC.ok).toBe(true);
  });

  it("a failed epoch read is logged, not swallowed, and the snapshot still lands", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const rows = await snapshotCoins({ repo: new MemoryRepo(), now: NOW, reads: fakeReads({ currentEpoch: async () => { throw new Error("rpc down"); } }) });
      expect(rows.length).toBe(6);
      expect(spy.mock.calls.some((c) => /snapshot: epoch read failed: rpc down/.test(String(c[0])))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it("a failed price call leaves prices null but the rates still land", async () => {
    const repo = new MemoryRepo();
    const rows = await snapshotCoins({ repo, now: NOW, reads: fakeReads({ prices: async () => { throw new Error("429"); } }) });
    expect(rows.every((r) => r.priceUsd === null)).toBe(true);
    expect(rows.find((r) => r.asset === "hSOL")?.ok).toBe(true);
  });
});

const row = (day: string, rate: number | null, extra: Partial<CoinDayRow> = {}): CoinDayRow => ({ day, asset: "hSOL", rate, ratePrev: null, ratePrevDays: null, priceUsd: null, liquidityUsd: null, priceChange24h: null, tradeable: true, lastUpdateEpoch: 1046, ok: true, ...extra });

describe("growth (spec 5.3)", () => {
  it("annualises today against the oldest good row within seven days", () => {
    const g = growth([row("2026-09-25", 1.180), row("2026-09-28", 1.1812), row("2026-10-02", 1.1830)]);
    expect(g.days).toBe(7);
    expect(g.pct).toBeCloseTo((Math.pow(1.183 / 1.18, 365 / 7) - 1) * 100, 6);
  });
  it("uses the day-one seed when no older row exists", () => {
    const g = growth([row("2026-10-02", 1.1830, { ratePrev: 1.18279, ratePrevDays: 2 })]);
    expect(g.days).toBe(2);
    expect(g.pct).toBeCloseTo((Math.pow(1.183 / 1.18279, 365 / 2) - 1) * 100, 6);
  });
  it("is collecting with one row and no seed, or when today is no data", () => {
    expect(growth([row("2026-10-02", 1.183)])).toEqual({ pct: null, days: 0 });
    expect(growth([row("2026-10-01", 1.18), row("2026-10-02", null, { ok: false })])).toEqual({ pct: null, days: 0 });
  });
  it("skips a bad row in the window", () => {
    const g = growth([row("2026-09-30", null, { ok: false }), row("2026-10-01", 1.182), row("2026-10-02", 1.183)]);
    expect(g.days).toBe(1);
  });
});

describe("priceChange", () => {
  it("is the move from the oldest row within seven days, with its span", () => {
    const p = priceChange([row("2026-09-29", 1, { priceUsd: 140 }), row("2026-10-02", 1, { priceUsd: 147 })]);
    expect(p.days).toBe(3);
    expect(p.pct).toBeCloseTo(5, 6);
    expect(priceChange([row("2026-10-02", 1, { priceUsd: 147 })])).toEqual({ pct: null, days: 0 });
  });
});
