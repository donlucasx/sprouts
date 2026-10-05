import { address, type Address } from "@solana/kit";
import { SKR_MINT, STORE_MINT, USDC_MINT, WSOL_MINT } from "@/lib/constants";

/**
 * The closed list of legs Sprouts can plant (spec 2, contracts 1.1): six live legs, plus two retired LSTs that stay readable in
 * history and are never planted, moved, shown or offered (R260, R279, R281). Mints are pinned here and nowhere else.
 */
export type LiveAsset = "SKR" | "stORE" | "USDC_LEND" | "SOL_LEND" | "hSOL" | "cbBTC";
export type RetiredAsset = "JitoSOL" | "JupSOL";
export type Asset = LiveAsset | RetiredAsset;
export type LendAsset = Extract<LiveAsset, "USDC_LEND" | "SOL_LEND">;
export const ASSETS: readonly LiveAsset[] = ["SKR", "stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC"] as const;
export const RETIRED: readonly RetiredAsset[] = ["JitoSOL", "JupSOL"] as const;
export const ALL_ASSETS: readonly Asset[] = [...ASSETS, ...RETIRED];
export const LEND_ASSETS: readonly LendAsset[] = ["USDC_LEND", "SOL_LEND"] as const;

export type CoinKind = "skr" | "store" | "lst" | "btc" | "lend";
export type Coin = {
  asset: Asset;
  /** What the planting buys: the coin itself, or the underlying a lending leg deposits (USDC, WSOL). */
  mint: Address;
  /** The underlying's decimals (a lending receipt has its own; see lib/venues/addresses.ts). */
  decimals: number;
  kind: CoinKind;
  /** SKR is staked into the Seed Vault's position; wallet coins sit in the wallet; a lending leg is a venue receipt in the wallet. */
  held: "staked" | "wallet" | "venue";
  pool: Address | null;
  plant: string;
  name: string;
  /** R266: 0.5% on the four coin legs, nothing on lending. */
  feeBps: 0 | 50;
  live: boolean;
};

export const COINS: Record<Asset, Coin> = {
  SKR: { asset: "SKR", mint: SKR_MINT, decimals: 6, kind: "skr", held: "staked", pool: null, plant: "skr", name: "SKR", feeBps: 50, live: true },
  stORE: { asset: "stORE", mint: STORE_MINT, decimals: 11, kind: "store", held: "wallet", pool: null, plant: "ore", name: "stORE", feeBps: 50, live: true },
  USDC_LEND: { asset: "USDC_LEND", mint: USDC_MINT, decimals: 6, kind: "lend", held: "venue", pool: null, plant: "jitosol", name: "USDC lending", feeBps: 0, live: true },
  SOL_LEND: { asset: "SOL_LEND", mint: WSOL_MINT, decimals: 9, kind: "lend", held: "venue", pool: null, plant: "jupsol", name: "SOL lending", feeBps: 0, live: true },
  hSOL: { asset: "hSOL", mint: address("he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A"), decimals: 9, kind: "lst", held: "wallet", pool: address("3wK2g8ZdzAH8FJ7PKr2RcvGh7V9VYson5hrVsJM5Lmws"), plant: "hsol", name: "hSOL", feeBps: 50, live: true },
  cbBTC: { asset: "cbBTC", mint: address("cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij"), decimals: 8, kind: "btc", held: "wallet", pool: null, plant: "cbbtc", name: "cbBTC", feeBps: 50, live: true },
  JitoSOL: { asset: "JitoSOL", mint: address("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn"), decimals: 9, kind: "lst", held: "wallet", pool: address("Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb"), plant: "jitosol", name: "JitoSOL", feeBps: 50, live: false },
  JupSOL: { asset: "JupSOL", mint: address("jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v"), decimals: 9, kind: "lst", held: "wallet", pool: address("8VpRhuxa7sUUepdY3kQiTmX9rS5vx4WgaXiAnXq4KCtr"), plant: "jupsol", name: "JupSOL", feeBps: 50, live: false },
};

export const DECIMALS: Record<Asset, number> = Object.fromEntries(ALL_ASSETS.map((a) => [a, COINS[a].decimals])) as Record<Asset, number>;

/** A split of new round-ups in whole percents over the six live legs, summing to 100. */
export type Split = Record<LiveAsset, number>;
export type Stop = "careful" | "balanced" | "bold";
export const STOP_ORDER: readonly Stop[] = ["careful", "balanced", "bold"] as const;

export const zeroSplit = (): Split => ({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 });
export const SKR_ONLY: Split = { SKR: 100, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 };
export const isAsset = (s: string): s is Asset => (ALL_ASSETS as readonly string[]).includes(s);
export const isLiveAsset = (s: string): s is LiveAsset => (ASSETS as readonly string[]).includes(s);
export const isLendAsset = (s: string): s is LendAsset => (LEND_ASSETS as readonly string[]).includes(s);
export const isStop = (s: string): s is Stop => (STOP_ORDER as readonly string[]).includes(s);
export const sameSplit = (a: Split, b: Split): boolean => ASSETS.every((c) => a[c] === b[c]);
/** Legacy objects: a two-key allocation reads as SKR/stORE; retired keys' shares fold into SKR so the sum stays 100 [contracts decision]. */
export const toSplit = (p: Partial<Record<string, number>> | null | undefined): Split => {
  const out = zeroSplit();
  for (const c of ASSETS) out[c] = Number(p?.[c] ?? 0);
  out.SKR += Number(p?.JitoSOL ?? 0) + Number(p?.JupSOL ?? 0);
  if (ASSETS.every((c) => out[c] === 0)) out.SKR = 100;
  return out;
};
