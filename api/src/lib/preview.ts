import { extractSwapLegs, type HeliusEnhancedTx } from "./book-swap";
import { usdSizeCents, type PriceLookup } from "@/domain/sizing";
import { computeRoundupCents, type Rules } from "@/domain/roundup";
import { dayOf } from "@/domain/day";

/**
 * 11-12 (his ruling: "Last 30 days total"): what a wallet that has not linked would have saved, read from its own public history.
 * Nothing is stored: the answer is computed on request from the chain and returned. Moves nothing, signs nothing.
 */
export const PREVIEW_DAYS = 30;
/**
 * At most this many pages of 100 transactions are read (Helius credits; a busier wallet is summed over what was read). 11-19 (Season
 * economics): Parsed Events costs 10 credits a page (Enhanced was 100), so at most 20 credits a read; reads kept 24 h per instance.
 */
export const PREVIEW_MAX_PAGES = 2;
export const PREVIEW_PAGE_SIZE = 100;
/** At most this many distinct non-stable coins are priced; swaps with no stable or SOL leg past that are left out. */
export const PREVIEW_MAX_PRICED = 15;
/** The swaps read for a user are kept this long per function instance (the rules are applied on every request). */
export const PREVIEW_CACHE_MS = 24 * 3_600_000;
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

export type HistoryPage = { txs: HeliusEnhancedTx[]; next: string | null };
/** One page of the wallet's history, newest first; `next` is the cursor for the page after it (null at the end). */
export type FetchPage = (wallet: string, cursor: string | undefined) => Promise<HistoryPage>;

type ParsedTransfer = { fromUserAccount?: string; toUserAccount?: string; mint?: string; rawTokenAmount?: number | string; decimals?: number; amount?: number };
type ParsedEvent = {
  signature?: string;
  parsed?: {
    blockTime?: number; fee?: number; feePayer?: string; transactionStatus?: string;
    nativeTransfers?: ParsedTransfer[] | null; tokenTransfers?: ParsedTransfer[] | null;
    summary?: { type?: string } | null; events?: HeliusEnhancedTx["events"];
  } | null;
};

/**
 * One Helius Parsed Events item (POST /v1/parsed-events/transaction-history, fixture helius-parsed-events.json) as the fields
 * `extractSwapLegs` and `walletSwaps` read. Token amounts come as raw units plus decimals; the summary type is lower case ("swap").
 * Null when the item has no signature or no time. A failed transaction keeps its fields but moves no coin, so it reads as no swap.
 */
export function parsedEventToTx(e: unknown, _wallet: string): HeliusEnhancedTx | null {
  const ev = e as ParsedEvent | null;
  const p = ev?.parsed;
  if (!ev || typeof ev.signature !== "string" || !p || typeof p.blockTime !== "number") return null;
  const ok = !p.transactionStatus || p.transactionStatus === "OK";
  return {
    signature: ev.signature,
    timestamp: p.blockTime,
    type: (p.summary?.type ?? "unknown").toUpperCase(),
    feePayer: p.feePayer ?? "",
    fee: p.fee,
    tokenTransfers: ok
      ? (p.tokenTransfers ?? []).map((t) => ({
          fromUserAccount: t.fromUserAccount ?? "", toUserAccount: t.toUserAccount ?? "", mint: t.mint ?? "",
          tokenAmount: Number(t.rawTokenAmount ?? 0) / 10 ** (t.decimals ?? 0),
        }))
      : [],
    nativeTransfers: ok ? (p.nativeTransfers ?? []).map((t) => ({ fromUserAccount: t.fromUserAccount ?? "", toUserAccount: t.toUserAccount ?? "", amount: Number(t.amount ?? 0) })) : [],
    ...(ok && p.events?.swap ? { events: { swap: p.events.swap } } : {}),
  };
}

/**
 * The swaps the wallet made itself (it paid the fee) in the last PREVIEW_DAYS, sized in cents. `partial` when the page limit
 * stopped the read before the window's start. The end of the history is a page with no cursor: Parsed Events can answer fewer
 * than 100 items AND a cursor (probe 11-19: 49 items, then an empty page), so a short page is not the end.
 */
export async function walletSwaps(wallet: string, a: { fetchPage: FetchPage; priceUsd: PriceLookup; nowS: number }): Promise<{ swaps: PreviewSwap[]; partial: boolean }> {
  const since = a.nowS - PREVIEW_DAYS * 86_400;
  const priced = new Map<string, Promise<number | null>>();
  const price: PriceLookup = (mint) => {
    if (!priced.has(mint)) priced.set(mint, priced.size < PREVIEW_MAX_PRICED ? a.priceUsd(mint).catch(() => null) : Promise.resolve(null));
    return priced.get(mint)!;
  };
  const swaps: PreviewSwap[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < PREVIEW_MAX_PAGES; page++) {
    const { txs, next } = await a.fetchPage(wallet, cursor);
    for (const tx of txs) {
      if (tx.timestamp < since) return { swaps, partial: false };
      if (tx.feePayer !== wallet) continue;
      const legs = extractSwapLegs(tx, wallet);
      if (!legs) continue;
      const size = await usdSizeCents(legs, price);
      if (size !== null) swaps.push({ day: dayOf(new Date(tx.timestamp * 1000)), sizeCents: size });
    }
    if (!next) return { swaps, partial: false };
    cursor = next;
  }
  return { swaps, partial: true };
}
