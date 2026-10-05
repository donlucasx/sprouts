import type * as T from "./types";
import type { Asset, LiveAsset, LendAsset, Stop } from "@/domain/coins";
import { isLendAsset } from "@/domain/coins";
import type { Venue } from "@/domain/venues";

/** A planting as the run records it; the share columns are filled in by the run and the confirmation [A16]. */
/** `ts` is the run's own clock (the reconciliation measures age against it); left out, the store stamps the row itself. */
export type NewPlanting = Omit<T.PlantingRow, "id" | "ts" | "sharesBefore" | "sharesAfter" | "sharesMinted" | "skrCarryInRaw" | "skrSurplusRaw"> & {
  sharesBefore?: bigint | null; ts?: Date; skrCarryInRaw?: bigint; carryIn?: Partial<Record<Exclude<T.CarryKind, "SKR">, bigint>>;
};

/** AMEND 10-04 s20 (T3 review I3): 0008's planting_legs_venue_iff_lend, checked by both repos before any write of a planting. */
export function checkLegVenues(legs: readonly { asset: string; venue: string | null }[]): void {
  for (const l of legs) {
    if (isLendAsset(l.asset) !== (l.venue != null)) {
      throw new Error(`planting leg ${l.asset} with venue ${l.venue ?? "null"}: a lending leg needs a venue and a coin leg has none (planting_legs_venue_iff_lend)`);
    }
  }
}

export type NewWatcherCall = Omit<T.WatcherCallRow, "id" | "ts"> & { ts?: Date };
export type NewWithdrawal = { userPubkey: string; asset: Asset; source: T.WithdrawalSource; unstakeSignature: string | null; sharesUnstaked: bigint; amountRaw: bigint; principalRaw: bigint };

/** Everything the routes and the cron need from the database. One in-memory implementation for tests, one on Supabase. */
export interface Repo {
  /** `created` is true the first time this key registers; the position at join is recorded right after (R61). */
  upsertUser(u: { seedVaultPubkey: string; sgtMint: string; skrName: string | null }): Promise<{ row: T.UserRow; created: boolean }>;
  getUser(pubkey: string): Promise<T.UserRow | null>;
  listUsers(): Promise<T.UserRow[]>;
  setJoinedPosition(userPubkey: string, p: { shares: bigint; sharePrice: bigint }): Promise<void>;
  setWateredAt(userPubkey: string, at: Date): Promise<void>;

  /** Creates the defaults when the user has no rules yet. */
  getRules(userPubkey: string): Promise<T.RulesRow>;
  saveRules(userPubkey: string, r: Partial<Omit<T.RulesRow, "userPubkey" | "updatedAt">>): Promise<T.RulesRow>;
  /** Every user whose Yield Manager is on, for the daily apply (spec 6.6). */
  listManagedRules(): Promise<T.RulesRow[]>;

  addWallet(w: { pubkey: string; userPubkey: string; delegationPda: string; dailyCapCents: number; webhookAdded?: boolean; linkModel?: T.LinkModel }): Promise<T.WalletRow>;
  getWallet(pubkey: string): Promise<T.WalletRow | null>;
  listActiveWallets(): Promise<T.WalletRow[]>;
  listPausedWallets(): Promise<T.WalletRow[]>;
  /** Every status, so a revoked wallet stays visible in the app [A20]. */
  listWalletsOf(userPubkey: string): Promise<T.WalletRow[]>;
  setWalletStatus(pubkey: string, status: T.WalletStatus): Promise<void>;
  bumpLedger(pubkey: string, asset: LiveAsset, cents: number): Promise<void>;

  /** False when the signature is already booked. */
  insertSwap(s: Omit<T.SwapRow, "plantingId" | "createdAt">): Promise<boolean>;
  unplantedSwaps(walletPubkey: string): Promise<T.SwapRow[]>;
  /** Across the user's wallets, newest first. */
  listSwaps(userPubkey: string, limit: number): Promise<T.SwapRow[]>;
  /** Claims the swaps for a planting in one conditional statement (only unclaimed ones); returns how many were claimed. */
  claimSwaps(signatures: string[], plantingId: string): Promise<number>;
  /** Gives a planting's swaps back to the unplanted set (a send that never landed, or a claim another run won). */
  releaseSwaps(plantingId: string): Promise<void>;

  insertPlanting(p: NewPlanting, legs: Omit<T.PlantingLegRow, "plantingId">[]): Promise<T.PlantingRow>;
  setPlantingStatus(id: string, status: T.PlantingStatus, signature?: string): Promise<void>;
  setPlantingShares(plantingId: string, p: { before: bigint | null; after: bigint; minted: bigint }): Promise<void>;
  /** R141: the leg's amount becomes what landed, once read after confirmation. */
  setLegAmountOut(plantingId: string, asset: LiveAsset, amountOutRaw: bigint): Promise<void>;
  /**
   * R207 #2: the user's SKR remainder still in the puller's account, = the surplus of their confirmed plantings minus the carry of
   * their sent and confirmed ones. Only this user's rows count; a failed planting's carry is given back.
   */
  skrCreditRaw(userPubkey: string): Promise<bigint>;
  /** R207 #2: a confirmed planting's surplus, written once (a second booking of the same planting never overwrites or adds). */
  setPlantingSkrSurplus(plantingId: string, surplusRaw: bigint): Promise<void>;
  /** Plantings still `sent` (their send threw before confirmation) that started before `olderThan`. */
  listSentPlantings(olderThan: Date): Promise<T.PlantingRow[]>;
  /** Newest first, any status. */
  listPlantings(userPubkey: string, limit: number): Promise<T.PlantingRow[]>;
  /** Oldest first. */
  listConfirmedPlantings(userPubkey: string): Promise<T.PlantingRow[]>;
  plantingLegs(plantingId: string): Promise<T.PlantingLegRow[]>;

  addStakeAdjustment(a: Omit<T.StakeAdjustmentRow, "id" | "ts">): Promise<void>;
  listStakeAdjustments(userPubkey: string): Promise<T.StakeAdjustmentRow[]>;

  addEvent(e: Omit<T.EventRow, "id" | "ts">): Promise<void>;
  /** The user's events of the given kinds, newest first, at most `limit`: Activity's split rows (spec 3.2). */
  listEvents(userPubkey: string, kinds: T.EventKind[], limit: number): Promise<T.EventRow[]>;

  putNonce(n: { nonce: string; expiresAt: Date }): Promise<void>;
  /** One atomic step; false when unknown, used or expired. */
  useNonce(nonce: string, pubkey: string): Promise<boolean>;

  putLinkCode(c: { code: string; userPubkey: string; expiresAt: Date; nonce: bigint }): Promise<void>;
  /** Unexpired and unused, or null. */
  peekLinkCode(code: string): Promise<T.LinkCodeRow | null>;
  /** The first wallet that fetches the transaction owns the code. */
  bindLinkCode(code: string, walletPubkey: string, delegationPda: string): Promise<void>;
  /** Consumes the code for the wallet it is bound to, only after the chain confirmed the delegation. */
  takeLinkCode(code: string, walletPubkey: string): Promise<T.LinkCodeRow | null>;

  insertWithdrawal(w: NewWithdrawal): Promise<T.WithdrawalRow>;
  /** Not delivered, not cancelled, not skipped, either source: the basket (a cooldown the wallet started is one too, review I2). */
  pendingWithdrawal(userPubkey: string): Promise<T.WithdrawalRow | null>;
  /** Newest first. */
  listWithdrawals(userPubkey: string, limit: number): Promise<T.WithdrawalRow[]>;
  /** Not delivered, not cancelled, not skipped, unstaked before `before` [A11]. */
  dueWithdrawals(before: Date): Promise<T.WithdrawalRow[]>;
  setWithdrawalDone(id: string, signature: string, amountOutRaw: bigint): Promise<void>;
  setWithdrawalCancelled(id: string, signature: string): Promise<void>;
  /** Closes a row the chain has nothing unstaking for (a cancel the app did not see, or a wallet-side withdrawal already taken). */
  setWithdrawalSkipped(id: string): Promise<void>;

  /** Replaces any live session of the same user on the same device (R84: one per wallet per device). */
  putSession(s: { tokenHash: string; userPubkey: string; device: string; expiresAt: Date }): Promise<void>;
  getSession(tokenHash: string): Promise<T.SessionRow | null>;
  revokeSession(tokenHash: string): Promise<void>;
  revokeAllSessions(userPubkey: string): Promise<void>;
  /** Nonces, link codes and dead sessions older than a day (review M10). */
  cleanupExpired(): Promise<void>;

  /** One light read so a free-tier database sees traffic every day; needs no user row. */
  keepalive(): Promise<void>;

  // The watcher's budget (spec 6): every model call recorded; spend since a moment, calls by one user since a moment.
  addWatcherCall(c: NewWatcherCall): Promise<number>;
  /** A reserved call's real usage, once the model has answered (R207 #6: calls are reserved at an estimate before they run). */
  settleWatcherCall(id: number, u: { inputTokens: number; outputTokens: number; costMicrocents: number }): Promise<void>;
  /** A reservation given back: refused over a cap, or the model was never reached. */
  deleteWatcherCall(id: number): Promise<void>;
  watcherSpendMicrocents(since: Date): Promise<number>;
  watcherCallsBy(userPubkey: string, since: Date): Promise<number>;
  listWatcherCalls(): Promise<T.WatcherCallRow[]>;

  // The Yield Manager's tables (spec 5.2, 6.7).
  putCoinDay(row: T.CoinDayRow): Promise<void>;
  getCoinDay(day: string, asset: LiveAsset): Promise<T.CoinDayRow | null>;
  /** One asset's rows from `sinceDay` on, oldest first. */
  listCoinDays(asset: LiveAsset, sinceDay: string): Promise<T.CoinDayRow[]>;
  putSplitDay(row: T.SplitDayRow): Promise<void>;
  getSplitDay(day: string, stop: Stop): Promise<T.SplitDayRow | null>;
  /** The newest row for the stop, or the newest strictly before `beforeDay` when given. */
  latestSplitDay(stop: Stop, beforeDay?: string): Promise<T.SplitDayRow | null>;

  // 0008: venues and the scout (contracts 4)
  putVenueDay(row: T.VenueDayRow): Promise<void>;
  listVenueDays(day: string): Promise<T.VenueDayRow[]>;
  /** Oldest first. */
  listVenueHistory(venue: Venue, asset: LendAsset, sinceDay: string): Promise<T.VenueDayRow[]>;
  putFoundVenues(rows: T.FoundVenueRow[]): Promise<void>;
  /** Newest first. */
  listFoundVenues(sinceDay: string, limit: number): Promise<T.FoundVenueRow[]>;
  // moves
  /** Null when one is already open for the user (unique index move_proposals_one_open). */
  insertMoveProposal(p: Omit<T.MoveProposalRow, "id" | "ts" | "status" | "redeemSignature" | "depositSignature" | "closedAt">): Promise<T.MoveProposalRow | null>;
  openMoveProposal(userPubkey: string): Promise<T.MoveProposalRow | null>;
  getMoveProposal(id: string): Promise<T.MoveProposalRow | null>;
  setMoveProposalStatus(id: string, status: T.MoveStatus, sig?: { redeem?: string; deposit?: string }): Promise<void>;
  // carry (SKR keeps skrCreditRaw / setPlantingSkrSurplus / skrCarryInRaw unchanged)
  carryCreditRaw(userPubkey: string, kind: T.CarryKind): Promise<bigint>;
  /** The carry a planting drew (kind -> carry_in_raw), so a late booking can compute its surplus. */
  plantingCarry(plantingId: string): Promise<Partial<Record<"WSOL" | "USDC", bigint>>>;
  /** Written once per (planting, kind); creates the row when the planting carried nothing in. */
  setPlantingSurplus(plantingId: string, kind: Exclude<T.CarryKind, "SKR">, surplusRaw: bigint): Promise<void>;
  // links and terms
  setWalletLink(pubkey: string, l: { delegationPda: string; linkModel: T.LinkModel }): Promise<void>;
  setTermsAccepted(userPubkey: string, version: string, at: Date): Promise<void>;
}

let forTests: Repo | null = null;
let live: Repo | null = null;

export function setRepoForTests(repo: Repo | null) {
  forTests = repo;
}

/** The Supabase repo in production; whatever a test injected otherwise. */
export async function getRepo(): Promise<Repo> {
  if (forTests) return forTests;
  if (!live) {
    const { SupabaseRepo } = await import("./supabase");
    live = new SupabaseRepo();
  }
  return live;
}
