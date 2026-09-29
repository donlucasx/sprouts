import type * as T from "./types";
import type { Asset } from "@/domain/allocation";

/** A planting as the run records it; the share columns are filled in by the run and the confirmation [A16]. */
export type NewPlanting = Omit<T.PlantingRow, "id" | "ts" | "sharesBefore" | "sharesAfter" | "sharesMinted"> & { sharesBefore?: bigint | null };

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

  addWallet(w: { pubkey: string; userPubkey: string; delegationPda: string; dailyCapCents: number; webhookAdded?: boolean }): Promise<T.WalletRow>;
  getWallet(pubkey: string): Promise<T.WalletRow | null>;
  listActiveWallets(): Promise<T.WalletRow[]>;
  listPausedWallets(): Promise<T.WalletRow[]>;
  /** Every status, so a revoked wallet stays visible in the app [A20]. */
  listWalletsOf(userPubkey: string): Promise<T.WalletRow[]>;
  setWalletStatus(pubkey: string, status: T.WalletStatus): Promise<void>;
  bumpLedger(pubkey: string, asset: Asset, cents: number): Promise<void>;

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
  /** Unstaked by Sprouts, not delivered, not cancelled, not skipped: the basket. */
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
