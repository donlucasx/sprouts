import { STABLES } from "./classify";

export const WSOL = "So11111111111111111111111111111111111111112";

/** One swap as the wallet saw it: what left and what arrived, in UI units (as Helius reports tokenAmount). */
export type SwapLegs = { wallet: string; inMint: string; inAmount: number; outMint: string; outAmount: number };

export type PriceLookup = (mint: string) => Promise<number | null>;

/**
 * The swap's size in whole cents. A stablecoin leg is taken as is; otherwise the SOL leg, then any leg, is priced.
 * Null when nothing can be priced: the caller books the swap with no round-up rather than blocking later swaps.
 */
export async function usdSizeCents(legs: SwapLegs, priceUsd: PriceLookup): Promise<number | null> {
  // A malformed item (NaN or infinite amount) is unpriced, never a NaN round-up that breaks the insert (review M8).
  const candidates = [
    { mint: legs.inMint, amount: legs.inAmount },
    { mint: legs.outMint, amount: legs.outAmount },
  ].filter((c) => Number.isFinite(c.amount) && c.amount >= 0);
  const stable = candidates.find((c) => STABLES.has(c.mint));
  if (stable) return Math.round(stable.amount * 100);
  const ordered = [...candidates.filter((c) => c.mint === WSOL), ...candidates.filter((c) => c.mint !== WSOL)];
  for (const leg of ordered) {
    const price = await priceUsd(leg.mint);
    if (price !== null && price > 0) return Math.round(leg.amount * price * 100);
  }
  return null;
}
