import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Repo, NewPlanting, NewWithdrawal, NewWatcherCall } from "./repo";
import { checkLegVenues } from "./repo";
import type * as T from "./types";
import type { Asset, LiveAsset, LendAsset, Stop } from "@/domain/coins";
import type { Venue } from "@/domain/venues";
import { toSplit } from "@/domain/coins";
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
      return { row: { ...existing, skrName: u.skrName }, created: false };
    }
    const { data, error } = await this.db.from("users").insert({ seed_vault_pubkey: u.seedVaultPubkey, sgt_mint: u.sgtMint, skr_name: u.skrName }).select().single();
    if (error) throw new Error(error.code === UNIQUE_VIOLATION ? "This phone is already registered." : error.message);
    return { row: userRow(data as Row), created: true };
  }

  async getUser(pubkey: string) {
    const { data } = await this.db.from("users").select().eq("seed_vault_pubkey", pubkey).maybeSingle();
    return data ? userRow(data as Row) : null;
  }

  async listUsers() {
    return this.many(this.db.from("users").select().order("created_at"), userRow);
  }

  async setJoinedPosition(userPubkey: string, p: { shares: bigint; sharePrice: bigint }) {
    const { error } = await this.db.from("users").update({ joined_shares: p.shares.toString(), joined_share_price: p.sharePrice.toString() }).eq("seed_vault_pubkey", userPubkey);
    if (error) throw new Error(error.message);
  }

  async setWateredAt(userPubkey: string, at: Date) {
    const { error } = await this.db.from("users").update({ watered_at: at.toISOString() }).eq("seed_vault_pubkey", userPubkey);
    if (error) throw new Error(error.message);
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
    if (patch.managed !== undefined) update.managed = patch.managed;
    if (patch.stop !== undefined) update.stop = patch.stop;
    if (patch.pins !== undefined) update.pins = patch.pins;
    if (patch.prevAllocation !== undefined) update.prev_allocation = patch.prevAllocation;
    if (patch.allocationDay !== undefined) update.allocation_day = patch.allocationDay;
    if (patch.pinsByUndo !== undefined) update.pins_by_undo = patch.pinsByUndo;
    return this.one(this.db.from("rules").update(update).eq("user_pubkey", userPubkey).select().single(), rulesRow);
  }

  async listManagedRules() {
    return this.many(this.db.from("rules").select().eq("managed", true), rulesRow);
  }

  /** An upsert on the wallet: a re-link resets the delegation, cap, status and webhook flag; the ledger columns are untouched. */
  async addWallet(w: { pubkey: string; userPubkey: string; delegationPda: string; dailyCapCents: number; webhookAdded?: boolean; linkModel?: T.LinkModel }) {
    return this.one(this.db.from("wallets").upsert(
      { pubkey: w.pubkey, user_pubkey: w.userPubkey, delegation_pda: w.delegationPda, daily_cap_cents: w.dailyCapCents, status: "active", webhook_added: w.webhookAdded ?? false, ...(w.linkModel ? { link_model: w.linkModel } : {}) },
      { onConflict: "pubkey" },
    ).select().single(), walletRow);
  }

  async getWallet(pubkey: string) {
    const { data } = await this.db.from("wallets").select().eq("pubkey", pubkey).maybeSingle();
    return data ? walletRow(data as Row) : null;
  }

  async keepalive() {
    const { error } = await this.db.from("users").select("*", { head: true, count: "exact" });
    if (error) throw new Error(error.message);
  }

  async listActiveWallets() {
    return this.many(this.db.from("wallets").select().eq("status", "active"), walletRow);
  }

  async listPausedWallets() {
    return this.many(this.db.from("wallets").select().eq("status", "paused"), walletRow);
  }

  async listWalletsOf(userPubkey: string) {
    return this.many(this.db.from("wallets").select().eq("user_pubkey", userPubkey).order("created_at"), walletRow);
  }

  async setWalletStatus(pubkey: string, status: T.WalletStatus) {
    const { error } = await this.db.from("wallets").update({ status }).eq("pubkey", pubkey);
    if (error) throw new Error(error.message);
  }

  /** One statement on the server (bump_ledger), so concurrent plantings never lose an increment. */
  async bumpLedger(pubkey: string, asset: LiveAsset, cents: number) {
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

  async listSwaps(userPubkey: string, limit: number) {
    const wallets = (await this.listWalletsOf(userPubkey)).map((w) => w.pubkey);
    if (!wallets.length) return [];
    return this.many(this.db.from("swaps").select().in("wallet_pubkey", wallets).order("ts", { ascending: false }).limit(limit), swapRow);
  }

  /** One conditional UPDATE: only swaps nobody has claimed; the returned rows say how many this planting got. */
  async claimSwaps(signatures: string[], plantingId: string) {
    if (!signatures.length) return 0;
    const { data, error } = await this.db.from("swaps").update({ planting_id: plantingId }).in("signature", signatures).is("planting_id", null).select("signature");
    if (error) throw new Error(error.message);
    return (data ?? []).length;
  }

  async releaseSwaps(plantingId: string) {
    const { error } = await this.db.from("swaps").update({ planting_id: null }).eq("planting_id", plantingId);
    if (error) throw new Error(error.message);
  }

  /** One statement on the server (skr_credit, 0007): the sums stay exact in numeric, never round-tripped through JS numbers. */
  async skrCreditRaw(userPubkey: string) {
    const { data, error } = await this.db.rpc("skr_credit", { p_user: userPubkey });
    if (error) throw new Error(error.message);
    return BigInt(String(data ?? 0));
  }

  /** Written only while null: a second booking of the same planting never overwrites it. */
  async setPlantingSkrSurplus(plantingId: string, surplusRaw: bigint) {
    const { error } = await this.db.from("plantings").update({ skr_surplus_raw: surplusRaw.toString() }).eq("id", plantingId).is("skr_surplus_raw", null);
    if (error) throw new Error(error.message);
  }

  async listSentPlantings(olderThan: Date) {
    return this.many(this.db.from("plantings").select().eq("status", "sent").lt("ts", olderThan.toISOString()), plantingRow);
  }

  async plantingLegs(plantingId: string) {
    return this.many(this.db.from("planting_legs").select().eq("planting_id", plantingId), legRow);
  }

  async insertPlanting(p: NewPlanting, legs: Omit<T.PlantingLegRow, "plantingId">[]) {
    checkLegVenues(legs);
    const row = await this.one(this.db.from("plantings").insert({
      user_pubkey: p.userPubkey, wallet_pubkey: p.walletPubkey, signature: p.signature, usdc_pulled_cents: p.usdcPulledCents,
      network_fee_cents: p.networkFeeCents, status: p.status, ai_line: p.aiLine, shares_before: p.sharesBefore == null ? null : p.sharesBefore.toString(),
      ...(p.ts ? { ts: p.ts.toISOString() } : {}),
      // R207 #2 (0007): sent only when there is a carry, so a planting without one never depends on the column.
      ...(p.skrCarryInRaw ? { skr_carry_in_raw: p.skrCarryInRaw.toString() } : {}),
    }).select().single(), plantingRow);
    try {
      if (legs.length) {
        const { error } = await this.db.from("planting_legs").insert(legs.map((l) => ({
          planting_id: row.id, asset: l.asset, usdc_in_cents: l.usdcInCents, amount_out_raw: l.amountOutRaw.toString(), staked: l.staked, fee_amount_raw: l.feeAmountRaw.toString(), fee_cents: l.feeCents, rate_at_planting: l.rateAtPlanting, venue: l.venue,
        })));
        if (error) throw new Error(error.message);
      }
      const carry = (Object.entries(p.carryIn ?? {}) as [string, bigint][]).filter(([, v]) => v > 0n);
      if (carry.length) {
        const { error } = await this.db.from("carry").insert(carry.map(([kind, v]) => ({ planting_id: row.id, user_pubkey: p.userPubkey, kind, carry_in_raw: v.toString() })));
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      // A half-written planting must not stay `sent`: `failed` gives its carry back at once and keeps it out of listSentPlantings.
      await this.setPlantingStatus(row.id, "failed").catch((e2) => console.error(`planting ${row.id}: not marked failed after an insert error (${e2 instanceof Error ? e2.message : String(e2)}); the reconciler gives it up later`));
      throw e;
    }
    return row;
  }

  async plantingCarry(plantingId: string) {
    const rows = await this.many(this.db.from("carry").select("kind, carry_in_raw").eq("planting_id", plantingId), (r) => [String(r.kind), BigInt(String(r.carry_in_raw))] as const);
    return Object.fromEntries(rows) as Partial<Record<"WSOL" | "USDC", bigint>>;
  }

  async setPlantingStatus(plantingId: string, status: T.PlantingStatus, signature?: string) {
    const { error } = await this.db.from("plantings").update({ status, ...(signature ? { signature } : {}) }).eq("id", plantingId);
    if (error) throw new Error(error.message);
  }

  async setLegAmountOut(plantingId: string, asset: LiveAsset, amountOutRaw: bigint) {
    const { error } = await this.db.from("planting_legs").update({ amount_out_raw: amountOutRaw.toString() }).eq("planting_id", plantingId).eq("asset", asset);
    if (error) throw new Error(error.message);
  }

  async setPlantingShares(plantingId: string, s: { before: bigint | null; after: bigint; minted: bigint }) {
    const { error } = await this.db.from("plantings").update({ shares_before: s.before === null ? null : s.before.toString(), shares_after: s.after.toString(), shares_minted: s.minted.toString() }).eq("id", plantingId);
    if (error) throw new Error(error.message);
  }

  async listPlantings(userPubkey: string, limit: number) {
    return this.many(this.db.from("plantings").select().eq("user_pubkey", userPubkey).order("ts", { ascending: false }).limit(limit), plantingRow);
  }

  async listConfirmedPlantings(userPubkey: string) {
    return this.many(this.db.from("plantings").select().eq("user_pubkey", userPubkey).eq("status", "confirmed").order("ts"), plantingRow);
  }

  async addStakeAdjustment(a: Omit<T.StakeAdjustmentRow, "id" | "ts">) {
    const { error } = await this.db.from("stake_adjustments").insert({ user_pubkey: a.userPubkey, kind: a.kind, shares_delta: a.sharesDelta.toString(), amount_raw: a.amountRaw.toString(), share_price: a.sharePrice.toString() });
    if (error) throw new Error(error.message);
  }

  async listStakeAdjustments(userPubkey: string) {
    return this.many(this.db.from("stake_adjustments").select().eq("user_pubkey", userPubkey).order("ts"), stakeAdjustmentRow);
  }

  async addWatcherCall(c: NewWatcherCall) {
    const { data, error } = await this.db.from("watcher_calls").insert({
      user_pubkey: c.userPubkey, kind: c.kind, input_tokens: c.inputTokens, output_tokens: c.outputTokens, cost_microcents: c.costMicrocents,
      ...(c.ts ? { ts: c.ts.toISOString() } : {}),
    }).select("id").single();
    if (error) throw new Error(error.message);
    return Number((data as Row).id);
  }
  async settleWatcherCall(id: number, u: { inputTokens: number; outputTokens: number; costMicrocents: number }) {
    const { error } = await this.db.from("watcher_calls").update({ input_tokens: u.inputTokens, output_tokens: u.outputTokens, cost_microcents: u.costMicrocents }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  async deleteWatcherCall(id: number) {
    const { error } = await this.db.from("watcher_calls").delete().eq("id", id);
    if (error) throw new Error(error.message);
  }
  /** Summed here, not in SQL: at $0.001 a call the month's cap is ten thousand rows of one column, read once per call. */
  async watcherSpendMicrocents(since: Date) {
    const { data, error } = await this.db.from("watcher_calls").select("cost_microcents").gte("ts", since.toISOString());
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).reduce((sum, r) => sum + Number(r.cost_microcents), 0);
  }
  async watcherCallsBy(userPubkey: string, since: Date) {
    const { count, error } = await this.db.from("watcher_calls").select("id", { count: "exact", head: true }).eq("user_pubkey", userPubkey).gte("ts", since.toISOString());
    if (error) throw new Error(error.message);
    return count ?? 0;
  }
  async listWatcherCalls() {
    const { data, error } = await this.db.from("watcher_calls").select().order("ts", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map(watcherCallRow);
  }

  async addEvent(e: Omit<T.EventRow, "id" | "ts">) {
    const { error } = await this.db.from("events").insert({ user_pubkey: e.userPubkey, wallet_pubkey: e.walletPubkey, kind: e.kind, detail: e.detail ?? null });
    if (error) throw new Error(error.message);
  }

  async listEvents(userPubkey: string, kinds: T.EventKind[], limit: number) {
    return this.many(this.db.from("events").select().eq("user_pubkey", userPubkey).in("kind", kinds).order("id", { ascending: false }).limit(limit), eventRow);
  }

  async putCoinDay(r: T.CoinDayRow) {
    const { error } = await this.db.from("coin_days").upsert({
      day: r.day, asset: r.asset, rate: r.rate, rate_prev: r.ratePrev, rate_prev_days: r.ratePrevDays, price_usd: r.priceUsd, liquidity_usd: r.liquidityUsd,
      price_change_24h: r.priceChange24h, tradeable: r.tradeable, last_update_epoch: r.lastUpdateEpoch, ok: r.ok,
    }, { onConflict: "day,asset" });
    if (error) throw new Error(error.message);
  }
  async getCoinDay(day: string, asset: LiveAsset) {
    const { data, error } = await this.db.from("coin_days").select().eq("day", day).eq("asset", asset).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? coinDayRow(data as Row) : null;
  }
  async listCoinDays(asset: LiveAsset, sinceDay: string) {
    return this.many(this.db.from("coin_days").select().eq("asset", asset).gte("day", sinceDay).order("day"), coinDayRow);
  }
  async putSplitDay(r: T.SplitDayRow) {
    const { error } = await this.db.from("split_days").upsert({ day: r.day, stop: r.stop, split: r.split, model_answer: r.modelAnswer, why: r.why, fallback: r.fallback, call_id: r.callId, venue_pick: r.venuePick ?? null }, { onConflict: "day,stop" });
    if (error) throw new Error(error.message);
  }
  async getSplitDay(day: string, stop: Stop) {
    const { data, error } = await this.db.from("split_days").select().eq("day", day).eq("stop", stop).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? splitDayRow(data as Row) : null;
  }
  async latestSplitDay(stop: Stop, beforeDay?: string) {
    let q = this.db.from("split_days").select().eq("stop", stop);
    if (beforeDay) q = q.lt("day", beforeDay);
    const { data, error } = await q.order("day", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? splitDayRow(data as Row) : null;
  }

  async putVenueDay(r: T.VenueDayRow) {
    const { error } = await this.db.from("venue_days").upsert({
      day: r.day, venue: r.venue, asset: r.asset, supply_pct: r.supplyPct, rewards_pct: r.rewardsPct, utilization_pct: r.utilizationPct, withdrawable_usd: r.withdrawableUsd,
      tvl_usd: r.tvlUsd, exchange_rate: r.exchangeRate, avg7_pct: r.avg7Pct, days_measured: r.daysMeasured, eligible: r.eligible, verdict: r.verdict, reason: r.reason, served: r.served ?? null, ok: r.ok,
    }, { onConflict: "day,venue,asset" });
    if (error) throw new Error(error.message);
  }
  async listVenueDays(day: string) {
    return this.many(this.db.from("venue_days").select().eq("day", day), venueDayRow);
  }
  async listVenueHistory(venue: Venue, asset: LendAsset, sinceDay: string) {
    return this.many(this.db.from("venue_days").select().eq("venue", venue).eq("asset", asset).gte("day", sinceDay).order("day"), venueDayRow);
  }
  async putFoundVenues(rows: T.FoundVenueRow[]) {
    if (!rows.length) return;
    const { error } = await this.db.from("found_venues").upsert(rows.map((r) => ({ day: r.day, pool_id: r.poolId, project: r.project, symbol: r.symbol, asset: r.asset, apy_base_pct: r.apyBasePct, tvl_usd: r.tvlUsd, note: r.note })), { onConflict: "day,pool_id" });
    if (error) throw new Error(error.message);
  }
  async listFoundVenues(sinceDay: string, limit: number) {
    return this.many(this.db.from("found_venues").select().gte("day", sinceDay).order("day", { ascending: false }).limit(limit), foundVenueRow);
  }
  async insertMoveProposal(p: Omit<T.MoveProposalRow, "id" | "ts" | "status" | "redeemSignature" | "depositSignature" | "closedAt">) {
    const { data, error } = await this.db.from("move_proposals").insert({
      user_pubkey: p.userPubkey, asset: p.asset, from_venue: p.fromVenue, to_venue: p.toVenue, receipt_raw: p.receiptRaw.toString(), value_usd: p.valueUsd,
      from_avg7_pct: p.fromAvg7Pct, to_avg7_pct: p.toAvg7Pct, gain_30d_usd: p.gain30dUsd, cost_usd: p.costUsd,
    }).select().single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return null;
      throw new Error(error.message);
    }
    return moveProposalRow(data as Row);
  }
  async openMoveProposal(userPubkey: string) {
    const { data, error } = await this.db.from("move_proposals").select().eq("user_pubkey", userPubkey).eq("status", "open").maybeSingle();
    if (error) throw new Error(error.message);
    return data ? moveProposalRow(data as Row) : null;
  }
  async getMoveProposal(moveId: string) {
    const { data, error } = await this.db.from("move_proposals").select().eq("id", moveId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? moveProposalRow(data as Row) : null;
  }
  async setMoveProposalStatus(moveId: string, status: T.MoveStatus, sig?: { redeem?: string; deposit?: string }) {
    const { error } = await this.db.from("move_proposals").update({
      status, ...(sig?.redeem ? { redeem_signature: sig.redeem } : {}), ...(sig?.deposit ? { deposit_signature: sig.deposit } : {}), ...(status !== "open" ? { closed_at: new Date().toISOString() } : {}),
    }).eq("id", moveId);
    if (error) throw new Error(error.message);
  }
  /** One statement on the server (carry_credit, 0008): exact numerics, never through JS numbers. */
  async carryCreditRaw(userPubkey: string, kind: T.CarryKind) {
    const { data, error } = await this.db.rpc("carry_credit", { p_user: userPubkey, p_kind: kind });
    if (error) throw new Error(error.message);
    return BigInt(String(data ?? 0));
  }
  async setPlantingSurplus(plantingId: string, kind: "WSOL" | "USDC", surplusRaw: bigint) {
    const { data, error } = await this.db.from("carry").update({ surplus_raw: surplusRaw.toString() }).eq("planting_id", plantingId).eq("kind", kind).is("surplus_raw", null).select("planting_id");
    if (error) throw new Error(error.message);
    if ((data ?? []).length) return;
    const user = await this.one(this.db.from("plantings").select("user_pubkey").eq("id", plantingId).single(), (r) => String(r.user_pubkey));
    const { error: e2 } = await this.db.from("carry").upsert({ planting_id: plantingId, user_pubkey: user, kind, carry_in_raw: "0", surplus_raw: surplusRaw.toString() }, { onConflict: "planting_id,kind", ignoreDuplicates: true });
    if (e2) throw new Error(e2.message);
  }
  async setWalletLink(pubkey: string, l: { delegationPda: string; linkModel: T.LinkModel; dailyCapCents?: number }) {
    const { error } = await this.db.from("wallets").update({ delegation_pda: l.delegationPda, link_model: l.linkModel, ...(l.dailyCapCents !== undefined ? { daily_cap_cents: l.dailyCapCents } : {}) }).eq("pubkey", pubkey);
    if (error) throw new Error(error.message);
  }
  async setTermsAccepted(userPubkey: string, version: string, at: Date) {
    const { error } = await this.db.from("users").update({ terms_version: version, terms_accepted_at: at.toISOString() }).eq("seed_vault_pubkey", userPubkey);
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

  /** Binds only an unbound code, so two wallets fetching the same code in the same second cannot both take it (review M6). */
  async bindLinkCode(code: string, walletPubkey: string, delegationPda: string) {
    const { error } = await this.db.from("link_codes").update({ wallet_pubkey: walletPubkey, delegation_pda: delegationPda }).eq("code", code).is("wallet_pubkey", null);
    if (error) throw new Error(error.message);
  }

  /** Consumes the code only for the wallet it was bound to, in one statement. */
  async takeLinkCode(code: string, walletPubkey: string) {
    const { data, error } = await this.db.from("link_codes").update({ used: true }).eq("code", code).eq("used", false).eq("wallet_pubkey", walletPubkey).gt("expires_at", new Date().toISOString()).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data ? linkCodeRow(data as Row) : null;
  }

  async insertWithdrawal(w: NewWithdrawal) {
    return this.one(this.db.from("withdrawals").insert({
      user_pubkey: w.userPubkey, asset: w.asset, source: w.source, unstake_ts: new Date().toISOString(), unstake_signature: w.unstakeSignature,
      shares_unstaked: w.sharesUnstaked.toString(), amount_raw: w.amountRaw.toString(), principal_raw: w.principalRaw.toString(),
    }).select().single(), withdrawalRow);
  }

  /** Open rows: not delivered, not cancelled, not skipped [A11]. */
  private openWithdrawals() {
    return this.db.from("withdrawals").select().is("withdraw_signature", null).is("cancel_signature", null).is("skipped_at", null);
  }

  async pendingWithdrawal(userPubkey: string) {
    const { data, error } = await this.openWithdrawals().eq("user_pubkey", userPubkey).order("unstake_ts", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? withdrawalRow(data as Row) : null;
  }

  async listWithdrawals(userPubkey: string, limit: number) {
    return this.many(this.db.from("withdrawals").select().eq("user_pubkey", userPubkey).order("unstake_ts", { ascending: false }).limit(limit), withdrawalRow);
  }

  async dueWithdrawals(before: Date) {
    return this.many(this.openWithdrawals().lte("unstake_ts", before.toISOString()), withdrawalRow);
  }

  async setWithdrawalDone(withdrawalId: string, signature: string, amountOutRaw: bigint) {
    const { error } = await this.db.from("withdrawals").update({ withdraw_signature: signature, amount_out_raw: amountOutRaw.toString() }).eq("id", withdrawalId);
    if (error) throw new Error(error.message);
  }

  async setWithdrawalCancelled(withdrawalId: string, signature: string) {
    const { error } = await this.db.from("withdrawals").update({ cancel_signature: signature }).eq("id", withdrawalId);
    if (error) throw new Error(error.message);
  }

  async setWithdrawalSkipped(withdrawalId: string) {
    const { error } = await this.db.from("withdrawals").update({ skipped_at: new Date().toISOString() }).eq("id", withdrawalId);
    if (error) throw new Error(error.message);
  }

  /** Revokes the user's live session on this device, then inserts the new one (R84: one per wallet per device). */
  async putSession(s: { tokenHash: string; userPubkey: string; device: string; expiresAt: Date }) {
    const now = new Date().toISOString();
    const revoke = await this.db.from("sessions").update({ revoked_at: now }).eq("user_pubkey", s.userPubkey).eq("device", s.device).is("revoked_at", null);
    if (revoke.error) throw new Error(revoke.error.message);
    const { error } = await this.db.from("sessions").insert({ token_hash: s.tokenHash, user_pubkey: s.userPubkey, device: s.device, expires_at: s.expiresAt.toISOString() });
    if (error) throw new Error(error.message);
  }

  async getSession(tokenHash: string) {
    const { data, error } = await this.db.from("sessions").select().eq("token_hash", tokenHash).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? sessionRow(data as Row) : null;
  }

  async revokeSession(tokenHash: string) {
    const { error } = await this.db.from("sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", tokenHash).is("revoked_at", null);
    if (error) throw new Error(error.message);
  }

  async revokeAllSessions(userPubkey: string) {
    const { error } = await this.db.from("sessions").update({ revoked_at: new Date().toISOString() }).eq("user_pubkey", userPubkey).is("revoked_at", null);
    if (error) throw new Error(error.message);
  }

  async cleanupExpired() {
    const { error } = await this.db.rpc("cleanup_expired");
    if (error) throw new Error(error.message);
  }
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const date = (v: unknown) => new Date(String(v));
const big = (v: unknown) => (v === null || v === undefined ? null : BigInt(String(v)));

function userRow(r: Row): T.UserRow {
  return {
    seedVaultPubkey: String(r.seed_vault_pubkey), sgtMint: String(r.sgt_mint), skrName: str(r.skr_name), proUntil: r.pro_until ? date(r.pro_until) : null, createdAt: date(r.created_at),
    wateredAt: r.watered_at ? date(r.watered_at) : null, joinedShares: big(r.joined_shares) ?? 0n, joinedSharePrice: big(r.joined_share_price) ?? 0n,
    termsVersion: str(r.terms_version), termsAcceptedAt: r.terms_accepted_at ? date(r.terms_accepted_at) : null,
  };
}

export function rulesRow(r: Row): T.RulesRow {
  return {
    userPubkey: String(r.user_pubkey), roundupOn: Boolean(r.roundup_on), roundupToCents: Number(r.roundup_to_cents), pctOn: Boolean(r.pct_on), pctBps: Number(r.pct_bps),
    pctThresholdCents: Number(r.pct_threshold_cents), plantThresholdCents: Number(r.plant_threshold_cents), plantMaxDays: Number(r.plant_max_days),
    dailyCapCents: Number(r.daily_cap_cents),
    managed: Boolean(r.managed), stop: (r.stop as Stop) ?? "balanced", pins: { ...((r.pins as Record<string, number> | null) ?? {}) },
    allocation: toSplit(r.allocation as Record<string, number> | null),
    prevAllocation: r.prev_allocation ? toSplit(r.prev_allocation as Record<string, number>) : null,
    allocationDay: r.allocation_day ? String(r.allocation_day) : null,
    pinsByUndo: Boolean(r.pins_by_undo),
    updatedAt: date(r.updated_at),
  };
}

export function walletRow(r: Row): T.WalletRow {
  return {
    pubkey: String(r.pubkey), userPubkey: String(r.user_pubkey), delegationPda: String(r.delegation_pda), dailyCapCents: Number(r.daily_cap_cents),
    status: r.status as T.WalletStatus, webhookAdded: Boolean(r.webhook_added), ledgerCents: { ...((r.ledger_cents as Record<string, number> | null) ?? {}) }, createdAt: date(r.created_at),
    linkModel: (r.link_model as T.LinkModel) ?? "puller",
  };
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
export function legRow(r: Row): T.PlantingLegRow {
  return {
    plantingId: String(r.planting_id), asset: r.asset as Asset, usdcInCents: Number(r.usdc_in_cents), amountOutRaw: BigInt(String(r.amount_out_raw)),
    staked: Boolean(r.staked), feeAmountRaw: BigInt(String(r.fee_amount_raw ?? 0)), feeCents: Number(r.fee_cents ?? 0),
    rateAtPlanting: r.rate_at_planting === null || r.rate_at_planting === undefined ? null : Number(r.rate_at_planting),
    venue: (r.venue as T.PlantingLegRow["venue"]) ?? null,
  };
}
export function venueDayRow(r: Row): T.VenueDayRow {
  return {
    day: String(r.day), venue: r.venue as T.VenueDayRow["venue"], asset: r.asset as T.VenueDayRow["asset"], supplyPct: num(r.supply_pct), rewardsPct: num(r.rewards_pct),
    utilizationPct: num(r.utilization_pct), withdrawableUsd: num(r.withdrawable_usd), tvlUsd: num(r.tvl_usd), exchangeRate: num(r.exchange_rate), avg7Pct: num(r.avg7_pct),
    daysMeasured: Number(r.days_measured ?? 0), eligible: Boolean(r.eligible), verdict: (r.verdict as T.VenueDayRow["verdict"]) ?? null, reason: (r.reason as T.VenueDayRow["reason"]) ?? null,
    served: r.served ?? null, ok: Boolean(r.ok),
  };
}
function foundVenueRow(r: Row): T.FoundVenueRow {
  return { day: String(r.day), poolId: String(r.pool_id), project: String(r.project), symbol: String(r.symbol), asset: r.asset as "USDC" | "SOL", apyBasePct: num(r.apy_base_pct), tvlUsd: num(r.tvl_usd), note: str(r.note) };
}
export function moveProposalRow(r: Row): T.MoveProposalRow {
  return {
    id: String(r.id), userPubkey: String(r.user_pubkey), ts: date(r.ts), asset: r.asset as T.MoveProposalRow["asset"], fromVenue: r.from_venue as T.MoveProposalRow["fromVenue"],
    toVenue: r.to_venue as T.MoveProposalRow["toVenue"], receiptRaw: BigInt(String(r.receipt_raw)), valueUsd: Number(r.value_usd), fromAvg7Pct: Number(r.from_avg7_pct),
    toAvg7Pct: Number(r.to_avg7_pct), gain30dUsd: Number(r.gain_30d_usd), costUsd: Number(r.cost_usd), status: r.status as T.MoveStatus,
    redeemSignature: str(r.redeem_signature), depositSignature: str(r.deposit_signature), closedAt: r.closed_at ? date(r.closed_at) : null,
  };
}
export function coinDayRow(r: Row): T.CoinDayRow {
  return {
    day: String(r.day), asset: r.asset as Asset, rate: num(r.rate), ratePrev: num(r.rate_prev), ratePrevDays: num(r.rate_prev_days), priceUsd: num(r.price_usd),
    liquidityUsd: num(r.liquidity_usd), priceChange24h: num(r.price_change_24h), tradeable: Boolean(r.tradeable), lastUpdateEpoch: num(r.last_update_epoch), ok: Boolean(r.ok),
  };
}
export function splitDayRow(r: Row): T.SplitDayRow {
  return {
    day: String(r.day), stop: r.stop as Stop, split: toSplit(r.split as Record<string, number>), modelAnswer: r.model_answer ?? null,
    why: str(r.why), fallback: str(r.fallback), callId: num(r.call_id),
    venuePick: (r.venue_pick as T.SplitDayRow["venuePick"]) ?? null,
  };
}
function eventRow(r: Row): T.EventRow {
  return { id: Number(r.id), userPubkey: str(r.user_pubkey), walletPubkey: str(r.wallet_pubkey), ts: date(r.ts), kind: r.kind as T.EventKind, detail: r.detail ?? null };
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
    sharesBefore: big(r.shares_before), sharesAfter: big(r.shares_after), sharesMinted: big(r.shares_minted),
    skrCarryInRaw: big(r.skr_carry_in_raw) ?? 0n, skrSurplusRaw: big(r.skr_surplus_raw),
  };
}

function linkCodeRow(r: Row): T.LinkCodeRow {
  return { code: String(r.code), userPubkey: String(r.user_pubkey), expiresAt: date(r.expires_at), nonce: BigInt(String(r.nonce)), walletPubkey: str(r.wallet_pubkey), delegationPda: str(r.delegation_pda), used: Boolean(r.used) };
}

function withdrawalRow(r: Row): T.WithdrawalRow {
  return {
    id: String(r.id), userPubkey: String(r.user_pubkey), asset: r.asset as Asset, unstakeTs: date(r.unstake_ts), unstakeSignature: str(r.unstake_signature),
    withdrawSignature: str(r.withdraw_signature), amountOutRaw: big(r.amount_out_raw), rewardDeltaRaw: big(r.reward_delta_raw),
    cancelSignature: str(r.cancel_signature), sharesUnstaked: big(r.shares_unstaked), amountRaw: big(r.amount_raw), principalRaw: big(r.principal_raw) ?? 0n,
    source: (r.source as T.WithdrawalSource) ?? "sprouts", skippedAt: r.skipped_at ? date(r.skipped_at) : null,
  };
}

function stakeAdjustmentRow(r: Row): T.StakeAdjustmentRow {
  return {
    id: String(r.id), userPubkey: String(r.user_pubkey), ts: date(r.ts), kind: r.kind as T.StakeAdjustmentRow["kind"],
    sharesDelta: BigInt(String(r.shares_delta)), amountRaw: BigInt(String(r.amount_raw)), sharePrice: BigInt(String(r.share_price)),
  };
}

function watcherCallRow(r: Row): T.WatcherCallRow {
  return { id: Number(r.id), ts: date(r.ts), userPubkey: str(r.user_pubkey), kind: r.kind as T.WatcherCallKind, inputTokens: Number(r.input_tokens), outputTokens: Number(r.output_tokens), costMicrocents: Number(r.cost_microcents) };
}
function sessionRow(r: Row): T.SessionRow {
  return { tokenHash: String(r.token_hash), userPubkey: String(r.user_pubkey), device: String(r.device), createdAt: date(r.created_at), expiresAt: date(r.expires_at), revokedAt: r.revoked_at ? date(r.revoked_at) : null };
}
