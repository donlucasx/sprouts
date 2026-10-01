import { describe, it, expect } from "vitest";
import { toGardenInput } from "@/lib/garden-input";
import type { MeResponse } from "@/lib/api";

const me = {
  user: { pubkey: "U", skrName: null, joinedAt: "2026-09-25T00:00:00.000Z", wateredAt: null },
  pot: { skrStakedRaw: "0", skrPutInRaw: "0", skrEarnedRaw: "0", skrPickedRaw: "0", skrPrincipalPickedRaw: "0", joinedValueRaw: "0", fruit: 0, nextFruitProgress: 0, skrUnstakingRaw: "0", skrUnstakeReadyAt: null, storeRaw: "0", storePutInRaw: "100000000000", storeEarnedRaw: "0", storeRedeemRate: null, skrUsd: null, storeUsd: null, asOf: "2026-10-01T00:00:00.000Z" },
  holdings: [{ asset: "stORE", heldRaw: "100000000000", putInCents: 200, valueUsd: 2.1, earnedUsd: 0.025, earnedUnderlyingRaw: "1" }],
  manager: { managed: false, stop: "balanced", pins: {}, changedDay: null, undoAvailable: false, why: null, fallback: null, stopSplit: { SKR: 45, stORE: 0, hSOL: 20, JitoSOL: 15, JupSOL: 10, cbBTC: 10 } },
  history: { plantings: [], picks: [] },
  nextPlanting: { pendingCents: 0, thresholdCents: 200, capLeftCents: 500, asset: "JupSOL" },
  lastReceipt: null, basket: null, wallets: [],
  rules: { roundupOn: true, roundupToCents: 100, pctOn: true, pctBps: 100, pctThresholdCents: 10000, plantThresholdCents: 200, plantMaxDays: 7, dailyCapCents: 500, managed: false, stop: "balanced", pins: {}, allocation: { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 } },
} as unknown as MeResponse;

describe("toGardenInput", () => {
  it("feeds the ORE pups from the stORE holding's earned and put in, and the next asset from the API", () => {
    const g = toGardenInput(me, new Date("2026-10-01T12:00:00-07:00"));
    expect(g.storePups).toBe(2);        // 0.025 / 2.00 = 1.25%: the first at 0.25%, one more at 1.25%
    expect(g.storeNextPupProgress).toBeCloseTo(0, 6);
    expect(g.nextAsset).toBe("JupSOL");
  });
  it("no stORE holding means no pups", () => {
    const g = toGardenInput({ ...me, holdings: [] }, new Date());
    expect(g.storePups).toBe(0);
  });
});
