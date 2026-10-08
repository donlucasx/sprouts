import type { Repo } from "@/db/repo";
import { sharePrice } from "@/lib/staking";
import { priceUsd } from "@/lib/jupiter";
import { storeRedeemRate } from "@/lib/store";
import { readLeashConfig } from "@/lib/leash";
import { latestCoinDays, rateFacts, latestVenueRows } from "@/lib/holdings";
import { cached } from "@/lib/memo";

/**
 * The reads /api/me and /api/activity share across users, through the memo (`memo.ts`). Per-user chain reads never go through here.
 * Display routes only: the money-moving routes (withdraw, plant) keep reading fresh.
 */
export const sharedSharePrice = () => cached("sharePrice", sharePrice);
export const sharedPriceUsd = (mint: string) => cached(`priceUsd|${mint}`, () => priceUsd(mint), (v) => v !== null);
export const sharedStoreRedeemRate = () => cached("storeRedeemRate", storeRedeemRate);
export const sharedLeashConfig = () => cached("leashConfig", readLeashConfig);
export const sharedLatestCoinDays = (repo: Repo, day: string) => cached(`latestCoinDays|${day}`, () => latestCoinDays(repo, day));
export const sharedRateFacts = (repo: Repo, day: string) => cached(`rateFacts|${day}`, () => rateFacts(repo, day));
export const sharedLatestVenueRows = (repo: Repo, day: string) => cached(`latestVenueRows|${day}`, () => latestVenueRows(repo, day));
