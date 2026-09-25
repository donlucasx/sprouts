import type * as T from "./types";
import type { Asset } from "@/domain/allocation";

/** Everything the routes and the cron need from the database. One in-memory implementation for tests, one on Supabase. */
export interface Repo {
  upsertUser(u: { seedVaultPubkey: string; sgtMint: string; skrName: string | null }): Promise<T.UserRow>;
  getUser(pubkey: string): Promise<T.UserRow | null>;

  /** Creates the defaults when the user has no rules yet. */
  getRules(userPubkey: string): Promise<T.RulesRow>;
  saveRules(userPubkey: string, r: Partial<Omit<T.RulesRow, "userPubkey" | "updatedAt">>): Promise<T.RulesRow>;

  addWallet(w: { pubkey: string; userPubkey: string; delegationPda: string; dailyCapCents: number }): Promise<T.WalletRow>;
  getWallet(pubkey: string): Promise<T.WalletRow | null>;
  listActiveWallets(): Promise<T.WalletRow[]>;
  listPausedWallets(): Promise<T.WalletRow[]>;
  setWalletStatus(pubkey: string, status: T.WalletStatus): Promise<void>;
  bumpLedger(pubkey: string, asset: Asset, cents: number): Promise<void>;

  /** False when the signature is already booked. */
  insertSwap(s: Omit<T.SwapRow, "plantingId" | "createdAt">): Promise<boolean>;
  unplantedSwaps(walletPubkey: string): Promise<T.SwapRow[]>;
  markPlanted(signatures: string[], plantingId: string): Promise<void>;

  insertPlanting(p: Omit<T.PlantingRow, "id" | "ts">, legs: Omit<T.PlantingLegRow, "plantingId">[]): Promise<T.PlantingRow>;
  setPlantingStatus(id: string, status: T.PlantingStatus, signature?: string): Promise<void>;

  addEvent(e: Omit<T.EventRow, "id" | "ts">): Promise<void>;

  putNonce(n: { nonce: string; expiresAt: Date }): Promise<void>;
  /** One atomic step; false when unknown, used or expired. */
  useNonce(nonce: string, pubkey: string): Promise<boolean>;

  putLinkCode(c: { code: string; userPubkey: string; expiresAt: Date; nonce: bigint }): Promise<void>;
  /** Unexpired and unused, or null. */
  peekLinkCode(code: string): Promise<T.LinkCodeRow | null>;
  /** The first wallet that fetches the transaction owns the code. */
  bindLinkCode(code: string, walletPubkey: string, delegationPda: string): Promise<void>;
  /** Consumes the code; only after the chain confirmed the delegation. */
  takeLinkCode(code: string): Promise<T.LinkCodeRow | null>;

  dueWithdrawals(before: Date): Promise<T.WithdrawalRow[]>;
  setWithdrawalDone(id: string, signature: string, amountOutRaw: bigint): Promise<void>;
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
