import type { Repo } from "@/db/repo";
import type { EventRow, UserRow, WithdrawalRow } from "@/db/types";
import type { Position } from "./staking";

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
  const [plantings, withdrawals, adjustments, skippedEvents] = await Promise.all([
    repo.listConfirmedPlantings(user.seedVaultPubkey), repo.listWithdrawals(user.seedVaultPubkey, 10_000), repo.listStakeAdjustments(user.seedVaultPubkey),
    // 11-14: why each skipped withdrawal closed (absorbedPickIds absorbs only "superseded" ones)
    repo.listEvents(user.seedVaultPubkey, ["withdraw_skipped"], 10_000),
  ]);
  const legs = plantings.length ? await repo.plantingLegsFor(plantings.map((p) => p.id)) : [];
  return { plantings, legs, withdrawals, adjustments, skippedEvents };
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

/** Rows in booking order, ties broken on id, so every walk below gives the same answer whatever order the rows were read in. */
export const byBooking = (a: WithdrawalRow, b: WithdrawalRow): number => a.unstakeTs.getTime() - b.unstakeTs.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export const bookedBefore = (a: WithdrawalRow, b: WithdrawalRow): boolean => byBooking(a, b) < 0;

/** The withdrawals closed as superseded (withdraw_skipped {reason: "superseded"}, 962d66c). A skipped row without that event closed with nothing unstaking. */
export function supersededIds(skippedEvents: EventRow[]): Set<string> {
  const ids = new Set<string>();
  for (const e of skippedEvents) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (e.kind === "withdraw_skipped" && d.reason === "superseded" && typeof d.withdrawal === "string") ids.add(d.withdrawal);
  }
  return ids;
}

/**
 * 11-14 (review of 962d66c): the rows whose SKR a later whole-cooldown row E counts again, so each SKR amount is one pick.
 * A row S closed as superseded is a candidate for the FIRST whole-cooldown row booked after S closed, whichever ran first: the
 * reconcile closes and books E in one run, but the crank can close S while the new cooldown runs and the reconcile book E hours
 * later. S is no candidate when anything ended or replaced its cooldown before E: another row booked after S closed (it covered the
 * cooldown), a row newer than S delivered or cancelled, or a skip that found nothing unstaking. The chain's one read cannot tell
 * why S was replaced: cancelled and its shares unstaked again (put back: E holds that SKR) or withdrawn from the wallet and followed
 * by an unstake and a restake of the same size (a real pick: E holds new SKR). The rule: newest first, a candidate E's amount can
 * still hold is E's own SKR again and leaves the picks; the first one E cannot hold stops the walk. A cancelled E absorbs nothing
 * (its cooldown went back, and the reconcile books the returned shares as a stake). A skipped row with no "superseded" event (closed
 * with nothing unstaking, or before 962d66c) is never absorbed.
 * Display only: an absorbed row's principal still lowers put in, so put in, earned and fruit never move. Rows not superseded into a
 * whole-cooldown row (every share-drop wallet row, every Sprouts pick delivered or still cooling) count exactly as before.
 */
export function absorbedPickIds(withdrawals: WithdrawalRow[], skippedEvents: EventRow[]): Set<string> {
  if (!Array.isArray(skippedEvents)) throw new Error("absorbedPickIds needs the withdraw_skipped events");
  const superseded = supersededIds(skippedEvents);
  const rows = [...withdrawals].sort(byBooking);
  const emptySkips = rows.filter((k) => k.skippedAt !== null && !superseded.has(k.id)).map((k) => (k.skippedAt as Date).getTime());
  const absorbed = new Set<string>();
  for (const e of rows) {
    if (!isWholeCooldownRow(e) || e.cancelSignature !== null) continue;
    const t = e.unstakeTs.getTime();
    const run = rows.filter((s) => {
      if (s.id === e.id || absorbed.has(s.id) || !superseded.has(s.id) || s.skippedAt === null || s.withdrawSignature !== null || s.cancelSignature !== null) return false;
      const closed = s.skippedAt.getTime();
      if (!bookedBefore(s, e) || closed > t) return false;
      if (rows.some((x) => x.id !== s.id && x.id !== e.id && x.unstakeTs.getTime() > closed && bookedBefore(x, e))) return false;
      if (rows.some((x) => (x.withdrawSignature !== null || x.cancelSignature !== null) && bookedBefore(s, x) && bookedBefore(x, e))) return false;
      return !emptySkips.some((k) => k > closed && k < t);
    }).reverse();
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
export function countedPicks(withdrawals: WithdrawalRow[], skippedEvents: EventRow[]): WithdrawalRow[] {
  const absorbed = absorbedPickIds(withdrawals, skippedEvents);
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
      .map((w) => ({ amountRaw: absorbed.has(w.id) ? 0n : (w.amountRaw ?? 0n), principalRaw: w.principalRaw })))(absorbedPickIds(inputs.withdrawals, inputs.skippedEvents)),
  });
}

/** The pot for one user from the ledger and the chain reads given (the caller reads the chain, or a test fakes it). */
export async function potForUser(repo: Repo, user: UserRow, chain: { position: Position; sharePrice: bigint }): Promise<Pot> {
  return potFromInputs(user, await potInputs(repo, user), chain);
}
