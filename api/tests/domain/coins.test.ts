import { describe, it, expect } from "vitest";
import { ASSETS, COINS, DECIMALS, SKR_ONLY, isAsset, sameSplit, zeroSplit } from "@/domain/coins";

// Spec 5.1: six coins, mints pinned in code, decimals from the mints (LSTs 9, cbBTC 8, confirmed from Jupiter price v3 2026-09-30).
describe("the coin registry", () => {
  it("names the six coins in the garden's order", () => {
    expect(ASSETS).toEqual(["SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"]);
  });

  it("pins every mint and its decimals", () => {
    expect(COINS.SKR.mint).toBe("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
    expect(COINS.stORE.mint).toBe("storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR");
    expect(COINS.hSOL.mint).toBe("he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A");
    expect(COINS.JitoSOL.mint).toBe("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
    expect(COINS.JupSOL.mint).toBe("jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v");
    expect(COINS.cbBTC.mint).toBe("cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij");
    expect(DECIMALS).toEqual({ SKR: 6, stORE: 11, hSOL: 9, JitoSOL: 9, JupSOL: 9, cbBTC: 8 });
  });

  it("knows where each coin is held and which pool measures it", () => {
    expect(COINS.SKR.held).toBe("staked");
    for (const a of ["stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const) expect(COINS[a].held).toBe("wallet");
    expect(COINS.hSOL.pool).toBe("3wK2g8ZdzAH8FJ7PKr2RcvGh7V9VYson5hrVsJM5Lmws");
    expect(COINS.JitoSOL.pool).toBe("Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb");
    expect(COINS.JupSOL.pool).toBe("8VpRhuxa7sUUepdY3kQiTmX9rS5vx4WgaXiAnXq4KCtr".replace("KCtn", "KCtr"));
    expect(COINS.cbBTC.pool).toBeNull();
    expect(COINS.cbBTC.kind).toBe("btc");
  });

  it("gives each coin its own plant", () => {
    expect(ASSETS.map((a) => COINS[a].plant)).toEqual(["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"]);
  });

  it("helpers: zeroSplit, SKR_ONLY, isAsset, sameSplit", () => {
    expect(Object.values(zeroSplit()).every((v) => v === 0)).toBe(true);
    expect(SKR_ONLY).toEqual({ SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 });
    expect(isAsset("hSOL")).toBe(true);
    expect(isAsset("hsol")).toBe(false);
    expect(sameSplit(SKR_ONLY, { ...SKR_ONLY })).toBe(true);
    expect(sameSplit(SKR_ONLY, { ...SKR_ONLY, SKR: 99, hSOL: 1 })).toBe(false);
  });
});
