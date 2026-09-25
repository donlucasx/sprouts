import type { Repo } from "@/db/repo";
import type { Position } from "./staking";

const COOLDOWN_MS = 48 * 3_600_000;

export type WithdrawChain = {
  readPosition(user: string): Promise<Position>;
  /** Sends the permissionless withdraw for the user's position and returns the signature. */
  crankWithdraw(user: string): Promise<string>;
};

/** Finishes every withdrawal whose 48-hour cooldown has passed: the puller sends the permissionless withdraw and the row is closed. */
export async function runWithdrawCrank(a: { repo: Repo; now: Date; chain: WithdrawChain }): Promise<{ cranked: string[]; failed: string[] }> {
  const cranked: string[] = [];
  const failed: string[] = [];
  const due = await a.repo.dueWithdrawals(new Date(a.now.getTime() - COOLDOWN_MS));
  for (const w of due) {
    try {
      const position = await a.chain.readPosition(w.userPubkey);
      const signature = await a.chain.crankWithdraw(w.userPubkey);
      await a.repo.setWithdrawalDone(w.id, signature, position.unstakingRaw);
      cranked.push(w.id);
    } catch (e) {
      failed.push(w.id);
      await a.repo.addEvent({ userPubkey: w.userPubkey, walletPubkey: null, kind: "pull_failed", detail: { withdrawal: w.id, err: e instanceof Error ? e.message : String(e) } });
    }
  }
  return { cranked, failed };
}
