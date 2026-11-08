import type { Repo } from "@/db/repo";
import type { EventKind, EventRow, UserRow, WalletRow } from "@/db/types";
import { pauseCauseOf, PAUSE_EVENT_KINDS } from "@/domain/pause-cause";
import type { ReminderFacts } from "@/domain/reminders";

/** One read answers the reminder facts and the ask (events newest first). */
export const REMINDER_EVENT_KINDS: EventKind[] = ["paused_no_usdc", "resumed", "paused_by_user", "revoke_seen", "link_failed", "link_started", "wallet_linked"];
export const REMINDER_EVENT_LIMIT = 200;
const ANSWER_LIMIT = 50;

/**
 * A wallet Sprouts stopped on its own (its USDC approval gone, or its delegation gone outside the app): "approval" or "outside". A revoke
 * the user made ("by: user"), a puller link's, or a wallet with no revoke_seen is not. `events` newest first. /api/me's `stopped` field and the A7 reminder share this.
 */
export function stoppedCauseOf(w: Pick<WalletRow, "pubkey" | "status" | "linkModel">, events: readonly Pick<EventRow, "walletPubkey" | "detail" | "ts" | "kind">[]): { cause: "approval" | "outside"; at: Date } | null {
  if (w.status !== "revoked" || w.linkModel !== "leash") return null;
  const e = events.find((x) => x.kind === "revoke_seen" && x.walletPubkey === w.pubkey);
  const by = (e?.detail as { by?: unknown } | null)?.by;
  if (!e || by === "user") return null;
  return { cause: by === "token_revoke" ? "approval" : "outside", at: e.ts };
}

export type ReminderInputs = { events: EventRow[]; answers: EventRow[]; lastSwapAt: Date | null; /** false: the reads failed, so neither a reminder nor an ask is made */ ok: boolean };
const EMPTY_INPUTS: ReminderInputs = { events: [], answers: [], lastSwapAt: null, ok: false };

/**
 * The reads, for a caller that runs them inside its own Promise.all. Answers are their own read so a chatty user's 200-row window never
 * pushes one out (it would be asked again). The reminder and the ask are extras: on any error this logs one line and answers empty, and /api/me still answers.
 */
export async function readReminderInputs(repo: Repo, user: UserRow): Promise<ReminderInputs> {
  try {
    const [events, answers, swaps] = await Promise.all([
      repo.listEvents(user.seedVaultPubkey, REMINDER_EVENT_KINDS, REMINDER_EVENT_LIMIT),
      repo.listEvents(user.seedVaultPubkey, ["feedback_answer"], ANSWER_LIMIT),
      repo.listSwaps(user.seedVaultPubkey, 1),
    ]);
    return { events, answers, lastSwapAt: swaps[0]?.ts ?? null, ok: true };
  } catch (e) {
    console.error(`/api/me: the reminder facts could not be read (${e instanceof Error ? e.message : String(e)})`);
    return EMPTY_INPUTS;
  }
}

export function reminderFactsFrom(inputs: ReminderInputs, user: UserRow, wallets: WalletRow[], now: Date): ReminderFacts {
  const { events } = inputs;
  const newest = (kind: EventKind) => events.find((e) => e.kind === kind)?.ts ?? null;

  const pauseEvents = events.filter((e) => (PAUSE_EVENT_KINDS as readonly string[]).includes(e.kind));
  const pausedNoUsdcSince = wallets.flatMap((w) => {
    if (w.status !== "paused" || pauseCauseOf(pauseEvents, w.pubkey).reason !== "no_usdc") return [];
    const since = pauseEvents.find((e) => e.walletPubkey === w.pubkey)!.ts; // the newest pause event of this wallet is the paused_no_usdc
    return [{ wallet: w.pubkey, since }];
  });

  const stoppedSince = wallets.flatMap((w) => {
    const s = stoppedCauseOf(w, events);
    return s ? [{ wallet: w.pubkey, since: s.at }] : [];
  });

  const active = wallets.filter((w) => w.status === "active");
  const firstActiveLinkAt = active.reduce<Date | null>((a, w) => (!a || w.createdAt.getTime() < a.getTime() ? w.createdAt : a), null);

  const lastLinkFailAt = newest("link_failed");
  const lastLinkAttemptAfterFail = lastLinkFailAt !== null && events.some((e) => (e.kind === "link_started" || e.kind === "wallet_linked") && e.ts.getTime() > lastLinkFailAt.getTime());

  return {
    now, signedUpAt: user.createdAt, walletsEver: wallets.length, activeWallets: active.length,
    pausedNoUsdcSince, stoppedSince, lastSwapAt: inputs.lastSwapAt, firstActiveLinkAt, lastLinkFailAt, lastLinkAttemptAfterFail,
  };
}

export async function reminderFactsFor(repo: Repo, user: UserRow, wallets: WalletRow[], now: Date): Promise<ReminderFacts> {
  return reminderFactsFrom(await readReminderInputs(repo, user), user, wallets, now);
}
