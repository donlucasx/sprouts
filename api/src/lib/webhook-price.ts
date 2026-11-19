import type { PriceLookup } from "@/domain/sizing";

/** Each webhook price attempt is bounded by this; the route's whole booking task stays well inside its maxDuration. */
export const WEBHOOK_PRICE_TIMEOUT_MS = 800;
/** The wait before the one retry (a Jupiter 429 or a blip is usually gone by then). */
export const WEBHOOK_PRICE_RETRY_MS = 300;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A price lookup for the webhook: each attempt is bounded by `timeoutMs`; a null, a throw or a timeout tries once more after
 * `retryAfterMs`; then null. An unpriced swap is left unbooked by book-swap (Helius does not redeliver after our 200; the daily check is the net), so
 * one more try is worth 300 ms. `retryRead` (optional) is the read used for the retry: pass the unmemoized read next to a memoized
 * `read`, since the memo hands a timed-out first attempt's still-pending promise back to the retry (never a fresh request).
 */
export function retryOncePrice(
  read: PriceLookup,
  opts: { retryRead?: PriceLookup; timeoutMs?: number; retryAfterMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): PriceLookup {
  const timeoutMs = opts.timeoutMs ?? WEBHOOK_PRICE_TIMEOUT_MS;
  const retryAfterMs = opts.retryAfterMs ?? WEBHOOK_PRICE_RETRY_MS;
  const sleep = opts.sleep ?? wait;
  const attempt = async (mint: string, via: PriceLookup): Promise<number | null> => {
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        via(mint).catch(() => null),
        new Promise<null>((resolve) => { t = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
    } finally {
      clearTimeout(t);
    }
  };
  return async (mint) => {
    const first = await attempt(mint, read);
    if (first !== null) return first;
    await sleep(retryAfterMs);
    return attempt(mint, opts.retryRead ?? read);
  };
}

/** A mint whose price read failed this many times in one delivery resolves null at once for the rest of that delivery. */
export const PRICE_DOWN_AFTER = 2;
/** Backstop: once a delivery has spent this long on price reads, it starts no new ones (the route's budget is 60 s). */
export const DELIVERY_PRICE_BUDGET_MS = 40_000;

/**
 * The per-delivery price lookup. The breaker is per MINT: failed reads (null after the retry) are counted per mint and a success
 * resets that mint's count, so one wallet's unpriceable token cannot stop pricing for other users' swaps in the same delivery.
 * The time guard counts only time spent inside reads, so a true outage (every mint failing) still cannot burn the 60 s.
 * Create one per delivery; nothing is cached across deliveries.
 */
export function deliveryPriceLookup(
  read: PriceLookup,
  opts: { maxFails?: number; budgetMs?: number; now?: () => number } = {},
): PriceLookup {
  const maxFails = opts.maxFails ?? PRICE_DOWN_AFTER;
  const budgetMs = opts.budgetMs ?? DELIVERY_PRICE_BUDGET_MS;
  const now = opts.now ?? Date.now;
  const fails = new Map<string, number>();
  let spentMs = 0;
  return async (mint) => {
    if ((fails.get(mint) ?? 0) >= maxFails || spentMs > budgetMs) return null;
    const started = now();
    let price: number | null = null;
    try {
      price = await read(mint);
    } catch {
      price = null;
    } finally {
      spentMs += now() - started;
    }
    if (price === null) fails.set(mint, (fails.get(mint) ?? 0) + 1);
    else fails.delete(mint);
    return price;
  };
}
