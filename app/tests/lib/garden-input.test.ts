import { describe, it, expect } from "vitest";
import { toGardenInput } from "@/lib/garden-input";
import type { MeResponse } from "@/lib/api";
import { bandOf, fruitLadder } from "@/model/garden";

const me = {
  user: { pubkey: "U", skrName: null, joinedAt: "2026-09-25T00:00:00.000Z", wateredAt: null },
  pot: { skrStakedRaw: "0", skrPutInRaw: "0", skrEarnedRaw: "0", skrPickedRaw: "0", skrPrincipalPickedRaw: "0", joinedValueRaw: "0", fruit: 0, nextFruitProgress: 0, skrUnstakingRaw: "0", skrUnstakeReadyAt: null, storeRaw: "0", storePutInRaw: "100000000000", storeEarnedRaw: "0", storeRedeemRate: null, skrUsd: null, storeUsd: null, asOf: "2026-10-01T00:00:00.000Z" },
  holdings: [{ asset: "stORE", heldRaw: "100000000000", putInCents: 200, valueUsd: 2.1, earnedUsd: 0.025, earnedUnderlyingRaw: "1" }],
  manager: { managed: false, stop: "balanced", pins: {}, changedDay: null, undoAvailable: false, why: null, fallback: null, stopSplit: { SKR: 45, stORE: 0, hSOL: 20, USDC_LEND: 15, SOL_LEND: 10, cbBTC: 10 } },
  history: { plantings: [], picks: [] },
  nextPlanting: { pendingCents: 0, thresholdCents: 200, capLeftCents: 500, asset: "SOL_LEND" },
  lastReceipt: null, basket: null, wallets: [],
  rules: { roundupOn: true, roundupToCents: 100, pctOn: true, pctBps: 100, pctThresholdCents: 10000, plantThresholdCents: 200, plantMaxDays: 7, dailyCapCents: 500, managed: false, stop: "balanced", pins: {}, allocation: { SKR: 100, stORE: 0, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 } },
} as unknown as MeResponse;

describe("toGardenInput", () => {
  it("feeds stORE's earned from its holding's ladder, and the next asset from the API", () => {
    const g = toGardenInput(me, new Date("2026-10-01T12:00:00-07:00"));
    expect(g.earned.stORE?.count).toBe(2);   // 0.025 / 2.00 = 1.25%: the first at 0.25%, one more at 1.25%
    expect(g.earned.stORE?.progress).toBeCloseTo(0, 6);
    expect(g.nextAsset).toBe("SOL_LEND");
  });
  it("no stORE holding means no stORE earned", () => {
    const g = toGardenInput({ ...me, holdings: [] }, new Date());
    expect(g.earned.stORE).toBeUndefined();
  });
});

describe("the garden's new inputs (spec 5, 10)", () => {
  it("passes each planting's cents and reads today's split from rules.allocation, never from the manager block", () => {
    const withOne = { ...me, history: { ...me.history, plantings: [{ id: "p1", ts: "2026-10-01T10:00:00.000Z", asset: "SKR", usdcInCents: 230, amountOutRaw: "1000", feeCents: 1, signature: null }] } } as unknown as MeResponse;
    const g = toGardenInput(withOne, new Date("2026-10-01T12:00:00-07:00"));
    expect(g.plantings[0].usdcInCents).toBe(230);
    expect(g.allocation).toEqual({ SKR: 100, stORE: 0, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 });   // rules.allocation, not manager.stopSplit (which the fixture sets to Balanced)
  });
  it("earned per coin: SKR from the pot, the others from their holding's ladder, null earned is none", () => {
    const g = toGardenInput({ ...me, pot: { ...me.pot, fruit: 2, nextFruitProgress: 0.4 }, holdings: [...me.holdings, { asset: "cbBTC", heldRaw: "1", putInCents: 300, valueUsd: null, earnedUsd: null, earnedUnderlyingRaw: null }] } as unknown as MeResponse, new Date());
    expect(g.earned.SKR).toEqual({ count: 2, progress: 0.4 });
    expect(g.earned.stORE).toEqual(fruitLadder(0.025, 200));
    expect(g.earned.cbBTC).toBeUndefined();
  });
  it("bands: under $1 small, $1 to $5 usual, over $5 large; a 0 (no leg row) reads usual, never small (RG4)", () => {
    expect([0, 1, 99, 100, 500, 501, 2000].map(bandOf)).toEqual([1, 0, 0, 1, 1, 2, 2]);
  });
  it("the ladder: nothing below a quarter percent, the first at it, then one per percent, 1.25 percent is two, capped at 12 (R59)", () => {
    expect(fruitLadder(0, 200)).toEqual({ count: 0, progress: 0 });
    expect(fruitLadder(0.004, 200).count).toBe(0); expect(fruitLadder(0.005, 200).count).toBe(1);
    expect(fruitLadder(0.025, 200).count).toBe(2); expect(fruitLadder(0.03, 200).count).toBe(2); expect(fruitLadder(0.03, 200).progress).toBeCloseTo(0.25, 9);   // 0.24999999999999986 in floats
    expect(fruitLadder(100, 200).count).toBe(12);
  });
});
