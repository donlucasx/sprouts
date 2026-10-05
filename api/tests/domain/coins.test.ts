import { describe, it, expect } from "vitest";
import { ASSETS, RETIRED, ALL_ASSETS, LEND_ASSETS, COINS, DECIMALS, SKR_ONLY, isAsset, isLiveAsset, isLendAsset, sameSplit, zeroSplit, toSplit } from "@/domain/coins";

// Contracts 1.1: six live legs in spec 2 order, two retired legs readable in history only.
describe("the leg registry", () => {
  it("lists the six live legs in order and the two retired ones apart", () => {
    expect(ASSETS).toEqual(["SKR", "stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC"]);
    expect(RETIRED).toEqual(["JitoSOL", "JupSOL"]);
    expect(ALL_ASSETS).toEqual(["SKR", "stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC", "JitoSOL", "JupSOL"]);
    expect(LEND_ASSETS).toEqual(["USDC_LEND", "SOL_LEND"]);
  });

  it("pins mints, underlying decimals, fees and where each leg is held", () => {
    expect(COINS.USDC_LEND.mint).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(COINS.SOL_LEND.mint).toBe("So11111111111111111111111111111111111111112");
    expect(COINS.cbBTC.mint).toBe("cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij");
    expect(DECIMALS).toEqual({ SKR: 6, stORE: 11, USDC_LEND: 6, SOL_LEND: 9, hSOL: 9, cbBTC: 8, JitoSOL: 9, JupSOL: 9 });
    expect(ASSETS.map((a) => COINS[a].feeBps)).toEqual([50, 50, 0, 0, 50, 50]);
    expect(ASSETS.map((a) => COINS[a].held)).toEqual(["staked", "wallet", "venue", "venue", "wallet", "wallet"]);
    expect(COINS.USDC_LEND.kind).toBe("lend");
    expect(COINS.USDC_LEND.name).toBe("USDC lending");
    expect(COINS.SOL_LEND.name).toBe("SOL lending");
    expect(COINS.JitoSOL.live).toBe(false);
    expect(COINS.hSOL.live).toBe(true);
  });

  it("lending plants reuse the JitoSOL and JupSOL species (contracts 7.1)", () => {
    expect(ASSETS.map((a) => COINS[a].plant)).toEqual(["skr", "ore", "jitosol", "jupsol", "hsol", "cbbtc"]);
  });

  it("helpers: six-key splits, retired shares fold into SKR, guards", () => {
    expect(zeroSplit()).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 });
    expect(SKR_ONLY).toEqual({ SKR: 100, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 });
    expect(toSplit({ SKR: 45, hSOL: 20, JitoSOL: 15, JupSOL: 10, cbBTC: 10 })).toEqual({ SKR: 70, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 20, cbBTC: 10 });
    expect(toSplit(null)).toEqual(SKR_ONLY);
    expect(isAsset("JitoSOL")).toBe(true);
    expect(isLiveAsset("JitoSOL")).toBe(false);
    expect(isLiveAsset("USDC_LEND")).toBe(true);
    expect(isLendAsset("SOL_LEND")).toBe(true);
    expect(isLendAsset("hSOL")).toBe(false);
    expect(sameSplit(SKR_ONLY, { ...SKR_ONLY })).toBe(true);
  });
});
