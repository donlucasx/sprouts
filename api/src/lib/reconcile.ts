import type { Repo } from "@/db/repo";
import type { PlantingRow, StakeAdjustmentRow, WithdrawalRow } from "@/db/types";
import type { Position } from "./staking";
import { sharesToRaw, potForUser } from "./pot";
import { closeSupersededWithdrawals, insertCooldownRow, openWithdrawalsOf, SUPERSEDED_SLACK_MS } from "./withdraw-run";

export type ReconcileChain = {
  readPosition(user: string): Promise<Position>;
  sharePrice(): Promise<bigint>;
  /** True once every signature given is finalized and succeeded; the real one waits up to `waitMs` for them. */
  finalized(signatures: string[], waitMs: number): Promise<boolean>;
};

/** Share dust from share-price rounding on a stake; anything under this is not a stake or an unstake. */
export const DUST_SHARES = 10_000n;

/**
 * The position is read at `finalized`, which trails `confirmed` by seconds; Sprouts books its own plantings and picks at `confirmed`.
 * On 10-06 a read 4 s after a planting's stake missed its shares and, with an older cooldown open, booked them as a wallet unstake
 * (R499). So Sprouts' recent share moves must be finalized before the read; if they are not, the user waits for the next run.
 * The same cron that plants also reconciles, so the check is on finality, not on age: an age rule would never reconcile a user who
 * plants every day. Plantings and unstakes count as recent for RECENT_MS. A cancel has no time of its own (only the unstake's), and
 * it can land any time the cooldown stays open (48 h, longer while the crank fails), so every cancel of a pick from the last CANCEL_MS
 * is checked (round 2, R2-4) WITHOUT waiting: an unfinalized one defers the user to the next run, and one the RPC no longer returns
 * costs one call, not the 30 s wait, so it cannot eat the run's budget (round 3, R3-1).
 */
const RECENT_MS = 10 * 60_000;
const CANCEL_MS = 30 * 86_400_000;
/** The longest one user's finality check may wait. */
const FINALITY_WAIT_MS = 30_000;
/**
 * 0.1.13 Plant my SKR (Kimi code review #1): a user with an SKR planting marked or recorded in the last PLANT_RECENT_MS is deferred.
 * The stake confirm books its own put in (lib/plant-skr bookPlantedStake) inside its 45 s window; both sides check-then-write with no
 * lock, so a reconcile reading the same stake meanwhile could book it twice, and a double never heals (fewer shares than expected,
 * nothing unstaking: deferred for good). After the window the confirm has finished: its adjustment is in `expected`, and a stake that
 * landed after its confirm (mark only, nothing booked) is booked here as any wallet stake.
 */
export const PLANT_RECENT_MS = 15 * 60_000;

/** Every ledger fact the expected share count is built from; a change between the two reads means a move landed meanwhile. */
export function ledgerKey(plantings: PlantingRow[], withdrawals: WithdrawalRow[], adjustments: StakeAdjustmentRow[]): string {
  return JSON.stringify([
    plantings.map((p) => [p.id, String(p.sharesMinted)]),
    withdrawals.map((w) => [w.id, w.source, w.cancelSignature, String(w.sharesUnstaked)]),
    adjustments.map((x) => String(x.sharesDelta)),
  ]);
}

/**
 * The share count the ledger expects: the shares at join, plus each confirmed planting's minted shares, minus the shares Sprouts' own
 * picks burned (non-cancelled), plus every adjustment booked before. 0.1.13 (Plant my SKR, Kimi #2): the stake confirm books its own
 * adjustment with this same rule, so the next reconcile counts it here and finds nothing more to book.
 */
export function expectedShares(joinedShares: bigint, plantings: PlantingRow[], withdrawals: WithdrawalRow[], adjustments: StakeAdjustmentRow[]): bigint {
  const minted = plantings.reduce((s, p) => s + (p.sharesMinted ?? 0n), 0n);
  const burned = withdrawals.filter((w) => w.source === "sprouts" && w.cancelSignature === null).reduce((s, w) => s + (w.sharesUnstaked ?? 0n), 0n);
  const own = adjustments.reduce((s, x) => s + x.sharesDelta, 0n);
  return joinedShares + minted - burned + own;
}

/**
 * 11-14 (ops #6, fix E): a cooldown on chain that no open row covers (no open row at or after its start, less the slack) gets one
 * wallet row so the crank delivers it, e.g. an unstake and a restake from the wallet that netted to zero shares (3Jqt 11-12). The
 * user's superseded rows are closed first (fix B). A row the reconcile booked this run covers its own cooldown, so this adds nothing.
 */
async function coverCooldown(repo: Repo, user: string, position: Position): Promise<void> {
  if (position.unstakingRaw === 0n || position.unstakeTs === null) return;
  const chainMs = Number(position.unstakeTs) * 1000;
  const open = await openWithdrawalsOf(repo, user);
  if (open.some((w) => w.unstakeTs.getTime() + SUPERSEDED_SLACK_MS >= chainMs)) return;
  await closeSupersededWithdrawals(repo, user, position, open);
  await insertCooldownRow(repo, user, position);
  console.error(`reconcile: ${user} has ${position.unstakingRaw} unstaking with no open row; booked a wallet row for it`);
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
  // The bound is a day ahead of now, never a far-future sentinel: Postgres rejects a year past 9999 (round 2, R2-1).
  const unsettled = new Set((await a.repo.listSentPlantings(new Date(a.now.getTime() + 86_400_000))).map((p) => p.userPubkey));
  const plantSince = new Date(a.now.getTime() - PLANT_RECENT_MS);
  const planting = new Set((await Promise.all((["skr_plant_sent", "skr_planted"] as const).map((k) => a.repo.listEventsByKind(k, plantSince)))).flat().map((e) => e.userPubkey));
  for (const user of await a.repo.listUsers()) {
    if (Date.now() >= deadline) {
      deferred.push(user.seedVaultPubkey);
      continue;
    }
    try {
      if (planting.has(user.seedVaultPubkey)) {
        console.error(`reconcile: ${user.seedVaultPubkey} has an SKR planting from the last 15 minutes; deferred to the next run`);
        deferred.push(user.seedVaultPubkey);
        continue;
      }
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
      ];
      const cancels = sprouts.filter((w) => w.cancelSignature !== null && w.unstakeTs.getTime() > a.now.getTime() - CANCEL_MS).map((w) => w.cancelSignature as string);
      // A recent row without a signature cannot be proven finalized: wait for the next run.
      const waitMs = Math.max(0, Math.min(FINALITY_WAIT_MS, deadline - Date.now()));
      if ((recent.length > 0 && (recent.some((s) => s === null) || !(await a.chain.finalized(recent as string[], waitMs))))
        || (cancels.length > 0 && !(await a.chain.finalized(cancels, 0)))) {
        console.error(`reconcile: ${user.seedVaultPubkey} has Sprouts share moves not yet finalized; deferred to the next run`);
        deferred.push(user.seedVaultPubkey);
        continue;
      }
      const position = await a.chain.readPosition(user.seedVaultPubkey);
      // A pick, cancel or planting booked while we waited or read would be counted on one side only (R499 F3).
      if ((await ledger()).key !== key) {
        console.error(`reconcile: ${user.seedVaultPubkey} ledger moved during the read; deferred to the next run`);
        deferred.push(user.seedVaultPubkey);
        continue;
      }
      const expected = expectedShares(user.joinedShares, plantings, withdrawals, adjustments);
      const delta = position.shares - expected;
      if (delta > -DUST_SHARES && delta < DUST_SHARES) {
        await coverCooldown(a.repo, user.seedVaultPubkey, position);
        continue;
      }
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
        // 11-14 (ops #6, fix B): the chain has one cooldown slot, so the user's open rows older than this cooldown are dead: closed first.
        await closeSupersededWithdrawals(a.repo, user.seedVaultPubkey, position);
        await a.repo.insertWithdrawal({ userPubkey: user.seedVaultPubkey, asset: "SKR", source: "wallet", unstakeSignature: null, sharesUnstaked: -delta, amountRaw, principalRaw });
      }
      await coverCooldown(a.repo, user.seedVaultPubkey, position);
      adjusted.push(user.seedVaultPubkey);
    } catch (e) {
      console.error(`reconcile: ${user.seedVaultPubkey} skipped: ${e instanceof Error ? e.message : String(e)}`);
      skipped.push(user.seedVaultPubkey);
    }
  }
  return { adjusted, skipped, deferred };
}
