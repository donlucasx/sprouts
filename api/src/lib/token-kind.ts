import { config } from "./config";
import { STABLES, MAJORS, LSTS } from "@/domain/classify";

/**
 * 11-12: which mints are tokenized shares, read from the token's own metadata (Helius DAS getAssetBatch). A label only: the
 * swap's size and round-up never depend on it. Names seen: "NVIDIA xStock", "Tesla (Ondo Tokenized)", "Tesla - Backpack
 * Securities", "Anduril PreStocks".
 */
export const STOCK_NAME = /tokeni[sz]ed|xstock|prestock|securities|\bstocks?\b/i;

export const isStockName = (name: string | undefined, symbol: string | undefined) => STOCK_NAME.test(`${name ?? ""} ${symbol ?? ""}`);

/** Answers per warm function instance; a mint's name does not change. A failed lookup is not cached, so the next swap asks again. */
const cache = new Map<string, boolean>();

type Fetch = (url: string, init: RequestInit) => Promise<{ json(): Promise<unknown> }>;

/**
 * The subset of `mints` that are tokenized shares. Known coins are never asked about. Any failure (timeout, RPC error, odd
 * answer) returns what is already known: the swap is then labeled as before, and booking is never held up by a label.
 */
export async function stockMints(mints: string[], fetchImpl: Fetch = fetch, rpcUrl?: string): Promise<ReadonlySet<string>> {
  const ask = [...new Set(mints)].filter((m) => !cache.has(m) && !STABLES.has(m) && !MAJORS.has(m) && !LSTS.has(m));
  if (ask.length > 0) {
    try {
      const res = await fetchImpl(rpcUrl ?? config().heliusRpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAssetBatch", params: { ids: ask } }),
        signal: AbortSignal.timeout(1_500), // inside the webhook's booking: a label never holds a swap up for long
      });
      const body = (await res.json()) as { result?: ({ id: string; content?: { metadata?: { name?: string; symbol?: string } } } | null)[] };
      for (const a of body.result ?? []) if (a?.id) cache.set(a.id, isStockName(a.content?.metadata?.name, a.content?.metadata?.symbol));
    } catch {
      // label only: fall through with what is known
    }
  }
  return new Set(mints.filter((m) => cache.get(m) === true));
}

/** Tests only. */
export const _clearStockCache = () => cache.clear();
