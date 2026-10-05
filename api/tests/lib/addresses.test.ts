import { describe, it, expect } from "vitest";
import { KLEND, KLEND_MARKET, KLEND_LMA, JLEND, JLEND_LENDING_ADMIN, JLEND_LIQUIDITY, PYTH_ACCOUNT, PYTH_FEED, RECEIPT } from "@/lib/venues/addresses";
import { LEASH_PROGRAM, LEASH_ADMIN, KLEND_PROGRAM, JLEND_PROGRAM, JLEND_LIQUIDITY_PROGRAM, PYTH_RECEIVER } from "@/lib/constants";

// Golden test of contracts 1.4 (addresses read on mainnet 2026-10-04): a retyped character fails here, not on chain.
describe("pinned venue addresses", () => {
  it("programs, the leash and its admin", () => {
    expect([KLEND_PROGRAM, JLEND_PROGRAM, JLEND_LIQUIDITY_PROGRAM, PYTH_RECEIVER]).toEqual([
      "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD", "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9", "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC", "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ",
    ]);
    expect(LEASH_PROGRAM).toBe("GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7");
    expect(LEASH_ADMIN).toBe("GrHSwzYpgiFzuTpwR6539NpNXktXNEUfVU9UYvHdDKLY");
  });
  it("K-Lend main market, pinned reserves (never 'the best reserve')", () => {
    expect(KLEND_MARKET).toBe("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
    expect(KLEND_LMA).toBe("9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo");
    expect(KLEND.USDC_LEND).toEqual({ reserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59", liquidityMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", supplyVault: "Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6", collateralMint: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D", scopePrices: "3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH" });
    expect(KLEND.SOL_LEND).toEqual({ reserve: "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q", liquidityMint: "So11111111111111111111111111111111111111112", supplyVault: "GafNuUXj9rxGLn4y79dPu6MHSuPWeJR6UtTWuexpGh3U", collateralMint: "2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1", scopePrices: "3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH" });
  });
  it("Jupiter Lend static accounts per asset", () => {
    expect(JLEND_LENDING_ADMIN).toBe("5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6");
    expect(JLEND_LIQUIDITY).toBe("7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z");
    expect(JLEND.USDC_LEND).toEqual({ lending: "2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ", fTokenMint: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", supplyTokenReservesLiquidity: "94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu", lendingSupplyPositionOnLiquidity: "Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF", rateModel: "5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688", vault: "BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB", rewardsRateModel: "5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd", claimAccount: "HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW" });
    expect(JLEND.SOL_LEND).toEqual({ lending: "BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3", fTokenMint: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", mint: "So11111111111111111111111111111111111111112", supplyTokenReservesLiquidity: "4Y66HtUEqbbbpZdENGtFdVhUMS3tnagffn3M4do59Nfy", lendingSupplyPositionOnLiquidity: "4SkEYxmiRgQ4VYyvh9VB4k39M49BpqazyzDUFDzJhXQm", rateModel: "Acvyi9HBGmqh3Exe1N4PjBVyY8fokq2AdC6fSLqV6KSo", vault: "5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr", rewardsRateModel: "CkeQGDRsgMZcCaU8cZEdC2aFAohia4jLzL36RaLcUDsR", claimAccount: "6AQGR8zK4KTVZfZ9UZaRzyEL5ynvwVaF5ywVdmtJT24N" });
  });
  it("receipts and Pyth", () => {
    expect(RECEIPT.USDC_LEND.kamino_klend).toEqual({ mint: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D", decimals: 6 });
    expect(RECEIPT.SOL_LEND.kamino_klend).toEqual({ mint: "2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1", decimals: 6 });
    expect(RECEIPT.SOL_LEND.jupiter_lend).toEqual({ mint: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", decimals: 9 });
    expect(PYTH_ACCOUNT).toEqual({ SOL: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE", CBBTC: "7oqYpv5YbjJ2PEsNeVVB5ZEZ8ZE6ufkj8hAvAiaiftbe", ORE: "GYYQ8gbX4Tndc4WMJ9jSjZTePTvbmgRRxByt54ZQYqvZ" });
    expect(PYTH_FEED.SKR).toBe("38846ec4d0dbe808091817f5c0d6ab8058e25422348ddf97db52b6c378a93bf9");
    expect(PYTH_FEED.ORE).toBe("142b804c658e14ff60886783e46e5a51bdf398b4871d9d8f7c28aa1585cad504");
  });
});
