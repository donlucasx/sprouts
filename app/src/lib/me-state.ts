import type { MeResponse } from "./api";
import { formatUsd } from "./format";

/** A cached read from before the Yield Manager build has no holdings or manager and would crash every screen that reads them: it counts as no cache (10-01 whole-branch review, I2). */
export function usableMe(cached: MeResponse | null | undefined): MeResponse | null {
  return cached && "holdings" in cached && "manager" in cached ? cached : null;
}

/** Review Focus 2, as a pure decision: a failed read keeps the last verified state and says so; never a zero garden. */
export function pickMeState(live: MeResponse | undefined, cached: MeResponse | null, failed: boolean): { data: MeResponse | undefined; stale: boolean } {
  if (live) return { data: live, stale: false };
  const usable = usableMe(cached);
  if (usable) return { data: usable, stale: failed };
  return { data: undefined, stale: failed };
}

/** Home's line before the first planting: what the user still has to do, from where they actually are. */
export function noPlantingLine(me: Pick<MeResponse, "nextPlanting" | "wallets">): string {
  if (!me.wallets.some((w) => w.status === "active")) return "No planting yet. Link a wallet and swap.";
  if (me.nextPlanting.pendingCents === 0) return "No planting yet. Your next swap starts it.";
  return `No planting yet. It plants when the change reaches ${formatUsd(me.nextPlanting.thresholdCents)}.`;
}

/** Withdraw's choice: the user's own once they tap; before that, "earned" only when there is 1 SKR of it to take (09-29). */
export function withdrawMode(earnedRaw: bigint, chosen: "earned" | "amount" | null): "earned" | "amount" {
  return chosen ?? (earnedRaw >= 1_000_000n ? "earned" : "amount");
}
