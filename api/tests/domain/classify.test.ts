import { describe, it, expect } from "vitest";
import { classifySwap } from "@/domain/classify";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const WSOL = "So11111111111111111111111111111111111111112";
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const legs = (a: string, b: string) => ({ wallet: "w", inMint: a, inAmount: 1, outMint: b, outAmount: 1 });

describe("classifySwap", () => {
  it("stable to stable is stable", () => expect(classifySwap(legs(USDC, USDT))).toBe("stable"));
  it("SOL to USDC is major", () => expect(classifySwap(legs(WSOL, USDC))).toBe("major"));
  it("SOL to JitoSOL is LST", () => expect(classifySwap(legs(WSOL, JITOSOL))).toBe("LST"));
  it("11-08: the garden's own coins are not memecoins (ORE and cbBTC major, hSOL and JupSOL LST)", () => {
    expect(classifySwap(legs(USDC, "oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp"))).toBe("major");
    expect(classifySwap(legs(WSOL, "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"))).toBe("major");
    expect(classifySwap(legs(WSOL, "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A"))).toBe("LST");
    expect(classifySwap(legs(WSOL, "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v"))).toBe("LST");
  });
  it("anything unknown is memecoin", () => expect(classifySwap(legs(USDC, BONK))).toBe("memecoin"));
  it("SOL to unknown is memecoin", () => expect(classifySwap(legs(WSOL, "Unknown111"))).toBe("memecoin"));
});
