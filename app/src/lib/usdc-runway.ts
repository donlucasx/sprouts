/**
 * How long a wallet's USDC lasts at its owner's own pace (10-26 copy review rows 10-11 and the top-up's coverage hint, his rulings:
 * "coverage hint is good, just ensure its subtle"): computed on the phone from Activity's recent swaps, for this phone's wallet only
 * (another wallet's USDC is not read; its pause comes from the run).
 */
export const WINDOW_DAYS = 28;
/** Less history than this and there is no average: the hint and the warning stay hidden rather than guess. */
export const MIN_HISTORY_DAYS = 14;
/** "Low" is less than this many days of round-ups left. */
export const LOW_DAYS = 7;
const DAY = 86_400_000;

type Swap = { ts: string; walletPubkey: string; roundupCents: number };

/** The wallet's average round-ups a day over the last WINDOW_DAYS, or null with under MIN_HISTORY_DAYS of history. */
export function avgDailyRoundupCents(swaps: readonly Swap[], wallet: string, now: Date): number | null {
  const mine = swaps.filter((s) => s.walletPubkey === wallet);
  if (!mine.length) return null;
  const oldest = Math.min(...mine.map((s) => Date.parse(s.ts)));
  const span = Math.min(WINDOW_DAYS, (now.getTime() - oldest) / DAY);
  if (span < MIN_HISTORY_DAYS) return null;
  const since = now.getTime() - span * DAY;
  const sum = mine.filter((s) => Date.parse(s.ts) >= since).reduce((c, s) => c + s.roundupCents, 0);
  return sum > 0 ? sum / span : null;
}

/** "About 2 weeks of round-ups" for `cents` at `avg` a day; null without an average. */
export function coverageLine(cents: number, avg: number | null): string | null {
  if (!avg) return null;
  const days = cents / avg;
  if (days < 10) return `About ${Math.max(1, Math.round(days))} ${Math.round(days) <= 1 ? "day" : "days"} of round-ups`;
  const weeks = Math.round(days / 7);
  if (weeks <= 8) return `About ${weeks} weeks of round-ups`;
  return "Over 2 months of round-ups";
}

/** Home's line when the wallet has under LOW_DAYS of round-ups left (copy review row 10), or null. */
export function lowUsdcLine(balanceCents: number | null, avg: number | null): string | null {
  // 10-27 (his note on the Saga: "$0.00... top it up so plantings don't pause" understated it): at zero nothing can plant, and that
  // needs no average (the Saga's wallet at $0 showed nothing while it had too little history for one)
  if (balanceCents != null && balanceCents <= 0) return "Your wallet has no USDC, so nothing plants until you add some. Your round-ups are still counted.";
  if (balanceCents == null || !avg || balanceCents >= avg * LOW_DAYS) return null;
  return `Your wallet has $${(balanceCents / 100).toFixed(2)} of USDC left. Top it up so plantings don't pause.`;
}
