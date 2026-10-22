/**
 * Why a paused wallet is paused, read from its newest pause or resume event (security audit R207): only a newest `paused_no_usdc`
 * is the run's pause for want of USDC, which the daily run ends by itself once the wallet holds threshold + network fee
 * (plant-run.ts resumePausedWallets). Anything else, a user pause or no event at all, is the user's: only their own resume ends it.
 * `events` newest first, as Repo.listEvents answers them.
 */
export type PauseCause = { reason: "no_usdc"; needCents: number | null } | { reason: "user" };

export const PAUSE_EVENT_KINDS = ["paused_no_usdc", "paused_by_user", "resumed"] as const;

export function pauseCauseOf(events: readonly { walletPubkey: string | null; kind: string; detail: unknown }[], wallet: string): PauseCause {
  const newest = events.find((e) => e.walletPubkey === wallet);
  if (newest?.kind !== "paused_no_usdc") return { reason: "user" };
  const need = (newest.detail as { needCents?: unknown } | null)?.needCents;
  return { reason: "no_usdc", needCents: typeof need === "number" && Number.isFinite(need) ? need : null };
}
