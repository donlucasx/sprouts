import type { MeResponse } from "./api";
import { formatUsd } from "./format";

/** Review Focus 2, as a pure decision: a failed read keeps the last verified state and says so; never a zero garden. */
export function pickMeState(live: MeResponse | undefined, cached: MeResponse | null, failed: boolean): { data: MeResponse | undefined; stale: boolean } {
  if (live) return { data: live, stale: false };
  if (cached) return { data: cached, stale: failed };
  return { data: undefined, stale: failed };
}

/** Home's line before the first planting: what the user still has to do, from where they actually are. */
export function noPlantingLine(me: Pick<MeResponse, "nextPlanting" | "wallets">): string {
  if (!me.wallets.some((w) => w.status === "active")) return "No planting yet. Link a wallet and swap.";
  if (me.nextPlanting.pendingCents === 0) return "No planting yet. Your next swap starts it.";
  return `No planting yet. It plants when the change reaches ${formatUsd(me.nextPlanting.thresholdCents)}.`;
}
