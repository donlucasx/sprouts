import { describe, it, expect } from "vitest";
import { pickAsset, DECIMALS } from "@/domain/allocation";
import { SKR_ONLY, zeroSplit, type Split } from "@/domain/coins";

const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });

// One asset per planting: the coin whose delivered share sits furthest below its target (spec 7.2), now over six coins.
describe("pickAsset", () => {
  it("100/0 always picks SKR", () => expect(pickAsset({ SKR: 5000, stORE: 0 }, SKR_ONLY)).toBe("SKR"));

  it("0/100 always picks stORE", () => expect(pickAsset({}, split({ stORE: 100 }))).toBe("stORE"));

  it("70/30 from zero picks SKR first", () => expect(pickAsset({}, split({ SKR: 70, stORE: 30 }))).toBe("SKR"));

  it("70/30 after 700 SKR and 0 stORE picks stORE", () => expect(pickAsset({ SKR: 700, stORE: 0 }, split({ SKR: 70, stORE: 30 }))).toBe("stORE"));

  it("from an empty ledger, the largest target wins and SKR takes ties", () => {
    expect(pickAsset({}, split({ SKR: 45, hSOL: 20, USDC_LEND: 20, cbBTC: 15 }))).toBe("SKR");
    expect(pickAsset({}, split({ SKR: 30, hSOL: 35, USDC_LEND: 35 }))).toBe("USDC_LEND"); // a tie between two non-SKR legs goes to the first in ASSETS order, and USDC_LEND now precedes hSOL
  });

  it("a target summing under 100 (a share left unpulled, R336 follow-up) is read as proportions of its own total", () => {
    // hSOL 15 / cbBTC 30 is one third / two thirds: after 34 / 66 cbBTC is the one below its share.
    expect(pickAsset({ hSOL: 34, cbBTC: 66 }, split({ hSOL: 15, cbBTC: 30 }))).toBe("cbBTC");
    expect(pickAsset({ hSOL: 32, cbBTC: 68 }, split({ hSOL: 15, cbBTC: 30 }))).toBe("hSOL");
  });

  it("a coin whose target is 0 is never picked, even with an empty ledger entry", () => {
    expect(pickAsset({ SKR: 100 }, split({ SKR: 50, hSOL: 50 }))).toBe("hSOL");
    expect(pickAsset({ SKR: 100, cbBTC: 0 }, split({ SKR: 50, hSOL: 50 }))).not.toBe("cbBTC");
  });

  it("converges: twenty $2 plantings at 45/20/20/15 give 9/4/4/3", () => {
    const ledger: Record<string, number> = {};
    const target = split({ SKR: 45, hSOL: 20, USDC_LEND: 20, cbBTC: 15 });
    for (let i = 0; i < 20; i++) {
      const a = pickAsset(ledger, target);
      ledger[a] = (ledger[a] ?? 0) + 200;
    }
    expect(ledger).toEqual({ SKR: 1800, hSOL: 800, USDC_LEND: 800, cbBTC: 600 });
  });

  it("a legacy two-key ledger still works", () => {
    expect(pickAsset({ SKR: 200, stORE: 0 }, split({ SKR: 50, stORE: 50 }))).toBe("stORE");
  });
});

describe("DECIMALS", () => {
  it("names each asset's decimals from the mint", () => {
    expect(DECIMALS).toEqual({ SKR: 6, stORE: 11, USDC_LEND: 6, SOL_LEND: 9, hSOL: 9, cbBTC: 8, JitoSOL: 9, JupSOL: 9 });
    expect(Number(122_495_137n) / 10 ** DECIMALS.stORE).toBeCloseTo(0.00122, 4);
  });
});
