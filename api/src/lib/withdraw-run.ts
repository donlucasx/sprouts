import { errorText } from "./redact";
import type { Repo } from "@/db/repo";
import type { Position } from "./staking";

const COOLDOWN_MS = 48 * 3_600_000;

export type WithdrawChain = {
  readPosition(user: string): Promise<Position>;
  /** Sends the permissionless withdraw for the user's position and returns the signature. */
  crankWithdraw(user: string): Promise<string>;
};

/**
 * Finishes every withdrawal whose 48-hour cooldown has passed: the puller sends the permissionless withdraw and the row is closed.
 * The chain decides twice [A11]: a row with nothing unstaking on chain (a cancel the app did not see, or a wallet-side withdrawal
 * the user already took) is closed as skipped, never cranked; and the cooldown runs from the program's own unstake timestamp,
 * not the row's, so a cancel-and-unstake-again from the wallet waits its full 48 hours.
 * 11-13: past `deadlineMs` no new withdrawal is started (the 429 retry can stretch a run toward the route's 300 s kill); one
 * already started finishes, and the rest are returned as `deferred`, untouched, for the next run. No event, no error.
 */
export async function runWithdrawCrank(a: { repo: Repo; now: Date; chain: WithdrawChain; deadlineMs?: number }): Promise<{ cranked: string[]; failed: string[]; skipped: string[]; deferred: string[] }> {
  const cranked: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const deferred: string[] = [];
  const deadline = a.deadlineMs ?? Number.POSITIVE_INFINITY;
  const due = await a.repo.dueWithdrawals(new Date(a.now.getTime() - COOLDOWN_MS));
  for (const w of due) {
    if (Date.now() >= deadline) {
      deferred.push(w.id);
      continue;
    }
    try {
      const position = await a.chain.readPosition(w.userPubkey);
      if (position.unstakingRaw === 0n) {
        await a.repo.setWithdrawalSkipped(w.id);
        await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: null, kind: "withdraw_skipped", detail: { withdrawal: w.id } });
        skipped.push(w.id);
        continue;
      }
      if (position.unstakeTs !== null && Number(position.unstakeTs) * 1000 + COOLDOWN_MS > a.now.getTime()) continue;
      const signature = await a.chain.crankWithdraw(w.userPubkey);
      await a.repo.setWithdrawalDone(w.id, signature, position.unstakingRaw);
      cranked.push(w.id);
    } catch (e) {
      failed.push(w.id);
      console.error(`withdraw crank for ${w.userPubkey} failed: ${errorText(e)}`);
      await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: null, kind: "withdraw_failed", detail: { withdrawal: w.id, err: errorText(e) } });
    }
  }
  return { cranked, failed, skipped, deferred };
}
