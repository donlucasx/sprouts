import type { Repo } from "./repo";
import type * as T from "./types";
import type { Asset } from "@/domain/allocation";
import { DEFAULT_RULES } from "@/domain/roundup";

let seq = 0;
const id = () => `mem-${++seq}`;

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

  async upsertUser(u: { seedVaultPubkey: string; sgtMint: string; skrName: string | null }): Promise<T.UserRow> {
    for (const other of this.users.values()) {
      if (other.sgtMint === u.sgtMint && other.seedVaultPubkey !== u.seedVaultPubkey) throw new Error("This Seeker is already registered.");
    }
    const existing = this.users.get(u.seedVaultPubkey);
    const row: T.UserRow = { seedVaultPubkey: u.seedVaultPubkey, sgtMint: u.sgtMint, skrName: u.skrName, proUntil: existing?.proUntil ?? null, createdAt: existing?.createdAt ?? new Date() };
    this.users.set(row.seedVaultPubkey, row);
    return row;
  }

  async getUser(pubkey: string) {
    return this.users.get(pubkey) ?? null;
  }

  async getRules(userPubkey: string): Promise<T.RulesRow> {
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

  async addWallet(w: { pubkey: string; userPubkey: string; delegationPda: string; dailyCapCents: number }): Promise<T.WalletRow> {
    const row: T.WalletRow = { ...w, status: "active", webhookAdded: false, ledgerSkrCents: 0, ledgerStoreCents: 0, createdAt: new Date() };
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

  async markPlanted(signatures: string[], plantingId: string) {
    for (const sig of signatures) {
      const s = this.swaps.get(sig);
      if (s) s.plantingId = plantingId;
    }
  }

  async insertPlanting(p: Omit<T.PlantingRow, "id" | "ts">, legs: Omit<T.PlantingLegRow, "plantingId">[]): Promise<T.PlantingRow> {
    const row: T.PlantingRow = { ...p, id: id(), ts: new Date() };
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
    if (!c) return;
    c.walletPubkey = walletPubkey;
    c.delegationPda = delegationPda;
  }

  async takeLinkCode(code: string): Promise<T.LinkCodeRow | null> {
    const c = await this.peekLinkCode(code);
    if (!c) return null;
    this.linkCodes.get(code)!.used = true;
    return c;
  }

  async dueWithdrawals(before: Date) {
    return [...this.withdrawals.values()].filter((w) => w.withdrawSignature === null && w.unstakeTs.getTime() <= before.getTime());
  }

  async setWithdrawalDone(withdrawalId: string, signature: string, amountOutRaw: bigint) {
    const w = this.withdrawals.get(withdrawalId);
    if (!w) return;
    w.withdrawSignature = signature;
    w.amountOutRaw = amountOutRaw;
  }
}
