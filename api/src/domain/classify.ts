import type { SwapLegs } from "./sizing";

/** USDC, USDT, PYUSD, USD1, USDG, hyUSD (11-12: a $50 hyUSD -> USDC swap was labeled memecoin) */
export const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
  "5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E",
]);

/** wSOL, wETH (Wormhole), wBTC (Wormhole), SKR, JUP, ORE, cbBTC (11-08: the garden's own coins were counted as memecoins) */
export const MAJORS = new Set([
  "So11111111111111111111111111111111111111112",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  "oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp",
  "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
]);

/** JitoSOL, mSOL, bSOL, stORE, hSOL, JupSOL (11-08) */
export const LSTS = new Set([
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  "storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR",
  "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A",
  "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v",
]);

/** 11-12: tokenized shares (xStocks, Ondo, Backpack Securities, PreStocks) were labeled memecoins. Migration 0011 allows it. */
export type SwapClass = "stable" | "major" | "LST" | "stock" | "memecoin";

function kind(mint: string, stocks: ReadonlySet<string>): SwapClass {
  if (STABLES.has(mint)) return "stable";
  if (stocks.has(mint)) return "stock";
  if (LSTS.has(mint)) return "LST";
  if (MAJORS.has(mint)) return "major";
  return "memecoin";
}

/**
 * A token list, not a model: anything unknown is a memecoin; otherwise the riskier leg names the swap. `stocks` holds the mints
 * the token's own metadata names as a tokenized share (lib/token-kind); without it no swap is a stock.
 */
export function classifySwap(legs: SwapLegs, stocks: ReadonlySet<string> = new Set()): SwapClass {
  const a = kind(legs.inMint, stocks);
  const b = kind(legs.outMint, stocks);
  if (a === "memecoin" || b === "memecoin") return "memecoin";
  if (a === "stock" || b === "stock") return "stock";
  if (a === "LST" || b === "LST") return "LST";
  if (a === "major" || b === "major") return "major";
  return "stable";
}
