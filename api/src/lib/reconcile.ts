import type { Repo } from "@/db/repo";
import type { PlantingRow, StakeAdjustmentRow, WithdrawalRow } from "@/db/types";
import type { Position } from "./staking";
import { sharesToRaw, potForUser } from "./pot";

export type ReconcileChain = {
  readPosition(user: string): Promise<Position>;
  sharePrice(): Promise<bigint>;
  /** True once every signature given is finalized and succeeded; the real one waits up to `waitMs` for them. */
  finalized(signatures: string[], waitMs: number): Promise<boolean>;
};

/** Share dust from share-price rounding on a stake; anything under this is not a stake or an unstake. */
const DUST_SHARES = 10_000n;

/**
 * The position is read at `finalized`, which trails `confirmed` by seconds; Sprouts books its own plantings and picks at `confirmed`.
 * On 10-06 a read 4 s after a planting's stake missed its shares and, with an older cooldown open, booked them as a wallet unstake
 * (R499). So Sprouts' recent share moves must be finalized before the read; if they are not, the user waits for the next run.
 * The same cron that plants also reconciles, so the check is on finality, not on age: an age rule would never reconcile a user who
 * plants every day. Plantings and unstakes count as recent for RECENT_MS. A cancel has no time of its own (only the unstake's), and
 * it can land any time the cooldown is open (48 h, plus up to a day until the crank runs), so every cancel of the last CANCEL_MS is
 * checked; older ones are long finalized.
 */
const RECENT_MS = 10 * 60_000;
const CANCEL_MS = 7 * 24 * 3_600_000;
/** The longest one user's finality check may wait. */
const FINALITY_WAIT_MS = 30_000;

/** Every ledger fact the expected share count is built from; a change between the two reads means a move landed meanwhile. */
function ledgerKey(plantings: PlantingRow[], withdrawals: WithdrawalRow[], adjustments: StakeAdjustmentRow[]): string {
  return JSON.stringify([
    plantings.map((p) => [p.id, String(p.sharesMinted)]),
    withdrawals.map((w) => [w.id, w.source, w.cancelSignature, String(w.sharesUnstaked)]),
    adjustments.map((x) => String(x.sharesDelta)),
  ]);
}

/**
 * Once a day (R61, [A16]): the position's share count changes only on a stake or an unstake, never on rewards. Expected shares =
 * the shares at join, plus the shares each confirmed planting minted, minus the shares Sprouts' own picks burned (non-cancelled),
 * plus every adjustment found before. More shares than expected is a stake the user made from the wallet (put in, not fruit);
 * fewer is an unstake from the wallet (a wallet-source withdrawal row: it shrinks the plant; the tax export leaves wallet rows out).
 * The difference is valued at today's share price, at most two days off the real price. A user with a confirmed planting whose
 * minted shares were never recorded is skipped and logged, never adjusted [A1]. When in doubt the user is deferred, never booked:
 * a `sent` planting (it may have landed, the ledger does not count it yet), a recent move not finalized, a ledger that moved
 * during the read, or no time left before `deadlineMs`.
 */
export async function reconcileOwnStakes(a: { repo: Repo; chain: ReconcileChain; now: Date; deadlineMs?: number }): Promise<{ adjusted: string[]; skipped: string[]; deferred: string[] }> {
  const adjusted: string[] = [];
  const skipped: string[] = [];
  const deferred: string[] = [];
  const deadline = a.deadlineMs ?? Number.POSITIVE_INFINITY;
  const sharePrice = await a.chain.sharePrice();
  // Every `sent` planting, any age: one whose send threw may still have landed, and the next planting run settles it (R499 F2).
  const unsettled = new Set((await a.repo.listSentPlantings(new Date(8.64e15))).map((p) => p.userPubkey));
  for (const user of await a.repo.listUsers()) {
    if (Date.now() >= deadline) {
      deferred.push(user.seedVaultPubkey);
      continue;
    }
    try {
      if (unsettled.has(user.seedVaultPubkey)) {
        console.error(`reconcile: ${user.seedVaultPubkey} has a planting still marked sent; deferred to the next run`);
        deferred.push(user.seedVaultPubkey);
        continue;
      }
      const ledger = async () => {
        const [plantings, withdrawals, adjustments] = await Promise.all([
          a.repo.listConfirmedPlantings(user.seedVaultPubkey), a.repo.listWithdrawals(user.seedVaultPubkey, 10_000), a.repo.listStakeAdjustments(user.seedVaultPubkey),
        ]);
        return { plantings, withdrawals, adjustments, key: ledgerKey(plantings, withdrawals, adjustments) };
      };
      const { plantings, withdrawals, adjustments, key } = await ledger();
      if (plantings.some((p) => p.sharesMinted === null)) {
        console.error(`reconcile: ${user.seedVaultPubkey} has a confirmed planting without minted shares; seed it (spikes/set-joined.ts) before this runs`);
        skipped.push(user.seedVaultPubkey);
        continue;
      }
      const since = a.now.getTime() - RECENT_MS;
      const sprouts = withdrawals.filter((w) => w.source === "sprouts");
      const recent = [
        ...plantings.filter((p) => p.ts.getTime() > since).map((p) => p.signature),
        ...sprouts.filter((w) => w.unstakeTs.getTime() > since).map((w) => w.unstakeSignature),
        ...sprouts.filter((w) => w.cancelSignature !== null && w.unstakeTs.getTime() > a.now.getTime() - CANCEL_MS).map((w) => w.cancelSignature),
      ];
      // A recent row without a signature cannot be proven finalized: wait for the next run.
      if (recent.length > 0) {
        const waitMs = Math.max(0, Math.min(FINALITY_WAIT_MS, deadline - Date.now()));
        if (recent.some((s) => s === null) || !(await a.chain.finalized(recent as string[], waitMs))) {
          console.error(`reconcile: ${user.seedVaultPubkey} has Sprouts share moves not yet finalized; deferred to the next run`);
          deferred.push(user.seedVaultPubkey);
          continue;
        }
      }
      const position = await a.chain.readPosition(user.seedVaultPubkey);
      // A pick, cancel or planting booked while we waited or read would be counted on one side only (R499 F3).
      if ((await ledger()).key !== key) {
        console.error(`reconcile: ${user.seedVaultPubkey} ledger moved during the read; deferred to the next run`);
        deferred.push(user.seedVaultPubkey);
        continue;
      }
      const minted = plantings.reduce((s, p) => s + (p.sharesMinted ?? 0n), 0n);
      const burned = sprouts.filter((w) => w.cancelSignature === null).reduce((s, w) => s + (w.sharesUnstaked ?? 0n), 0n);
      const own = adjustments.reduce((s, x) => s + x.sharesDelta, 0n);
      const expected = user.joinedShares + minted - burned + own;
      const delta = position.shares - expected;
      if (delta > -DUST_SHARES && delta < DUST_SHARES) continue;
      if (delta < 0n && position.unstakingRaw === 0n) {
        // Fewer shares with nothing in the cooldown: a lagging read, or a cooldown already withdrawn between two runs. Not a fact to book
        // today (review I6); a real wallet unstake shows its cooldown on at least one daily run.
        console.error(`reconcile: ${user.seedVaultPubkey} shows ${-delta} fewer shares with nothing unstaking; deferred to the next run`);
        deferred.push(user.seedVaultPubkey);
        continue;
      }
      const amountRaw = sharesToRaw(delta < 0n ? -delta : delta, sharePrice);
      await a.repo.addStakeAdjustment({ userPubkey: user.seedVaultPubkey, kind: delta > 0n ? "own_stake" : "own_unstake", sharesDelta: delta, amountRaw, sharePrice });
      if (delta < 0n) {
        // An unstake made from the wallet: a withdrawal row so the pot and Activity see it (the tax export leaves wallet rows out);
        // Sprouts' crank delivers it after the cooldown (withdraw is permissionless).
        // Fruit first, the rest principal, like any pick [A15]: earned as it stood BEFORE the unstake, which took `-delta` shares from the
        // position (review C1: the post-unstake position would book the fruit as principal and re-offer it).
        const earnedNow = (await potForUser(a.repo, user, { position: { ...position, shares: position.shares - delta }, sharePrice })).skrEarnedRaw;
        const principalRaw = amountRaw > earnedNow ? amountRaw - earnedNow : 0n;
        await a.repo.insertWithdrawal({ userPubkey: user.seedVaultPubkey, asset: "SKR", source: "wallet", unstakeSignature: null, sharesUnstaked: -delta, amountRaw, principalRaw });
      }
      adjusted.push(user.seedVaultPubkey);
    } catch (e) {
      console.error(`reconcile: ${user.seedVaultPubkey} skipped: ${e instanceof Error ? e.message : String(e)}`);
      skipped.push(user.seedVaultPubkey);
    }
  }
  return { adjusted, skipped, deferred };
}
