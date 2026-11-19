import type { PriceLookup } from "@/domain/sizing";

/** Each webhook price attempt is bounded by this; the route's whole booking task stays well inside its maxDuration. */
export const WEBHOOK_PRICE_TIMEOUT_MS = 800;
/** The wait before the one retry (a Jupiter 429 or a blip is usually gone by then). */
export const WEBHOOK_PRICE_RETRY_MS = 300;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A price lookup for the webhook: each attempt is bounded by `timeoutMs`; a null, a throw or a timeout tries once more after
 * `retryAfterMs`; then null. An unpriced swap is left unbooked by book-swap (a redelivery or the daily check picks it up), so
 * one more try is worth 300 ms.
 */
export function retryOncePrice(
  read: PriceLookup,
  opts: { timeoutMs?: number; retryAfterMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): PriceLookup {
  const timeoutMs = opts.timeoutMs ?? WEBHOOK_PRICE_TIMEOUT_MS;
  const retryAfterMs = opts.retryAfterMs ?? WEBHOOK_PRICE_RETRY_MS;
  const sleep = opts.sleep ?? wait;
  const attempt = async (mint: string): Promise<number | null> => {
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        read(mint).catch(() => null),
        new Promise<null>((resolve) => { t = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
    } finally {
      clearTimeout(t);
    }
  };
  return async (mint) => {
    const first = await attempt(mint);
    if (first !== null) return first;
    await sleep(retryAfterMs);
    return attempt(mint);
  };
}
