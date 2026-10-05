import type { LendAsset } from "@/domain/coins";
import { JLEND } from "./addresses";
import { config } from "../config";

/**
 * Jupiter Lend's withdrawable now for one asset, in underlying raw (its lend/v1/earn/tokens liquiditySupplyData.withdrawable).
 * The brief puts this in rates.ts (Task 14's file, built in parallel); it lives here so the two tasks do not collide, and `earn` is the
 * same read as rates.ts realVenueReads().jupiterEarn, injectable. Throws when the read fails or the asset is missing: an unknown
 * withdrawable must not read as "the pool can pay".
 */
export async function jupiterWithdrawableRaw(asset: LendAsset, earn: () => Promise<unknown> = jupiterEarn): Promise<bigint> {
  const t = ((await earn()) as { address: string; liquiditySupplyData?: { withdrawable?: string } }[]).find((x) => x.address === JLEND[asset].fTokenMint);
  if (!t || typeof t.liquiditySupplyData?.withdrawable !== "string") throw new Error("Jupiter Lend did not list this asset");
  return BigInt(t.liquiditySupplyData.withdrawable);
}

async function jupiterEarn(): Promise<unknown> {
  const res = await fetch("https://api.jup.ag/lend/v1/earn/tokens", { headers: { "x-api-key": config().jupiterApiKey }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Jupiter Lend answered ${res.status}`);
  return res.json();
}
