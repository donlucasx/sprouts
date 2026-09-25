import { describe, it, expect } from "vitest";
import { usdSizeCents, WSOL } from "@/domain/sizing";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const prices = async (m: string) => (m === WSOL ? 150 : m === USDC ? 1 : null);

describe("usdSizeCents", () => {
  it("uses the USDC leg as is", async () => {
    expect(await usdSizeCents({ wallet: "w", inMint: USDC, inAmount: 12.34, outMint: BONK, outAmount: 1e6 }, prices)).toBe(1234);
  });

  it("prices a SOL leg", async () => {
    expect(await usdSizeCents({ wallet: "w", inMint: BONK, inAmount: 1e6, outMint: WSOL, outAmount: 0.01 }, prices)).toBe(150);
  });

  it("prefers the stable leg when both a stable and SOL are present", async () => {
    expect(await usdSizeCents({ wallet: "w", inMint: WSOL, inAmount: 1, outMint: USDC, outAmount: 149.5 }, prices)).toBe(14950);
  });

  it("unpriced swap books zero: returns null when no leg has a price", async () => {
    expect(await usdSizeCents({ wallet: "w", inMint: BONK, inAmount: 5, outMint: "Other111", outAmount: 5 }, prices)).toBeNull();
  });

  it("rounds to whole cents", async () => {
    expect(await usdSizeCents({ wallet: "w", inMint: USDC, inAmount: 0.005, outMint: BONK, outAmount: 1 }, prices)).toBe(1);
  });
});
