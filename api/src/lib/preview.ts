import { extractSwapLegs, type HeliusEnhancedTx } from "./book-swap";
import { config } from "./config";
import { usdSizeCents, type PriceLookup } from "@/domain/sizing";
import { computeRoundupCents, type Rules } from "@/domain/roundup";
import { dayOf } from "@/domain/day";

/**
 * 11-12 (his ruling: "Last 30 days total"): what a wallet that has not linked would have saved, read from its own public history.
 * Nothing is stored: the answer is computed on request from the chain and returned. Moves nothing, signs nothing.
 */
export const PREVIEW_DAYS = 30;
/** At most this many pages of 100 transactions are read (Helius credits; a busier wallet is summed over what was read). */
export const PREVIEW_MAX_PAGES = 5;
export const PREVIEW_PAGE_SIZE = 100;
/** At most this many distinct non-stable coins are priced; swaps with no stable or SOL leg past that are left out. */
export const PREVIEW_MAX_PRICED = 15;
/** The comparison shown when the wallet's swaps are whole dollars: "add 10 cents to every swap". */
export const PREVIEW_PER_SWAP_CENTS = 10;

export type PreviewSwap = { day: string; sizeCents: number };
export type Preview = { days: number; swaps: number; savedCents: number; perSwapSavedCents: number; partial: boolean };

/** Per-day totals capped at the daily limit, as the planting would pull them. */
function capped(swaps: PreviewSwap[], rules: Rules): number {
  const byDay = new Map<string, number>();
  for (const s of swaps) byDay.set(s.day, (byDay.get(s.day) ?? 0) + computeRoundupCents(s.sizeCents, rules));
  let total = 0;
  for (const v of byDay.values()) total += Math.min(v, rules.dailyCapCents);
  return total;
}

/** The two totals: under the user's rules, and under the same rules with "add 10 cents to every swap" switched on. */
export function previewTotals(swaps: PreviewSwap[], rules: Rules, partial = false): Preview {
  return {
    days: PREVIEW_DAYS,
    swaps: swaps.length,
    savedCents: capped(swaps, rules),
    perSwapSavedCents: capped(swaps, { ...rules, perSwapOn: true, perSwapCents: PREVIEW_PER_SWAP_CENTS }),
    partial,
  };
}

export type FetchPage = (wallet: string, before: string | undefined) => Promise<HeliusEnhancedTx[]>;

/** One page of the wallet's history, newest first (Helius parsed transactions). */
export const heliusPage: FetchPage = async (wallet, before) => {
  const key = new URL(config().heliusRpcUrl).searchParams.get("api-key");
  const url = new URL(`https://api.helius.xyz/v0/addresses/${wallet}/transactions`);
  url.searchParams.set("api-key", key ?? "");
  url.searchParams.set("limit", String(PREVIEW_PAGE_SIZE));
  if (before) url.searchParams.set("before", before);
  // Helius answers 429 when several reads land at once (seen 11-12 on the free plan): one more try after 1 s. Each read gets 2.5 s,
  // so 5 pages with a retry each stay under the route's 30 s (Kimi 11-12).
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_500) });
    if (res.ok) return (await res.json()) as HeliusEnhancedTx[];
    if (res.status !== 429 || attempt >= 1) throw new Error(`history ${res.status}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }
};

/**
 * The swaps the wallet made itself (it paid the fee) in the last PREVIEW_DAYS, sized in cents. `partial` when the page limit
 * stopped the read before the window's start.
 */
export async function walletSwaps(wallet: string, a: { fetchPage: FetchPage; priceUsd: PriceLookup; nowS: number }): Promise<{ swaps: PreviewSwap[]; partial: boolean }> {
  const since = a.nowS - PREVIEW_DAYS * 86_400;
  const priced = new Map<string, Promise<number | null>>();
  const price: PriceLookup = (mint) => {
    if (!priced.has(mint)) priced.set(mint, priced.size < PREVIEW_MAX_PRICED ? a.priceUsd(mint).catch(() => null) : Promise.resolve(null));
    return priced.get(mint)!;
  };
  const swaps: PreviewSwap[] = [];
  let before: string | undefined;
  for (let page = 0; page < PREVIEW_MAX_PAGES; page++) {
    const txs = await a.fetchPage(wallet, before);
    if (txs.length === 0) return { swaps, partial: false };
    for (const tx of txs) {
      if (tx.timestamp < since) return { swaps, partial: false };
      if (tx.feePayer !== wallet) continue;
      const legs = extractSwapLegs(tx, wallet);
      if (!legs) continue;
      const size = await usdSizeCents(legs, price);
      if (size !== null) swaps.push({ day: dayOf(new Date(tx.timestamp * 1000)), sizeCents: size });
    }
    // A short page is the wallet's whole history: no further read (review 11-12: it cost an extra call returning []).
    if (txs.length < PREVIEW_PAGE_SIZE) return { swaps, partial: false };
    before = txs[txs.length - 1].signature;
  }
  return { swaps, partial: true };
}
