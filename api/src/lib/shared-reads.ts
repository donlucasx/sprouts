import type { Repo } from "@/db/repo";
import { sharePrice } from "@/lib/staking";
import { displayPriceUsd } from "@/lib/das-price";
import { crossCachedWithAge, PRICE_CACHE_TTL_MS } from "@/lib/shared-cache";
import { storeRedeemRate } from "@/lib/store";
import { readLeashConfig } from "@/lib/leash";
import { latestCoinDays, rateFacts, latestVenueRows } from "@/lib/holdings";
import { cached } from "@/lib/memo";

/**
 * The reads /api/me and /api/activity share across users, through the memo (`memo.ts`). Per-user chain reads never go through here.
 * Display routes only: the money-moving routes (withdraw, plant) keep reading fresh.
 */
export const sharedSharePrice = () => cached("sharePrice", sharePrice);
// 11-23 (Kimi day review item 1): a missing price (Jupiter busy, after priceUsd's own 429 retries) is kept 10 s, so a rate limit is not
// answered with a fresh 3-attempt read on every screen load.
export const SHARED_PRICE_MISS_TTL_MS = 10_000;
/**
 * 11-28 (Kimi Jupiter re-assessment fixes 1 and 4): the DISPLAY and SIZING price of a mint (Home, Activity, the preview, the
 * withdrawal's text, the webhook's and the swap check's swap sizing). Helius DAS first, Jupiter only for a mint DAS does not price
 * (das-price.ts displayPriceUsd); shared across instances for PRICE_CACHE_TTL_MS (shared-cache.ts), and per instance for what is left
 * of that (memo.ts). A null is never written to the shared cache and is kept SHARED_PRICE_MISS_TTL_MS per instance. Never a money
 * check: the top-up bound and the planting floor read their own fresh prices.
 */
const priceTtl = new Map<string, number>();
export const sharedPriceUsd = (mint: string): Promise<number | null> =>
  cached(`priceUsd|${mint}`, async () => {
    const r = await crossCachedWithAge(`price:${mint}`, () => displayPriceUsd(mint), {
      ttlMs: PRICE_CACHE_TTL_MS, keep: (v) => v !== null,
      decode: (x) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : undefined),
    });
    priceTtl.set(mint, r.ttlLeftMs);
    return r.value;
  }, () => true, (v) => {
    const left = priceTtl.get(mint) ?? PRICE_CACHE_TTL_MS;
    priceTtl.delete(mint);   // read once: the map never grows past the reads in flight
    return v === null ? SHARED_PRICE_MISS_TTL_MS : Math.max(1, Math.min(PRICE_CACHE_TTL_MS, left));
  });
export const sharedStoreRedeemRate = () => cached("storeRedeemRate", storeRedeemRate);
export const sharedLeashConfig = () => cached("leashConfig", readLeashConfig);
export const sharedLatestCoinDays = (repo: Repo, day: string) => cached(`latestCoinDays|${day}`, () => latestCoinDays(repo, day));
export const sharedRateFacts = (repo: Repo, day: string) => cached(`rateFacts|${day}`, () => rateFacts(repo, day));
export const sharedLatestVenueRows = (repo: Repo, day: string) => cached(`latestVenueRows|${day}`, () => latestVenueRows(repo, day));
