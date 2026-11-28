import { config } from "./config";
import { countingFetch } from "./helius-count";
import { priceUsd as jupiterPriceUsd } from "./jupiter";

/*
 * 11-28 (Kimi Jupiter re-assessment fix 1, founder ruling "Go, all 4"): prices for DISPLAY and SIZING come from Helius DAS
 * getAssetBatch (token_info.price_info), already paid (Developer plan), batched; a mint DAS does not price falls back to Jupiter's
 * price (through the shared Jupiter lane). Probe 11-28: DAS matched Jupiter within ~0.1% on SKR, USDC, SOL, hSOL, cbBTC, JitoSOL,
 * JupSOL and 1.75% on stORE.
 *
 * NEVER a money-safety check: the top-up price bound (topup.ts withinTopUpPriceBound, from Jupiter's pricesUsd), the planting's
 * leash floor and price checks (Pyth), and anything that gates a send keep their own fresh reads. Users of this module: the swap
 * webhook's sizing, the daily swap check's sizing, /api/me, /api/me/usdc, /api/activity, the preview, and the withdrawal's display
 * price (all through shared-reads.ts sharedPriceUsd).
 */

/** One getAssetBatch carries at most this many ids (Helius allows 1,000; a webhook delivery or a Home read asks a handful). */
export const DAS_BATCH_MAX = 100;
/** Each DAS call stops here: a slow DAS falls back to Jupiter, never holds a webhook booking. */
export const DAS_TIMEOUT_MS = 1_500;
/** Price asks arriving within this window go out as one getAssetBatch. */
export const DAS_BATCH_WINDOW_MS = 5;

type Fetch = (url: string, init: RequestInit) => Promise<{ ok?: boolean; json(): Promise<unknown> }>;

/** A DAS asset's USD price per whole token, or null when it carries none (or an odd one). */
export function priceFromAsset(a: unknown): number | null {
  const p = (a as { token_info?: { price_info?: { price_per_token?: unknown; currency?: unknown } } } | null)?.token_info?.price_info;
  if (!p) return null;
  const cur = typeof p.currency === "string" ? p.currency.toUpperCase() : null;
  if (cur !== null && cur !== "USDC" && cur !== "USD") return null;
  const v = p.price_per_token;
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 10_000_000 ? v : null;
}

/** DAS's prices for `mints` (one getAssetBatch per DAS_BATCH_MAX). A mint without price_info, or any failure, is simply absent. */
export async function dasPricesUsd(mints: string[], fetchImpl: Fetch = countingFetch(), rpcUrl?: string): Promise<Record<string, number>> {
  const ids = [...new Set(mints)];
  const out: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += DAS_BATCH_MAX) {
    const chunk = ids.slice(i, i + DAS_BATCH_MAX);
    try {
      const res = await fetchImpl(rpcUrl ?? config().heliusRpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAssetBatch", params: { ids: chunk } }),
        signal: AbortSignal.timeout(DAS_TIMEOUT_MS),
      });
      const body = (await res.json()) as { result?: unknown };
      if (!Array.isArray(body.result)) continue;
      for (const a of body.result) {
        const id = (a as { id?: unknown } | null)?.id;
        const p = priceFromAsset(a);
        if (typeof id === "string" && chunk.includes(id) && p !== null) out[id] = p;
      }
    } catch (e) {
      console.error(`das price: getAssetBatch failed for ${chunk.length} mints (${e instanceof Error ? e.message : String(e)}); Jupiter fallback`);
    }
  }
  return out;
}

/** Off under vitest (route tests mock Jupiter's priceUsd and have no network); the DAS tests turn it on. */
let dasOn = !process.env.VITEST;
export function setDasPricesForTests(on: boolean): void { dasOn = on; }

let pending = new Map<string, ((p: number | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
let batchFetch: Fetch | undefined;
/** Tests only: the fetch the batcher uses (default: the counting fetch to the Helius RPC). */
export function setDasFetchForTests(f: Fetch | undefined): void { batchFetch = f; }

function flush(): void {
  const asks = pending;
  pending = new Map();
  timer = null;
  void dasPricesUsd([...asks.keys()], batchFetch).then(
    (prices) => { for (const [m, rs] of asks) for (const r of rs) r(prices[m] ?? null); },
    () => { for (const rs of asks.values()) for (const r of rs) r(null); },
  );
}

/** One mint's DAS price; asks within DAS_BATCH_WINDOW_MS share one getAssetBatch. Null when DAS has none (or is off). */
export function dasPriceUsd(mint: string): Promise<number | null> {
  if (!dasOn) return Promise.resolve(null);
  return new Promise((resolve) => {
    const rs = pending.get(mint) ?? [];
    rs.push(resolve);
    pending.set(mint, rs);
    if (!timer) timer = setTimeout(flush, DAS_BATCH_WINDOW_MS);
  });
}

/** The display/sizing price: DAS first, Jupiter (the shared lane) only when DAS has none. Null when neither knows it. */
export async function displayPriceUsd(mint: string): Promise<number | null> {
  const das = await dasPriceUsd(mint).catch(() => null);
  if (das !== null) return das;
  return jupiterPriceUsd(mint);
}
