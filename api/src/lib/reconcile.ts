import type { Repo } from "@/db/repo";
import type { Position } from "./staking";
import { sharesToRaw, potForUser } from "./pot";

export type ReconcileChain = { readPosition(user: string): Promise<Position>; sharePrice(): Promise<bigint> };

/** Share dust from share-price rounding on a stake; anything under this is not a stake or an unstake. */
const DUST_SHARES = 10_000n;

/**
 * Once a day (R61, [A16]): the position's share count changes only on a stake or an unstake, never on rewards. Expected shares =
 * the shares at join, plus the shares each confirmed planting minted, minus the shares Sprouts' own picks burned (non-cancelled),
 * plus every adjustment found before. More shares than expected is a stake the user made from the wallet (put in, not fruit);
 * fewer is an unstake from the wallet (a wallet-source withdrawal row: it shrinks the plant and goes into the tax export). The
 * difference is valued at today's share price, at most two days off the real price. A user with a confirmed planting whose minted
 * shares were never recorded is skipped and logged, never adjusted [A1].
 */
export async function reconcileOwnStakes(a: { repo: Repo; chain: ReconcileChain }): Promise<{ adjusted: string[]; skipped: string[]; deferred: string[] }> {
  const adjusted: string[] = [];
  const skipped: string[] = [];
  const deferred: string[] = [];
  const sharePrice = await a.chain.sharePrice();
  for (const user of await a.repo.listUsers()) {
    try {
      const plantings = await a.repo.listConfirmedPlantings(user.seedVaultPubkey);
      if (plantings.some((p) => p.sharesMinted === null)) {
        console.error(`reconcile: ${user.seedVaultPubkey} has a confirmed planting without minted shares; seed it (spikes/set-joined.ts) before this runs`);
        skipped.push(user.seedVaultPubkey);
        continue;
      }
      const position = await a.chain.readPosition(user.seedVaultPubkey);
      const minted = plantings.reduce((s, p) => s + (p.sharesMinted ?? 0n), 0n);
      const burned = (await a.repo.listWithdrawals(user.seedVaultPubkey, 10_000))
        .filter((w) => w.source === "sprouts" && w.cancelSignature === null)
        .reduce((s, w) => s + (w.sharesUnstaked ?? 0n), 0n);
      const own = (await a.repo.listStakeAdjustments(user.seedVaultPubkey)).reduce((s, x) => s + x.sharesDelta, 0n);
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
        // An unstake made from the wallet: a withdrawal row so the tax export sees it (spec 7.1); Sprouts' crank delivers it after the cooldown (withdraw is permissionless).
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
