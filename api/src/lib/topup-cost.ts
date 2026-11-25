import type { Split } from "@/domain/coins";
import { SKR_MINT, WSOL_MINT } from "./constants";

/**
 * 0.1.13 (his rulings 11-24 "Line + ranking now", 11-25 "Point to SOL instead"; research/new/2026-11-20-topup-source-ux.md "Default
 * selection"): what a top-up from a coin wastes, in basis points of the amount, so the phone can list the cheapest coin first and say
 * when SOL costs less. A coin that is also in the user's split goes coin -> USDC -> back into that coin at planting, so its share pays
 * the buy cost and the 0.5% planting fee on top of the sell cost: cost = sell + share x (buy + fee). Users never see the number.
 *
 * The table is server config the owner can tune (Kimi plan audit 11-24). Measured 11-19 (research file l.46): SKR sells at ~0.35% and
 * buys at ~0.21% through Jupiter; SOL at ~0.05% each way. Any other listed coin: 0.5% each way until measured.
 */
export const TOPUP_COST_BPS: Readonly<Record<string, { sell: number; buy: number }>> = {
  [WSOL_MINT]: { sell: 5, buy: 5 },
  [SKR_MINT]: { sell: 35, buy: 21 },
};
const DEFAULT_COST = { sell: 50, buy: 50 } as const;
/** The planting fee every leg carries since 11-23 (lib/leash.ts feeBps 50). */
export const PLANTING_FEE_BPS = 50;

/** The share of the user's split that buys this coin back: SKR -> SKR; SOL -> SOL lending + hSOL (both SOL); any other coin -> 0. */
export function splitShareOf(mint: string, split: Split): number {
  if (mint === SKR_MINT) return split.SKR;
  if (mint === WSOL_MINT) return split.SOL_LEND + split.hSOL;
  return 0;
}

/** `splitPct` (0-100, whole) and `costBps` for a top-up from `mint`; none without a split (the phone keeps today's value order). */
export function topUpCost(mint: string, split: Split | null): { splitPct: number; costBps: number } | Record<string, never> {
  if (!split) return {};
  const c = TOPUP_COST_BPS[mint] ?? DEFAULT_COST;
  const share = Math.max(0, Math.min(100, splitShareOf(mint, split)));
  return { splitPct: Math.round(share), costBps: Math.round(c.sell + (share / 100) * (c.buy + PLANTING_FEE_BPS)) };
}
