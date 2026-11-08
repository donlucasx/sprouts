import { dayOf } from "./day";

export type ReminderKind = "link_new" | "usdc_waiting" | "relink" | "idle" | "link_unfinished";
export type ReminderRoute = "/connect" | "/home";
export type Reminder = { id: string; kind: ReminderKind; title: string; body: string; route: ReminderRoute };

export type ReminderFacts = {
  now: Date;
  signedUpAt: Date;
  walletsEver: number; // any status
  activeWallets: number;
  pausedNoUsdcSince: { wallet: string; since: Date }[]; // wallets paused for want of USDC, since the newest paused_no_usdc
  stoppedSince: { wallet: string; since: Date }[]; // revoked wallets Sprouts stopped, since the newest revoke_seen
  lastSwapAt: Date | null; // newest swap across the user's wallets
  firstActiveLinkAt: Date | null; // created_at of the oldest ACTIVE wallet
  lastLinkFailAt: Date | null; // newest link_failed
  lastLinkAttemptAfterFail: boolean; // a link_started or wallet_linked newer than lastLinkFailAt
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LINK_UNFINISHED_MIN_MS = 18 * HOUR;
const LINK_UNFINISHED_MAX_MS = 7 * DAY; // after this A9 falls through, so A1-A3 stay reachable

// Copy: submission/release-0.1.9-copy.md section A (verbatim).
const A1 = { title: "Your garden is ready to plant", body: "Link a wallet and your swaps start rounding up. It takes about 30 seconds." };
const A2 = { title: "Round-ups start with a wallet", body: "Link a wallet in Settings and your swaps start rounding up into your garden." };
const A3 = { title: "One step left", body: "Link a wallet whenever you're ready. We won't remind you again." };
const A5 = { title: "Your round-ups are still waiting", body: "Add USDC to your wallet and plantings start again by themselves." };
const A7 = { title: "Your wallet is still unlinked", body: "Link your wallet again to pick up where you left off." };
const A8 = { title: "Your garden is waiting", body: "Swap as usual and Sprouts rounds up the change into your garden." };
const A9 = { title: "Linking didn't finish", body: "Want to try again? Open Settings > Link a wallet. If it keeps failing, tap Message us." };

const oldest = <T extends { since: Date }>(xs: T[]): T | undefined =>
  xs.reduce<T | undefined>((a, x) => (!a || x.since.getTime() < a.since.getTime() ? x : a), undefined);

/** At most one reminder; priority link_unfinished > usdc_waiting > relink > link_new > idle. Ids are stable per step so the app shows each once. */
export function reminderFor(f: ReminderFacts): Reminder | null {
  const now = f.now.getTime();
  const age = (d: Date) => now - d.getTime();

  if (
    f.lastLinkFailAt &&
    age(f.lastLinkFailAt) >= LINK_UNFINISHED_MIN_MS &&
    age(f.lastLinkFailAt) <= LINK_UNFINISHED_MAX_MS &&
    !f.lastLinkAttemptAfterFail &&
    f.activeWallets === 0
  ) {
    return { id: `unfinished-${dayOf(f.lastLinkFailAt)}`, kind: "link_unfinished", ...A9, route: "/connect" };
  }

  const paused = oldest(f.pausedNoUsdcSince);
  if (paused) {
    const n = Math.floor(age(paused.since) / (3 * DAY));
    if (n >= 1) {
      return { id: `usdc-${paused.wallet.slice(0, 4)}-${dayOf(paused.since)}-${n}`, kind: "usdc_waiting", ...A5, route: "/home" };
    }
  }

  const stopped = oldest(f.stoppedSince);
  if (stopped && f.activeWallets === 0 && age(stopped.since) >= 7 * DAY) {
    return { id: `relink-${stopped.wallet.slice(0, 4)}-${dayOf(stopped.since)}`, kind: "relink", ...A7, route: "/connect" };
  }

  if (f.walletsEver === 0) {
    const d = Math.floor(age(f.signedUpAt) / DAY);
    const step = d >= 7 ? { id: "nolink-7", ...A3 } : d >= 3 ? { id: "nolink-3", ...A2 } : d >= 1 ? { id: "nolink-1", ...A1 } : null;
    if (step) return { kind: "link_new", route: "/connect", ...step };
  }

  if (f.activeWallets > 0 && f.firstActiveLinkAt) {
    const quietFrom = f.lastSwapAt ?? f.firstActiveLinkAt;
    if (age(f.firstActiveLinkAt) >= 14 * DAY && age(quietFrom) >= 14 * DAY) {
      return { id: `idle-${dayOf(quietFrom)}`, kind: "idle", ...A8, route: "/home" };
    }
  }

  return null;
}
