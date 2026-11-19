import { describe, it, expect } from "vitest";
import { ASSETS, zeroSplit, type Split } from "@/domain/coins";
import { coinOpening, OPEN_STEP_CENTS } from "@/domain/opening";
import { plantingTarget } from "@/lib/plant-run";

const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });

describe("coinOpening (season 11-23, slow opening)", () => {
  it("one new coin per $5 planted", () => {
    expect(OPEN_STEP_CENTS).toBe(500);
  });

  it("a new user: the largest share opens first, the next waits for $5", () => {
    expect(coinOpening([], split({ SKR: 60, USDC_LEND: 40 }))).toEqual({ open: [], plantedCents: 0, waiting: [{ asset: "USDC_LEND", afterCents: 500 }] });
  });

  it("the second coin joins at exactly $5", () => {
    expect(coinOpening([{ SKR: 499 }], split({ SKR: 60, USDC_LEND: 40 })).waiting).toEqual([{ asset: "USDC_LEND", afterCents: 500 }]);
    expect(coinOpening([{ SKR: 500 }], split({ SKR: 60, USDC_LEND: 40 })).waiting).toEqual([]);
  });

  it("ties queue in ASSETS order", () => {
    const o = coinOpening([{ SKR: 700 }], split({ SKR: 40, USDC_LEND: 20, hSOL: 20, cbBTC: 20 }));
    expect(o.waiting).toEqual([{ asset: "hSOL", afterCents: 1000 }, { asset: "cbBTC", afterCents: 1500 }]);
  });

  it("two wallets: open kinds and planted dollars are the user's, summed across wallets", () => {
    expect(coinOpening([{ SKR: 300 }, { cbBTC: 300 }], split({ SKR: 40, cbBTC: 30, hSOL: 30 })))
      .toEqual({ open: ["SKR", "cbBTC"], plantedCents: 600, waiting: [{ asset: "hSOL", afterCents: 1000 }] });
  });

  it("a key with value 0 is open", () => {
    expect(coinOpening([{ hSOL: 0 }], split({ SKR: 100 })).open).toEqual(["hSOL"]);
  });

  it("retired coins count toward planted dollars but are never open", () => {
    expect(coinOpening([{ JitoSOL: 500 }], split({ SKR: 50, hSOL: 50 }))).toEqual({ open: [], plantedCents: 500, waiting: [] });
  });

  it("already over-opened: a fifth coin waits until $20", () => {
    const o = coinOpening([{ SKR: 150, stORE: 150, hSOL: 150, cbBTC: 150 }], split({ SKR: 40, stORE: 10, hSOL: 20, cbBTC: 10, USDC_LEND: 20 }));
    expect(o.plantedCents).toBe(600);
    expect(o.waiting).toEqual([{ asset: "USDC_LEND", afterCents: 2000 }]);
  });

  it("the only open coin switched off: the next coin opens anyway (never stalled)", () => {
    expect(coinOpening([{ cbBTC: 300 }], split({ SKR: 100 })).waiting).toEqual([]);
    // the rest keep their place in the queue behind it
    expect(coinOpening([{ cbBTC: 300 }], split({ SKR: 50, hSOL: 50 })).waiting).toEqual([{ asset: "hSOL", afterCents: 1000 }]);
  });

  it("a single-coin user and a 100% lending user never wait", () => {
    expect(coinOpening([{ SKR: 100 }], split({ SKR: 100 })).waiting).toEqual([]);
    expect(coinOpening([{ USDC_LEND: 100 }], split({ USDC_LEND: 100 })).waiting).toEqual([]);
  });
});

describe("plantingTarget with waiting coins", () => {
  it("waiting coins get 0 and the target still sums to 100", () => {
    const t = plantingTarget({ managed: false, stop: "balanced", allocation: split({ SKR: 50, hSOL: 30, cbBTC: 20 }), pins: {} }, [], ["hSOL", "cbBTC"]);
    expect(t?.hSOL).toBe(0);
    expect(t?.cbBTC).toBe(0);
    expect(ASSETS.reduce((s, c) => s + t![c], 0)).toBeCloseTo(100, 9);
  });
});
