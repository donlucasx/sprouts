import { describe, it, expect } from "vitest";
import { toGardenInput, heldNow, nextZeroMarks } from "@/lib/garden-input";
import type { MeResponse } from "@/lib/api";
import { bandOf, buildScene, fruitLadder } from "@/model/garden";

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
    const withOne = { ...me, pot: { ...me.pot, skrStakedRaw: "1000" }, history: { ...me.history, plantings: [{ id: "p1", ts: "2026-10-01T10:00:00.000Z", asset: "SKR", usdcInCents: 230, amountOutRaw: "1000", feeCents: 1, signature: null }] } } as unknown as MeResponse;
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

describe("R360: the garden shows only what you hold now (a coin at zero loses its plant and its stake; a later planting starts over)", () => {
  const T = (d: string) => `2026-10-0${d}T10:00:00.000Z`;
  const pl = (id: string, asset: string, day: string) => ({ id, ts: T(day), asset, usdcInCents: 200, amountOutRaw: "1000", feeCents: 0, signature: null });
  const pos = (asset: string, venue: string, receiptRaw: string, valueUsd: number | null) => ({ asset, venue, receiptMint: "M", receiptRaw, underlyingRaw: receiptRaw, valueUsd, ratePct: 4, avg7Pct: 4, earnedUsd: 0, putInCents: 100, withdrawableUsd: null, poolFull: false });
  const base = {
    ...me,
    pot: { ...me.pot, skrStakedRaw: "5000000", skrUsd: 0.02, asOf: "2026-10-05T12:00:00.000Z" },
    holdings: [{ asset: "stORE", heldRaw: "100000000000", putInCents: 200, valueUsd: 2.1, earnedUsd: 0, earnedUnderlyingRaw: "0" }, { asset: "USDC_LEND", heldRaw: "650000", putInCents: 65, valueUsd: 0.65, earnedUsd: 0, earnedUnderlyingRaw: "0" }],
    positions: [pos("USDC_LEND", "jupiter_lend", "610000", 0.65)],
    positionsRead: "ok",
    history: { plantings: [pl("s1", "SKR", "1"), pl("o1", "stORE", "2"), pl("u1", "USDC_LEND", "3")], picks: [] },
  } as unknown as MeResponse;
  const now = new Date("2026-10-05T12:00:00.000Z");
  const assets = (g: ReturnType<typeof toGardenInput>) => [...new Set(g.plantings.map((p) => p.asset))].sort();

  it("every coin held keeps its plantings", () => {
    expect(assets(toGardenInput(base, now))).toEqual(["SKR", "USDC_LEND", "stORE"]);
    expect(heldNow(base)).toMatchObject({ SKR: true, stORE: true, USDC_LEND: true });
  });
  it("a lending position withdrawn in full: its plantings leave the garden (the plant and its stake go)", () => {
    const gone = { ...base, positions: [], holdings: base.holdings.filter((h) => h.asset !== "USDC_LEND") } as MeResponse;
    expect(heldNow(gone).USDC_LEND).toBe(false);
    expect(assets(toGardenInput(gone, now))).toEqual(["SKR", "stORE"]);
    const scene = buildScene(toGardenInput(gone, now));
    expect(scene.parts.some((p) => (p.kind === "plant" || p.kind === "sign") && p.plant === "jitosol")).toBe(false);
  });
  it("under one cent of value is zero (dust); a position with no price yet counts by its receipt", () => {
    const dust = { ...base, positions: [pos("USDC_LEND", "jupiter_lend", "3", 0.000003)] } as unknown as MeResponse;
    expect(heldNow(dust).USDC_LEND).toBe(false);
    const unpriced = { ...base, positions: [pos("USDC_LEND", "jupiter_lend", "610000", null)] } as unknown as MeResponse;
    expect(heldNow(unpriced).USDC_LEND).toBe(true);
  });
  it("a lending read that failed is not a zero: nothing leaves on a bad read", () => {
    const failed = { ...base, positions: [], positionsRead: "failed" } as unknown as MeResponse;
    expect(heldNow(failed).USDC_LEND).toBeNull();
    expect(assets(toGardenInput(failed, now))).toContain("USDC_LEND");
  });
  it("SKR fully unstaked and delivered: the SKR plant and the transplant go; while it sits in the basket it stays", () => {
    const noSkr = { ...base, pot: { ...base.pot, skrStakedRaw: "0", joinedValueRaw: "7" } } as MeResponse;
    expect(heldNow(noSkr).SKR).toBe(false);
    const g = toGardenInput(noSkr, now);
    expect(assets(g)).toEqual(["USDC_LEND", "stORE"]);
    expect(g.joinedValueRaw).toBe(0n);
    const inBasket = { ...noSkr, basket: { id: "b", asset: "SKR", amountRaw: "5000000", unstakeTs: T("4"), readyAt: T("6"), delivered: false, deliveredSignature: null } } as MeResponse;
    expect(heldNow(inBasket).SKR).toBe(true);
  });
  it("stORE sold to zero: its plant goes", () => {
    const sold = { ...base, holdings: base.holdings.filter((h) => h.asset !== "stORE") } as MeResponse;
    expect(assets(toGardenInput(sold, now))).toEqual(["SKR", "USDC_LEND"]);
  });
  it("a later planting into a coin that went to zero starts again from a seedling: plantings at or before the mark are dropped", () => {
    const again = { ...base, history: { ...base.history, plantings: [...base.history.plantings, pl("u2", "USDC_LEND", "5")] } } as unknown as MeResponse;
    const g = toGardenInput(again, now, null, { USDC_LEND: T("3") });
    expect(g.plantings.filter((p) => p.asset === "USDC_LEND").map((p) => p.id)).toEqual(["u2"]);
  });
  it("nextZeroMarks: a coin seen at zero is marked at its newest planting; held or unknown coins are not; marks only move forward", () => {
    const gone = { ...base, positions: [], holdings: base.holdings.filter((h) => h.asset !== "USDC_LEND") } as MeResponse;
    expect(nextZeroMarks(gone, {})).toEqual({ USDC_LEND: T("3") });
    expect(nextZeroMarks(base, {})).toEqual({});
    expect(nextZeroMarks({ ...gone, positionsRead: "failed" } as MeResponse, {})).toEqual({});
    // an API before the read flag: the zero still hides the plant, but no mark is written on it
    expect(nextZeroMarks({ ...gone, positionsRead: undefined } as MeResponse, {})).toEqual({});
    expect(nextZeroMarks(gone, { USDC_LEND: T("4") })).toEqual({ USDC_LEND: T("4") });
    // a planting booked minutes before the read may not show in the balance yet: never marked on it (review)
    const fresh = { ...gone, pot: { ...gone.pot, asOf: "2026-10-03T10:05:00.000Z" } } as MeResponse;
    expect(nextZeroMarks(fresh, {})).toEqual({});
    // a coin with no planting at all is never marked
    expect(nextZeroMarks({ ...gone, history: { plantings: [], picks: [] } } as MeResponse, {})).toEqual({});
  });
  it("R349 agrees: after everything is withdrawn the share stakes do not come back (only a garden that never planted shows them)", () => {
    const empty = { ...base, pot: { ...base.pot, skrStakedRaw: "0" }, holdings: [], positions: [] } as unknown as MeResponse;
    const s = buildScene(toGardenInput(empty, now));
    expect(s.parts.filter((p) => p.kind === "sign")).toEqual([]);
    const fresh = { ...empty, history: { plantings: [], picks: [] } } as unknown as MeResponse;
    expect(buildScene(toGardenInput(fresh, now)).parts.some((p) => p.kind === "sign")).toBe(true);
  });
});
