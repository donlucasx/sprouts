import type { SwapLegs } from "./sizing";

/** USDC, USDT, PYUSD */
export const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
]);

/** wSOL, wETH (Wormhole), wBTC (Wormhole), SKR, JUP */
export const MAJORS = new Set([
  "So11111111111111111111111111111111111111112",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
]);

/** JitoSOL, mSOL, bSOL, stORE */
export const LSTS = new Set([
  "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1",
  "storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR",
]);

export type SwapClass = "stable" | "major" | "LST" | "memecoin";

function kind(mint: string): SwapClass {
  if (STABLES.has(mint)) return "stable";
  if (LSTS.has(mint)) return "LST";
  if (MAJORS.has(mint)) return "major";
  return "memecoin";
}

/** A token list, not a model: anything unknown is a memecoin; otherwise the riskier leg names the swap. */
export function classifySwap(legs: SwapLegs): SwapClass {
  const a = kind(legs.inMint);
  const b = kind(legs.outMint);
  if (a === "memecoin" || b === "memecoin") return "memecoin";
  if (a === "LST" || b === "LST") return "LST";
  if (a === "major" || b === "major") return "major";
  return "stable";
}
