import { address, type Address } from "@solana/kit";
import { SKR_MINT, STORE_MINT } from "@/lib/constants";

/**
 * The closed list of coins Sprouts can plant (spec 5.1, R108): mints pinned here and nowhere else. The planting asserts the swap's
 * output mint against this table before the puller signs, and the model never sees a mint, only these names.
 */
export type Asset = "SKR" | "stORE" | "hSOL" | "JitoSOL" | "JupSOL" | "cbBTC";
export const ASSETS: readonly Asset[] = ["SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const;

export type CoinKind = "skr" | "store" | "lst" | "btc";
export type Coin = {
  asset: Asset;
  mint: Address;
  decimals: number;
  kind: CoinKind;
  /** SKR is staked into the position only the Seed Vault key can unstake; every other coin sits in the Seed Vault wallet. */
  held: "staked" | "wallet";
  /** The SPL stake pool that measures an LST's growth (SOL per token); null for the others. */
  pool: Address | null;
  /** The garden's plant id (R108: each coin its own plant). */
  plant: string;
  name: string;
};

export const COINS: Record<Asset, Coin> = {
  SKR: { asset: "SKR", mint: SKR_MINT, decimals: 6, kind: "skr", held: "staked", pool: null, plant: "skr", name: "SKR" },
  stORE: { asset: "stORE", mint: STORE_MINT, decimals: 11, kind: "store", held: "wallet", pool: null, plant: "ore", name: "stORE" },
  hSOL: { asset: "hSOL", mint: address("he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A"), decimals: 9, kind: "lst", held: "wallet", pool: address("3wK2g8ZdzAH8FJ7PKr2RcvGh7V9VYson5hrVsJM5Lmws"), plant: "hsol", name: "hSOL" },
  JitoSOL: { asset: "JitoSOL", mint: address("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"), decimals: 9, kind: "lst", held: "wallet", pool: address("Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb"), plant: "jitosol", name: "JitoSOL" },
  JupSOL: { asset: "JupSOL", mint: address("jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v"), decimals: 9, kind: "lst", held: "wallet", pool: address("8VpRhuxa7sUUepdY3kQiTmX9rS5vx4WgaXiAnXq4KCtr"), plant: "jupsol", name: "JupSOL" },
  cbBTC: { asset: "cbBTC", mint: address("cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"), decimals: 8, kind: "btc", held: "wallet", pool: null, plant: "cbbtc", name: "cbBTC" },
};

export const DECIMALS: Record<Asset, number> = Object.fromEntries(ASSETS.map((a) => [a, COINS[a].decimals])) as Record<Asset, number>;

/** A split of new round-ups in whole percents, one entry per coin, summing to 100. */
export type Split = Record<Asset, number>;
export type Stop = "careful" | "balanced" | "bold";
export const STOP_ORDER: readonly Stop[] = ["careful", "balanced", "bold"] as const;

export const zeroSplit = (): Split => ({ SKR: 0, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 });
export const SKR_ONLY: Split = { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 };
export const isAsset = (s: string): s is Asset => (ASSETS as readonly string[]).includes(s);
export const isStop = (s: string): s is Stop => (STOP_ORDER as readonly string[]).includes(s);
export const sameSplit = (a: Split, b: Split): boolean => ASSETS.every((c) => a[c] === b[c]);
/** A six-key split from any partial object (a legacy two-key allocation reads as SKR/stORE and zeros). */
export const toSplit = (p: Partial<Record<string, number>> | null | undefined): Split => {
  const out = zeroSplit();
  for (const c of ASSETS) out[c] = Number(p?.[c] ?? 0);
  if (ASSETS.every((c) => out[c] === 0)) out.SKR = 100;
  return out;
};
