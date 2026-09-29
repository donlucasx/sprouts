import type { Repo, NewPlanting, NewWithdrawal } from "./repo";
import type * as T from "./types";
import type { Asset } from "@/domain/allocation";
import { DEFAULT_RULES } from "@/domain/roundup";

let seq = 0;
const id = () => `mem-${++seq}`;
const DAY_MS = 86_400_000;

/** In-process repo for tests and the cron unit tests. Same contract as the Supabase one, nothing persisted. */
export class MemoryRepo implements Repo {
  users = new Map<string, T.UserRow>();
  rules = new Map<string, T.RulesRow>();
  wallets = new Map<string, T.WalletRow>();
  swaps = new Map<string, T.SwapRow>();
  plantings = new Map<string, T.PlantingRow>();
  legs: T.PlantingLegRow[] = [];
  events: T.EventRow[] = [];
  nonces = new Map<string, { pubkey: string | null; expiresAt: Date; used: boolean }>();
  linkCodes = new Map<string, T.LinkCodeRow>();
  withdrawals = new Map<string, T.WithdrawalRow>();
  adjustments: T.StakeAdjustmentRow[] = [];
  sessions = new Map<string, T.SessionRow>();

  async upsertUser(u: { seedVaultPubkey: string; sgtMint: string; skrName: string | null }) {
    for (const other of this.users.values()) {
      if (other.sgtMint === u.sgtMint && other.seedVaultPubkey !== u.seedVaultPubkey) throw new Error("This Seeker is already registered.");
    }
    const existing = this.users.get(u.seedVaultPubkey);
    const row: T.UserRow = {
      seedVaultPubkey: u.seedVaultPubkey, sgtMint: u.sgtMint, skrName: u.skrName, proUntil: existing?.proUntil ?? null, createdAt: existing?.createdAt ?? new Date(),
      wateredAt: existing?.wateredAt ?? null, joinedShares: existing?.joinedShares ?? 0n, joinedSharePrice: existing?.joinedSharePrice ?? 0n,
    };
    this.users.set(row.seedVaultPubkey, row);
    return { row, created: !existing };
  }

  async getUser(pubkey: string) {
    return this.users.get(pubkey) ?? null;
  }

  async listUsers() {
    return [...this.users.values()];
  }

  async setJoinedPosition(userPubkey: string, p: { shares: bigint; sharePrice: bigint }) {
    const u = this.users.get(userPubkey);
    if (!u) return;
    u.joinedShares = p.shares;
    u.joinedSharePrice = p.sharePrice;
  }

  async setWateredAt(userPubkey: string, at: Date) {
    const u = this.users.get(userPubkey);
    if (u) u.wateredAt = at;
  }

  async keepalive() {}

  async getRules(userPubkey: string): Promise<T.RulesRow> {
    // Mirrors the schema: rules.user_pubkey references users, so a first read for an unknown user fails (as it did in production).
    if (!this.users.has(userPubkey) && !this.rules.has(userPubkey)) throw new Error(`insert or update on table "rules" violates foreign key constraint "rules_user_pubkey_fkey" (${userPubkey})`);
    let r = this.rules.get(userPubkey);
    if (!r) {
      r = { ...DEFAULT_RULES, allocation: { ...DEFAULT_RULES.allocation }, userPubkey, updatedAt: new Date() };
      this.rules.set(userPubkey, r);
    }
    return r;
  }

  async saveRules(userPubkey: string, patch: Partial<Omit<T.RulesRow, "userPubkey" | "updatedAt">>): Promise<T.RulesRow> {
    const current = await this.getRules(userPubkey);
    const next: T.RulesRow = { ...current, ...patch, allocation: { ...(patch.allocation ?? current.allocation) }, userPubkey, updatedAt: new Date() };
    this.rules.set(userPubkey, next);
    return next;
  }

  async addWallet(w: { pubkey: string; userPubkey: string; delegationPda: string; dailyCapCents: number; webhookAdded?: boolean }): Promise<T.WalletRow> {
    // An upsert, like Supabase: a re-link resets the delegation, cap, status and webhook flag and keeps the ledger (review I3).
    const { webhookAdded = false, ...rest } = w;
    const existing = this.wallets.get(w.pubkey);
    const row: T.WalletRow = {
      ...rest, status: "active", webhookAdded,
      ledgerSkrCents: existing?.ledgerSkrCents ?? 0, ledgerStoreCents: existing?.ledgerStoreCents ?? 0, createdAt: existing?.createdAt ?? new Date(),
    };
    this.wallets.set(w.pubkey, row);
    return row;
  }

  async getWallet(pubkey: string) {
    return this.wallets.get(pubkey) ?? null;
  }

  async listActiveWallets() {
    return [...this.wallets.values()].filter((w) => w.status === "active");
  }

  async listPausedWallets() {
    return [...this.wallets.values()].filter((w) => w.status === "paused");
  }

  async listWalletsOf(userPubkey: string) {
    return [...this.wallets.values()].filter((w) => w.userPubkey === userPubkey);
  }

  async setWalletStatus(pubkey: string, status: T.WalletStatus) {
    const w = this.wallets.get(pubkey);
    if (w) w.status = status;
  }

  async bumpLedger(pubkey: string, asset: Asset, cents: number) {
    const w = this.wallets.get(pubkey);
    if (!w) return;
    if (asset === "SKR") w.ledgerSkrCents += cents;
    else w.ledgerStoreCents += cents;
  }

  async insertSwap(s: Omit<T.SwapRow, "plantingId" | "createdAt">): Promise<boolean> {
    if (this.swaps.has(s.signature)) return false;
    this.swaps.set(s.signature, { ...s, plantingId: null, createdAt: new Date() });
    return true;
  }

  async unplantedSwaps(walletPubkey: string) {
    return [...this.swaps.values()].filter((s) => s.walletPubkey === walletPubkey && s.plantingId === null).sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  async listSwaps(userPubkey: string, limit: number) {
    const mine = new Set((await this.listWalletsOf(userPubkey)).map((w) => w.pubkey));
    return [...this.swaps.values()].filter((s) => mine.has(s.walletPubkey)).sort((a, b) => b.ts.getTime() - a.ts.getTime()).slice(0, limit);
  }

  async claimSwaps(signatures: string[], plantingId: string) {
    // No await between the check and the set: the claim is atomic here, as the conditional UPDATE is on Supabase.
    let claimed = 0;
    for (const sig of signatures) {
      const s = this.swaps.get(sig);
      if (s && s.plantingId === null) {
        s.plantingId = plantingId;
        claimed++;
      }
    }
    return claimed;
  }

  async releaseSwaps(plantingId: string) {
    for (const s of this.swaps.values()) if (s.plantingId === plantingId) s.plantingId = null;
  }

  async listSentPlantings(olderThan: Date) {
    return [...this.plantings.values()].filter((p) => p.status === "sent" && p.ts.getTime() < olderThan.getTime());
  }

  async listPlantings(userPubkey: string, limit: number) {
    return [...this.plantings.values()].filter((p) => p.userPubkey === userPubkey).sort((a, b) => b.ts.getTime() - a.ts.getTime()).slice(0, limit);
  }

  async listConfirmedPlantings(userPubkey: string) {
    return [...this.plantings.values()].filter((p) => p.userPubkey === userPubkey && p.status === "confirmed").sort((a, b) => a.ts.getTime() - b.ts.getTime());
  }

  async plantingLegs(plantingId: string) {
    return this.legs.filter((l) => l.plantingId === plantingId);
  }

  async insertPlanting(p: NewPlanting, legs: Omit<T.PlantingLegRow, "plantingId">[]): Promise<T.PlantingRow> {
    const { sharesBefore = null, ...rest } = p;
    const row: T.PlantingRow = { ...rest, id: id(), ts: new Date(), sharesBefore, sharesAfter: null, sharesMinted: null };
    this.plantings.set(row.id, row);
    for (const leg of legs) this.legs.push({ ...leg, plantingId: row.id });
    return row;
  }

  async setPlantingStatus(plantingId: string, status: T.PlantingStatus, signature?: string) {
    const p = this.plantings.get(plantingId);
    if (!p) return;
    p.status = status;
    if (signature) p.signature = signature;
  }

  async setPlantingShares(plantingId: string, s: { before: bigint | null; after: bigint; minted: bigint }) {
    const p = this.plantings.get(plantingId);
    if (!p) return;
    p.sharesBefore = s.before;
    p.sharesAfter = s.after;
    p.sharesMinted = s.minted;
  }

  async addStakeAdjustment(a: Omit<T.StakeAdjustmentRow, "id" | "ts">) {
    this.adjustments.push({ ...a, id: id(), ts: new Date() });
  }

  async listStakeAdjustments(userPubkey: string) {
    return this.adjustments.filter((a) => a.userPubkey === userPubkey);
  }

  async addEvent(e: Omit<T.EventRow, "id" | "ts">) {
    this.events.push({ ...e, id: this.events.length + 1, ts: new Date() });
  }

  async putNonce(n: { nonce: string; expiresAt: Date }) {
    this.nonces.set(n.nonce, { pubkey: null, expiresAt: n.expiresAt, used: false });
  }

  async useNonce(nonce: string, pubkey: string): Promise<boolean> {
    const n = this.nonces.get(nonce);
    if (!n || n.used || n.expiresAt.getTime() <= Date.now()) return false;
    n.used = true;
    n.pubkey = pubkey;
    return true;
  }

  async putLinkCode(c: { code: string; userPubkey: string; expiresAt: Date; nonce: bigint }) {
    this.linkCodes.set(c.code, { ...c, walletPubkey: null, delegationPda: null, used: false });
  }

  async peekLinkCode(code: string): Promise<T.LinkCodeRow | null> {
    const c = this.linkCodes.get(code);
    if (!c || c.used || c.expiresAt.getTime() <= Date.now()) return null;
    return { ...c };
  }

  async bindLinkCode(code: string, walletPubkey: string, delegationPda: string) {
    const c = this.linkCodes.get(code);
    if (!c || c.walletPubkey) return; // the first wallet keeps the code (review M6)
    c.walletPubkey = walletPubkey;
    c.delegationPda = delegationPda;
  }

  async takeLinkCode(code: string, walletPubkey: string): Promise<T.LinkCodeRow | null> {
    const c = await this.peekLinkCode(code);
    if (!c || c.walletPubkey !== walletPubkey) return null;
    this.linkCodes.get(code)!.used = true;
    return c;
  }

  async insertWithdrawal(w: NewWithdrawal): Promise<T.WithdrawalRow> {
    const row: T.WithdrawalRow = { ...w, id: id(), unstakeTs: new Date(), withdrawSignature: null, cancelSignature: null, amountOutRaw: null, rewardDeltaRaw: null, skippedAt: null };
    this.withdrawals.set(row.id, row);
    return row;
  }

  /** Open rows: not delivered, not cancelled, not skipped. */
  private open() {
    return [...this.withdrawals.values()].filter((w) => w.withdrawSignature === null && w.cancelSignature === null && w.skippedAt === null);
  }

  async pendingWithdrawal(userPubkey: string) {
    return this.open().filter((w) => w.userPubkey === userPubkey && w.source === "sprouts").sort((a, b) => b.unstakeTs.getTime() - a.unstakeTs.getTime())[0] ?? null;
  }

  async listWithdrawals(userPubkey: string, limit: number) {
    return [...this.withdrawals.values()].filter((w) => w.userPubkey === userPubkey).sort((a, b) => b.unstakeTs.getTime() - a.unstakeTs.getTime()).slice(0, limit);
  }

  async dueWithdrawals(before: Date) {
    return this.open().filter((w) => w.unstakeTs.getTime() <= before.getTime());
  }

  async setWithdrawalDone(withdrawalId: string, signature: string, amountOutRaw: bigint) {
    const w = this.withdrawals.get(withdrawalId);
    if (!w) return;
    w.withdrawSignature = signature;
    w.amountOutRaw = amountOutRaw;
  }

  async setWithdrawalCancelled(withdrawalId: string, signature: string) {
    const w = this.withdrawals.get(withdrawalId);
    if (w) w.cancelSignature = signature;
  }

  async setWithdrawalSkipped(withdrawalId: string) {
    const w = this.withdrawals.get(withdrawalId);
    if (w) w.skippedAt = new Date();
  }

  async putSession(s: { tokenHash: string; userPubkey: string; device: string; expiresAt: Date }) {
    const now = new Date();
    for (const other of this.sessions.values()) {
      if (other.userPubkey === s.userPubkey && other.device === s.device && other.revokedAt === null) other.revokedAt = now;
    }
    this.sessions.set(s.tokenHash, { ...s, createdAt: now, revokedAt: null });
  }

  async getSession(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    return s ? { ...s } : null;
  }

  async revokeSession(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    if (s && s.revokedAt === null) s.revokedAt = new Date();
  }

  async revokeAllSessions(userPubkey: string) {
    const now = new Date();
    for (const s of this.sessions.values()) if (s.userPubkey === userPubkey && s.revokedAt === null) s.revokedAt = now;
  }

  async cleanupExpired() {
    const cutoff = Date.now() - DAY_MS;
    for (const [k, n] of this.nonces) if (n.expiresAt.getTime() < cutoff) this.nonces.delete(k);
    for (const [k, c] of this.linkCodes) if (c.expiresAt.getTime() < cutoff) this.linkCodes.delete(k);
    for (const [k, s] of this.sessions) if (s.expiresAt.getTime() < cutoff || (s.revokedAt && s.revokedAt.getTime() < cutoff)) this.sessions.delete(k);
  }
}
