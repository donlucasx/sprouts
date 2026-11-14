import { errorText } from "./redact";
import { alertFounder, type AlertCard } from "./founder-alert";
import type { Repo } from "@/db/repo";
import type { WithdrawalRow } from "@/db/types";
import type { Position } from "./staking";

const COOLDOWN_MS = 48 * 3_600_000;
/**
 * A Sprouts row is written seconds after its unstake lands (the confirm route waits for the chain's cooldown); a wallet row hours
 * after (the reconcile's detection time). A row more than this much older than the chain's one cooldown cannot be that cooldown.
 */
export const SUPERSEDED_SLACK_MS = 5 * 60_000;

export type WithdrawChain = {
  readPosition(user: string): Promise<Position>;
  /** Sends the permissionless withdraw for the user's position and returns the signature. */
  crankWithdraw(user: string): Promise<string>;
};

const isOpen = (w: WithdrawalRow) => w.withdrawSignature === null && w.cancelSignature === null && w.skippedAt === null;

/** The user's open rows, any age, newest first. */
export async function openWithdrawalsOf(repo: Repo, user: string): Promise<WithdrawalRow[]> {
  return (await repo.listWithdrawals(user, 10_000)).filter(isOpen);
}

/**
 * 11-14 (ops #6): the staking program keeps ONE cooldown per position, so of a user's open rows only one whose time is at or after
 * the chain's cooldown start (less the slack) can be live. Every older open row's cooldown was withdrawn or cancelled from the wallet
 * and replaced: it is closed as skipped (never cancelled, so the pot still counts the pick) with withdraw_skipped {reason:
 * "superseded"}. Returns the ids closed and the rows left open. Nothing is closed while nothing is unstaking or the chain has no time.
 */
export async function closeSupersededWithdrawals(repo: Repo, user: string, position: Position, open?: WithdrawalRow[]): Promise<{ closed: string[]; live: WithdrawalRow[] }> {
  const rows = open ?? (await openWithdrawalsOf(repo, user));
  if (position.unstakingRaw === 0n || position.unstakeTs === null) return { closed: [], live: rows };
  const chainMs = Number(position.unstakeTs) * 1000;
  const closed: string[] = [];
  const live: WithdrawalRow[] = [];
  for (const w of rows) {
    if (w.unstakeTs.getTime() + SUPERSEDED_SLACK_MS >= chainMs) {
      live.push(w);
      continue;
    }
    if (await repo.setWithdrawalSkipped(w.id)) {
      await repo.addEvent({ userPubkey: user, walletPubkey: null, kind: "withdraw_skipped", detail: { withdrawal: w.id, reason: "superseded" } });
      closed.push(w.id);
    }
  }
  return { closed, live };
}

/**
 * Fix E (ops #6): a cooldown no open row covers (3Jqt 11-12: unstake and restake in one minute netted to zero shares, so the
 * reconcile booked nothing) gets one wallet row, like the sign-up path [A24]: amount = what is unstaking, no shares and no principal
 * (the pot's put in is untouched), so the crank delivers it. Bookkeeping only: the withdraw always goes to the position's owner.
 */
export async function insertCooldownRow(repo: Repo, user: string, position: Position): Promise<WithdrawalRow> {
  return repo.insertWithdrawal({ userPubkey: user, asset: "SKR", source: "wallet", unstakeSignature: null, sharesUnstaked: 0n, amountRaw: position.unstakingRaw, principalRaw: 0n });
}

/**
 * Finishes every withdrawal whose 48-hour cooldown has passed: the puller sends the permissionless withdraw and the row is closed.
 * The chain decides twice [A11]: a row with nothing unstaking on chain (a cancel the app did not see, or a wallet-side withdrawal
 * the user already took) is closed as skipped, never cranked; and the cooldown runs from the program's own unstake timestamp,
 * not the row's, so a cancel-and-unstake-again from the wallet waits its full 48 hours.
 * 11-13: past `deadlineMs` no new user is started (the 429 retry can stretch a run toward the route's 300 s kill); one already
 * started finishes, and the rest are returned as `deferred`, untouched, for the next run. No event, no error.
 * 11-14 (ops #6): the users with a due row are visited, each read ONCE. Every open row of that user (due or not) older than the
 * chain's one cooldown is closed as superseded; the withdraw is sent only once the chain's cooldown is past 48 hours, and booked on
 * the live row (a matured cooldown with no live row gets one, fix E). A booking that fails or changes no row after the send is not
 * a failure (the SKR went out): it is logged and the founder alerted.
 */
export async function runWithdrawCrank(a: {
  repo: Repo; now: Date; chain: WithdrawChain; deadlineMs?: number; alert?: (card: AlertCard) => Promise<void>;
}): Promise<{ cranked: string[]; failed: string[]; skipped: string[]; deferred: string[] }> {
  const cranked: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const deferred: string[] = [];
  const deadline = a.deadlineMs ?? Number.POSITIVE_INFINITY;
  const alert = a.alert ?? ((card: AlertCard) => alertFounder(card));
  const byUser = new Map<string, WithdrawalRow[]>();
  for (const w of await a.repo.dueWithdrawals(new Date(a.now.getTime() - COOLDOWN_MS))) byUser.set(w.userPubkey, [...(byUser.get(w.userPubkey) ?? []), w]);
  for (const [user, due] of byUser) {
    if (Date.now() >= deadline) {
      deferred.push(...due.map((w) => w.id));
      continue;
    }
    const closedHere = new Set<string>();
    let target: WithdrawalRow | null = null;
    try {
      const position = await a.chain.readPosition(user);
      if (position.unstakingRaw === 0n) {
        for (const w of due) {
          if (!(await a.repo.setWithdrawalSkipped(w.id))) continue;
          await a.repo.addEvent({ userPubkey: user, walletPubkey: null, kind: "withdraw_skipped", detail: { withdrawal: w.id } });
          skipped.push(w.id);
        }
        continue;
      }
      const { closed, live } = await closeSupersededWithdrawals(a.repo, user, position);
      for (const id of closed) closedHere.add(id);
      skipped.push(...closed);
      if (position.unstakeTs !== null && Number(position.unstakeTs) * 1000 + COOLDOWN_MS > a.now.getTime()) continue;
      // Newest first: with more than one live row (rare), the newest takes the delivery; the next run closes the rest (nothing unstaking).
      target = live[0] ?? (await insertCooldownRow(a.repo, user, position));
      const signature = await a.chain.crankWithdraw(user);
      let booked: boolean;
      try {
        booked = await a.repo.setWithdrawalDone(target.id, signature, position.unstakingRaw);
      } catch (e) {
        console.error(`withdraw crank for ${user}: withdraw ${signature} sent but booking row ${target.id} threw: ${errorText(e)}`);
        await alert({ channel: "ops", title: "Withdrawal sent but not booked", text: `Withdraw ${signature} went out; recording it on row ${target.id} failed: ${errorText(e).slice(0, 200)}`, fields: [["User", user]], todo: "The SKR reached the user. Close the row by hand (withdraw_signature) once the database answers" }).catch(() => {});
        cranked.push(target.id);
        continue;
      }
      if (!booked) {
        console.error(`withdraw crank for ${user}: withdraw ${signature} sent but row ${target.id} was already closed; nothing booked`);
        await alert({ channel: "ops", title: "Withdrawal sent, row already closed", text: `Withdraw ${signature} went out; row ${target.id} was closed meanwhile, so the delivery is not on any row`, fields: [["User", user]], todo: "The SKR reached the user. Check that row (cancelled or skipped while the crank ran) and book the withdraw by hand if needed" }).catch(() => {});
      }
      cranked.push(target.id);
    } catch (e) {
      // Only a throw before the withdraw went out lands here (the booking after the send has its own catch). One failure per row
      // still open that this run meant to deliver (the ops light resolves each when it closes): the due rows not closed here, and the
      // target row when it is not one of them (a live row not yet due, or the row fix E added).
      const ids = due.map((w) => w.id).filter((id) => !closedHere.has(id));
      if (target !== null && !ids.includes(target.id)) ids.push(target.id);
      failed.push(...ids);
      console.error(`withdraw crank for ${user} failed: ${errorText(e)}`);
      for (const id of ids) await a.repo.addEvent({ userPubkey: user, walletPubkey: null, kind: "withdraw_failed", detail: { withdrawal: id, err: errorText(e) } });
    }
  }
  return { cranked, failed, skipped, deferred };
}
