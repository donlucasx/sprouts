import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Repo } from "./repo";
import type * as T from "./types";
import type { Asset } from "@/domain/allocation";
import { DEFAULT_RULES } from "@/domain/roundup";
import { config } from "@/lib/config";

type Row = Record<string, unknown>;
const UNIQUE_VIOLATION = "23505";

/** Postgres on Supabase, reached only from the server with the service key. Columns are snake_case; the app sees camelCase. */
export class SupabaseRepo implements Repo {
  private db: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.db = client ?? createClient(config().supabaseUrl, config().supabaseServiceKey, { auth: { persistSession: false } });
  }

  private async one<TOut>(q: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>, map: (r: Row) => TOut): Promise<TOut> {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return map(data as Row);
  }

  private async many<TOut>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, map: (r: Row) => TOut): Promise<TOut[]> {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return ((data as Row[]) ?? []).map(map);
  }

  /** A returning key keeps its registered mint (one account per device stays stable); only the name refreshes. A mint held by another key is refused. */
  async upsertUser(u: { seedVaultPubkey: string; sgtMint: string; skrName: string | null }) {
    const existing = await this.getUser(u.seedVaultPubkey);
    if (existing) {
      const { error } = await this.db.from("users").update({ skr_name: u.skrName }).eq("seed_vault_pubkey", u.seedVaultPubkey);
      if (error) throw new Error(error.message);
      return { ...existing, skrName: u.skrName };
    }
    const { data, error } = await this.db.from("users").insert({ seed_vault_pubkey: u.seedVaultPubkey, sgt_mint: u.sgtMint, skr_name: u.skrName }).select().single();
    if (error) throw new Error(error.code === UNIQUE_VIOLATION ? "This Seeker is already registered." : error.message);
    return userRow(data as Row);
  }

  async getUser(pubkey: string) {
    const { data } = await this.db.from("users").select().eq("seed_vault_pubkey", pubkey).maybeSingle();
    return data ? userRow(data as Row) : null;
  }

  async getRules(userPubkey: string) {
    const { data } = await this.db.from("rules").select().eq("user_pubkey", userPubkey).maybeSingle();
    if (data) return rulesRow(data as Row);
    // Two first reads at once: the second insert is ignored and both read the same defaults row.
    const { error } = await this.db.from("rules").upsert({ user_pubkey: userPubkey }, { onConflict: "user_pubkey", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return this.one(this.db.from("rules").select().eq("user_pubkey", userPubkey).single(), rulesRow);
  }

  async saveRules(userPubkey: string, patch: Partial<Omit<T.RulesRow, "userPubkey" | "updatedAt">>) {
    await this.getRules(userPubkey);
    const update: Row = { updated_at: new Date().toISOString() };
    if (patch.roundupOn !== undefined) update.roundup_on = patch.roundupOn;
    if (patch.roundupToCents !== undefined) update.roundup_to_cents = patch.roundupToCents;
    if (patch.pctOn !== undefined) update.pct_on = patch.pctOn;
    if (patch.pctBps !== undefined) update.pct_bps = patch.pctBps;
    if (patch.pctThresholdCents !== undefined) update.pct_threshold_cents = patch.pctThresholdCents;
    if (patch.plantThresholdCents !== undefined) update.plant_threshold_cents = patch.plantThresholdCents;
    if (patch.plantMaxDays !== undefined) update.plant_max_days = patch.plantMaxDays;
    if (patch.dailyCapCents !== undefined) update.daily_cap_cents = patch.dailyCapCents;
    if (patch.allocation !== undefined) update.allocation = patch.allocation;
    return this.one(this.db.from("rules").update(update).eq("user_pubkey", userPubkey).select().single(), rulesRow);
  }

  async addWallet(w: { pubkey: string; userPubkey: string; delegationPda: string; dailyCapCents: number }) {
    return this.one(this.db.from("wallets").insert({ pubkey: w.pubkey, user_pubkey: w.userPubkey, delegation_pda: w.delegationPda, daily_cap_cents: w.dailyCapCents }).select().single(), walletRow);
  }

  async getWallet(pubkey: string) {
    const { data } = await this.db.from("wallets").select().eq("pubkey", pubkey).maybeSingle();
    return data ? walletRow(data as Row) : null;
  }

  async listActiveWallets() {
    return this.many(this.db.from("wallets").select().eq("status", "active"), walletRow);
  }

  async listPausedWallets() {
    return this.many(this.db.from("wallets").select().eq("status", "paused"), walletRow);
  }

  async setWalletStatus(pubkey: string, status: T.WalletStatus) {
    const { error } = await this.db.from("wallets").update({ status }).eq("pubkey", pubkey);
    if (error) throw new Error(error.message);
  }

  /** One statement on the server (bump_ledger), so concurrent plantings never lose an increment. */
  async bumpLedger(pubkey: string, asset: Asset, cents: number) {
    const { error } = await this.db.rpc("bump_ledger", { p_pubkey: pubkey, p_asset: asset, p_cents: cents });
    if (error) throw new Error(error.message);
  }

  async insertSwap(s: Omit<T.SwapRow, "plantingId" | "createdAt">) {
    const { error } = await this.db.from("swaps").insert({
      signature: s.signature, wallet_pubkey: s.walletPubkey, ts: s.ts.toISOString(), in_mint: s.inMint, in_amount: s.inAmount,
      out_mint: s.outMint, out_amount: s.outAmount, usd_size_cents: s.usdSizeCents, class: s.class, roundup_cents: s.roundupCents,
    });
    if (error?.code === UNIQUE_VIOLATION) return false;
    if (error) throw new Error(error.message);
    return true;
  }

  async unplantedSwaps(walletPubkey: string) {
    return this.many(this.db.from("swaps").select().eq("wallet_pubkey", walletPubkey).is("planting_id", null).order("ts"), swapRow);
  }

  async markPlanted(signatures: string[], plantingId: string) {
    if (!signatures.length) return;
    const { error } = await this.db.from("swaps").update({ planting_id: plantingId }).in("signature", signatures);
    if (error) throw new Error(error.message);
  }

  async insertPlanting(p: Omit<T.PlantingRow, "id" | "ts">, legs: Omit<T.PlantingLegRow, "plantingId">[]) {
    const row = await this.one(this.db.from("plantings").insert({
      user_pubkey: p.userPubkey, wallet_pubkey: p.walletPubkey, signature: p.signature, usdc_pulled_cents: p.usdcPulledCents,
      network_fee_cents: p.networkFeeCents, status: p.status, ai_line: p.aiLine,
    }).select().single(), plantingRow);
    if (legs.length) {
      const { error } = await this.db.from("planting_legs").insert(legs.map((l) => ({
        planting_id: row.id, asset: l.asset, usdc_in_cents: l.usdcInCents, amount_out_raw: l.amountOutRaw.toString(), staked: l.staked, fee_amount_raw: l.feeAmountRaw.toString(),
      })));
      if (error) throw new Error(error.message);
    }
    return row;
  }

  async setPlantingStatus(plantingId: string, status: T.PlantingStatus, signature?: string) {
    const { error } = await this.db.from("plantings").update({ status, ...(signature ? { signature } : {}) }).eq("id", plantingId);
    if (error) throw new Error(error.message);
  }

  async addEvent(e: Omit<T.EventRow, "id" | "ts">) {
    const { error } = await this.db.from("events").insert({ user_pubkey: e.userPubkey, wallet_pubkey: e.walletPubkey, kind: e.kind, detail: e.detail ?? null });
    if (error) throw new Error(error.message);
  }

  async putNonce(n: { nonce: string; expiresAt: Date }) {
    const { error } = await this.db.from("nonces").insert({ nonce: n.nonce, expires_at: n.expiresAt.toISOString() });
    if (error) throw new Error(error.message);
  }

  /** One statement on the server (the use_nonce function), never check-then-set. */
  async useNonce(nonce: string, pubkey: string) {
    const { data, error } = await this.db.rpc("use_nonce", { p_nonce: nonce, p_pubkey: pubkey });
    if (error) throw new Error(error.message);
    return data === true;
  }

  async putLinkCode(c: { code: string; userPubkey: string; expiresAt: Date; nonce: bigint }) {
    const { error } = await this.db.from("link_codes").insert({ code: c.code, user_pubkey: c.userPubkey, expires_at: c.expiresAt.toISOString(), nonce: c.nonce.toString() });
    if (error) throw new Error(error.message);
  }

  async peekLinkCode(code: string) {
    const { data } = await this.db.from("link_codes").select().eq("code", code).eq("used", false).gt("expires_at", new Date().toISOString()).maybeSingle();
    return data ? linkCodeRow(data as Row) : null;
  }

  async bindLinkCode(code: string, walletPubkey: string, delegationPda: string) {
    const { error } = await this.db.from("link_codes").update({ wallet_pubkey: walletPubkey, delegation_pda: delegationPda }).eq("code", code);
    if (error) throw new Error(error.message);
  }

  /** Consumes the code only for the wallet it was bound to, in one statement. */
  async takeLinkCode(code: string, walletPubkey: string) {
    const { data, error } = await this.db.from("link_codes").update({ used: true }).eq("code", code).eq("used", false).eq("wallet_pubkey", walletPubkey).gt("expires_at", new Date().toISOString()).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data ? linkCodeRow(data as Row) : null;
  }

  async dueWithdrawals(before: Date) {
    return this.many(this.db.from("withdrawals").select().is("withdraw_signature", null).lte("unstake_ts", before.toISOString()), withdrawalRow);
  }

  async setWithdrawalDone(withdrawalId: string, signature: string, amountOutRaw: bigint) {
    const { error } = await this.db.from("withdrawals").update({ withdraw_signature: signature, amount_out_raw: amountOutRaw.toString() }).eq("id", withdrawalId);
    if (error) throw new Error(error.message);
  }
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const date = (v: unknown) => new Date(String(v));
const big = (v: unknown) => (v === null || v === undefined ? null : BigInt(String(v)));

function userRow(r: Row): T.UserRow {
  return { seedVaultPubkey: String(r.seed_vault_pubkey), sgtMint: String(r.sgt_mint), skrName: str(r.skr_name), proUntil: r.pro_until ? date(r.pro_until) : null, createdAt: date(r.created_at) };
}

function rulesRow(r: Row): T.RulesRow {
  const allocation = (r.allocation as { SKR?: number; stORE?: number } | null) ?? DEFAULT_RULES.allocation;
  return {
    userPubkey: String(r.user_pubkey), roundupOn: Boolean(r.roundup_on), roundupToCents: Number(r.roundup_to_cents), pctOn: Boolean(r.pct_on), pctBps: Number(r.pct_bps),
    pctThresholdCents: Number(r.pct_threshold_cents), plantThresholdCents: Number(r.plant_threshold_cents), plantMaxDays: Number(r.plant_max_days),
    dailyCapCents: Number(r.daily_cap_cents), allocation: { SKR: Number(allocation.SKR ?? 100), stORE: Number(allocation.stORE ?? 0) }, updatedAt: date(r.updated_at),
  };
}

function walletRow(r: Row): T.WalletRow {
  return {
    pubkey: String(r.pubkey), userPubkey: String(r.user_pubkey), delegationPda: String(r.delegation_pda), dailyCapCents: Number(r.daily_cap_cents),
    status: r.status as T.WalletStatus, webhookAdded: Boolean(r.webhook_added), ledgerSkrCents: Number(r.ledger_skr_cents), ledgerStoreCents: Number(r.ledger_store_cents), createdAt: date(r.created_at),
  };
}

function swapRow(r: Row): T.SwapRow {
  return {
    signature: String(r.signature), walletPubkey: String(r.wallet_pubkey), ts: date(r.ts), inMint: String(r.in_mint), inAmount: Number(r.in_amount), outMint: String(r.out_mint),
    outAmount: Number(r.out_amount), usdSizeCents: r.usd_size_cents === null ? null : Number(r.usd_size_cents), class: r.class as T.SwapRow["class"],
    roundupCents: Number(r.roundup_cents), plantingId: str(r.planting_id), createdAt: date(r.created_at),
  };
}

function plantingRow(r: Row): T.PlantingRow {
  return {
    id: String(r.id), userPubkey: String(r.user_pubkey), walletPubkey: String(r.wallet_pubkey), ts: date(r.ts), signature: str(r.signature),
    usdcPulledCents: Number(r.usdc_pulled_cents), networkFeeCents: Number(r.network_fee_cents), status: r.status as T.PlantingStatus, aiLine: str(r.ai_line),
  };
}

function linkCodeRow(r: Row): T.LinkCodeRow {
  return { code: String(r.code), userPubkey: String(r.user_pubkey), expiresAt: date(r.expires_at), nonce: BigInt(String(r.nonce)), walletPubkey: str(r.wallet_pubkey), delegationPda: str(r.delegation_pda), used: Boolean(r.used) };
}

function withdrawalRow(r: Row): T.WithdrawalRow {
  return {
    id: String(r.id), userPubkey: String(r.user_pubkey), asset: r.asset as Asset, unstakeTs: date(r.unstake_ts), unstakeSignature: str(r.unstake_signature),
    withdrawSignature: str(r.withdraw_signature), amountOutRaw: big(r.amount_out_raw), rewardDeltaRaw: big(r.reward_delta_raw),
  };
}
