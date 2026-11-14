import type { Repo } from "@/db/repo";
import type { UserRow, WithdrawalRow } from "@/db/types";
import type { Position } from "./staking";
import { SUPERSEDED_SLACK_MS } from "./withdraw-run";

const SCALE = 1_000_000_000n;

export const sharesToRaw = (shares: bigint, sharePrice: bigint): bigint => (shares * sharePrice) / SCALE;
export const rawToShares = (raw: bigint, sharePrice: bigint): bigint => (raw * SCALE) / sharePrice; // floor: the plant keeps the dust

export type Pot = {
  skrStakedRaw: bigint; skrPutInRaw: bigint; skrEarnedRaw: bigint; skrPickedRaw: bigint; skrPrincipalPickedRaw: bigint; joinedValueRaw: bigint;
  skrUnstakingRaw: bigint; skrUnstakeReadyAt: Date | null;
  fruit: number; nextFruitProgress: number;
};

const FIRST_STEP_BPS = 25n;   // 0.25% of put in (R59)
const STEP_BPS = 100n;        // then one fruit per further 1%
const MAX_FRUIT = 12;
const COOLDOWN_S = 172_800n;

/** How many fruit the plant shows: none below 0.25% of put in, then one per further 1%, at most twelve drawn. */
function fruitCount(putInRaw: bigint, earnedRaw: bigint): number {
  if (putInRaw <= 0n || earnedRaw <= 0n) return 0;
  const bps = (earnedRaw * 10_000n) / putInRaw;
  if (bps < FIRST_STEP_BPS) return 0;
  return Math.min(MAX_FRUIT, 1 + Number((bps - FIRST_STEP_BPS) / STEP_BPS));
}

/** Progress toward the next fruit, 0 to 1, for the ripening bud. */
function nextFruitProgress(putInRaw: bigint, earnedRaw: bigint): number {
  if (putInRaw <= 0n) return 0;
  const bps = Number((earnedRaw * 10_000n) / putInRaw);
  const first = Number(FIRST_STEP_BPS);
  const step = Number(STEP_BPS);
  if (bps < first) return bps / first;
  return ((bps - first) % step) / step;
}

/**
 * The pot, in one place (RECONCILED rule 2 as amended by the audit [A15]): today's position at the program's own share price;
 * put in = the value on the day the user joined, plus every planting's SKR that landed after the fee, plus stakes the user made
 * from the wallet, minus any principal withdrawn (a withdrawal above what was earned at sign time); earned = value minus put in,
 * never below zero. A fruit-only pick leaves the plant and earned counts again from zero; picked is reported for display only.
 */
export function computePot(a: {
  position: Position; sharePrice: bigint; joined: { shares: bigint; sharePrice: bigint }; legsRaw: bigint[];
  adjustments: { kind: "own_stake" | "own_unstake"; sharesDelta: bigint; amountRaw: bigint }[];
  picks: { amountRaw: bigint; principalRaw: bigint }[];
}): Pot {
  const value = sharesToRaw(a.position.shares, a.sharePrice);
  const joinedRaw = sharesToRaw(a.joined.shares, a.joined.sharePrice);
  const ownStakes = a.adjustments.filter((x) => x.kind === "own_stake").reduce((s, x) => s + x.amountRaw, 0n);
  const principal = a.picks.reduce((s, x) => s + x.principalRaw, 0n);
  const picked = a.picks.reduce((s, x) => s + x.amountRaw, 0n);
  const putIn = joinedRaw + a.legsRaw.reduce((s, x) => s + x, 0n) + ownStakes - principal;
  const earnedSigned = value - putIn;
  const earned = earnedSigned > 0n ? earnedSigned : 0n;
  return {
    skrStakedRaw: value, skrPutInRaw: putIn, skrEarnedRaw: earned, skrPickedRaw: picked, skrPrincipalPickedRaw: principal, joinedValueRaw: joinedRaw,
    skrUnstakingRaw: a.position.unstakingRaw,
    skrUnstakeReadyAt: a.position.unstakeTs === null ? null : new Date(Number(a.position.unstakeTs + COOLDOWN_S) * 1000),
    fruit: fruitCount(putIn, earned), nextFruitProgress: nextFruitProgress(putIn, earned),
  };
}
computePot.fruitCount = fruitCount;
computePot.nextFruitProgress = nextFruitProgress;

/** The ledger side of the pot for one user, so the route, the reconciliation and the withdraw routes share one formula. */
export async function potInputs(repo: Repo, user: UserRow) {
  // Independent reads at once; the legs of every planting in one batched read (was one read per planting).
  const [plantings, withdrawals, adjustments] = await Promise.all([
    repo.listConfirmedPlantings(user.seedVaultPubkey), repo.listWithdrawals(user.seedVaultPubkey, 10_000), repo.listStakeAdjustments(user.seedVaultPubkey),
  ]);
  const legs = plantings.length ? await repo.plantingLegsFor(plantings.map((p) => p.id)) : [];
  return { plantings, legs, withdrawals, adjustments };
}

export type PotInputs = Awaited<ReturnType<typeof potInputs>>;

/**
 * 11-14 (review of 962d66c): a row that books a whole cooldown, not a share drop: wallet source, no shares, no principal. That is the
 * sign-up row for a cooldown already running [A24] and fix E's row for a cooldown no open row covered. Its amount is everything
 * unstaking, so it can hold SKR an earlier row already counts.
 */
export const isWholeCooldownRow = (w: WithdrawalRow): boolean => w.source === "wallet" && (w.sharesUnstaked ?? 0n) === 0n && w.principalRaw === 0n;

/** `budget` holds `amount`, 1% slack for the share price drift between two valuations of the same SKR. */
export const holds = (budget: bigint, amount: bigint): boolean => budget * 100n >= amount * 99n;

/**
 * 11-14 (review of 962d66c): the rows whose SKR a later whole-cooldown row E counts again, so each SKR amount is one pick.
 * When E is booked, the same run first closes the user's older open rows as superseded (skippedAt within the slack before E's
 * time). The chain's one read cannot tell why each was replaced: cancelled and its shares unstaked again (put back: E holds that SKR)
 * or withdrawn from the wallet and followed by an unstake and a restake of the same size (a real pick: E holds new SKR). The rule:
 * newest first, a superseded row E's amount can still hold is E's own SKR again and leaves the picks; the first one E cannot hold
 * stops the walk. A cancelled E absorbs nothing (its cooldown went back, and the reconcile books the returned shares as a stake).
 * Display only: an absorbed row's principal still lowers put in, so put in, earned and fruit never move. Rows not superseded by a
 * whole-cooldown row (every Sprouts pick, every share-drop wallet row) count exactly as before.
 */
export function absorbedPickIds(withdrawals: WithdrawalRow[]): Set<string> {
  const absorbed = new Set<string>();
  const byTime = [...withdrawals].sort((a, b) => a.unstakeTs.getTime() - b.unstakeTs.getTime());
  for (const e of byTime) {
    if (!isWholeCooldownRow(e) || e.cancelSignature !== null) continue;
    const t = e.unstakeTs.getTime();
    const run = byTime
      .filter((s) => s.id !== e.id && !absorbed.has(s.id) && s.skippedAt !== null && s.withdrawSignature === null && s.cancelSignature === null
        && s.unstakeTs.getTime() < t && s.skippedAt.getTime() <= t && s.skippedAt.getTime() >= t - SUPERSEDED_SLACK_MS)
      .reverse();
    let left = e.amountRaw ?? 0n;
    for (const s of run) {
      const amount = s.amountRaw ?? 0n;
      if (!holds(left, amount)) break;
      absorbed.add(s.id);
      left = amount < left ? left - amount : 0n;
    }
  }
  return absorbed;
}

/** The withdrawals that count as picks (the picked total, the pick timeline, the withdrawal count): not cancelled, not absorbed. */
export function countedPicks(withdrawals: WithdrawalRow[]): WithdrawalRow[] {
  const absorbed = absorbedPickIds(withdrawals);
  return withdrawals.filter((w) => w.cancelSignature === null && !absorbed.has(w.id));
}

/** The pot from the ledger side already read and the chain reads given: one formula for the route, the reconciliation and the withdraw routes. */
export function potFromInputs(user: UserRow, inputs: PotInputs, chain: { position: Position; sharePrice: bigint }): Pot {
  return computePot({
    position: chain.position, sharePrice: chain.sharePrice, joined: { shares: user.joinedShares, sharePrice: user.joinedSharePrice },
    legsRaw: inputs.legs.filter((l) => l.asset === "SKR").map((l) => l.amountOutRaw),
    adjustments: inputs.adjustments,
    // An absorbed row adds nothing to picked; its principal still counts, so put in and earned are unchanged (absorbedPickIds).
    picks: ((absorbed) => inputs.withdrawals.filter((w) => w.cancelSignature === null)
      .map((w) => ({ amountRaw: absorbed.has(w.id) ? 0n : (w.amountRaw ?? 0n), principalRaw: w.principalRaw })))(absorbedPickIds(inputs.withdrawals)),
  });
}

/** The pot for one user from the ledger and the chain reads given (the caller reads the chain, or a test fakes it). */
export async function potForUser(repo: Repo, user: UserRow, chain: { position: Position; sharePrice: bigint }): Promise<Pot> {
  return potFromInputs(user, await potInputs(repo, user), chain);
}
