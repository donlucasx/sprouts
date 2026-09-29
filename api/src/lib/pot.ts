import type { Repo } from "@/db/repo";
import type { UserRow } from "@/db/types";
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
  const plantings = await repo.listConfirmedPlantings(user.seedVaultPubkey);
  const legs = (await Promise.all(plantings.map((p) => repo.plantingLegs(p.id)))).flat();
  const withdrawals = await repo.listWithdrawals(user.seedVaultPubkey, 10_000);
  const adjustments = await repo.listStakeAdjustments(user.seedVaultPubkey);
  return { plantings, legs, withdrawals, adjustments };
}

export type PotInputs = Awaited<ReturnType<typeof potInputs>>;

/** The pot from the ledger side already read and the chain reads given: one formula for the route, the reconciliation and the withdraw routes. */
export function potFromInputs(user: UserRow, inputs: PotInputs, chain: { position: Position; sharePrice: bigint }): Pot {
  return computePot({
    position: chain.position, sharePrice: chain.sharePrice, joined: { shares: user.joinedShares, sharePrice: user.joinedSharePrice },
    legsRaw: inputs.legs.filter((l) => l.asset === "SKR").map((l) => l.amountOutRaw),
    adjustments: inputs.adjustments,
    picks: inputs.withdrawals.filter((w) => w.cancelSignature === null).map((w) => ({ amountRaw: w.amountRaw ?? 0n, principalRaw: w.principalRaw })),
  });
}

/** The pot for one user from the ledger and the chain reads given (the caller reads the chain, or a test fakes it). */
export async function potForUser(repo: Repo, user: UserRow, chain: { position: Position; sharePrice: bigint }): Promise<Pot> {
  return potFromInputs(user, await potInputs(repo, user), chain);
}
