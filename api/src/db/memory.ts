import type { Repo, NewPlanting, NewWithdrawal, NewWatcherCall } from "./repo";
import { checkLegVenues } from "./repo";
import type * as T from "./types";
import type { LiveAsset, LendAsset, Stop } from "@/domain/coins";
import type { Venue } from "@/domain/venues";
import { toSplit } from "@/domain/coins";
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
  watcherCalls: T.WatcherCallRow[] = [];
  private watcherCallSeq = 0;
  coinDays = new Map<string, T.CoinDayRow>();
  splitDays = new Map<string, T.SplitDayRow>();
  venueDays = new Map<string, T.VenueDayRow>();
  foundVenues = new Map<string, T.FoundVenueRow>();
  moves = new Map<string, T.MoveProposalRow>();
  carry: { plantingId: string; userPubkey: string; kind: "WSOL" | "USDC"; carryInRaw: bigint; surplusRaw: bigint | null }[] = [];

  async upsertUser(u: { seedVaultPubkey: string; sgtMint: string; skrName: string | null }) {
    for (const other of this.users.values()) {
      if (other.sgtMint === u.sgtMint && other.seedVaultPubkey !== u.seedVaultPubkey) throw new Error("This phone is already registered.");
    }
    const existing = this.users.get(u.seedVaultPubkey);
    const row: T.UserRow = {
      seedVaultPubkey: u.seedVaultPubkey, sgtMint: u.sgtMint, skrName: u.skrName, proUntil: existing?.proUntil ?? null, createdAt: existing?.createdAt ?? new Date(),
      wateredAt: existing?.wateredAt ?? null, joinedShares: existing?.joinedShares ?? 0n, joinedSharePrice: existing?.joinedSharePrice ?? 0n,
      termsVersion: existing?.termsVersion ?? null, termsAcceptedAt: existing?.termsAcceptedAt ?? null,
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
      r = { ...DEFAULT_RULES, pins: {}, allocation: { ...DEFAULT_RULES.allocation }, prevAllocation: null, allocationDay: null, pinsByUndo: false, userPubkey, updatedAt: new Date() };
      this.rules.set(userPubkey, r);
    }
    return r;
  }

  async saveRules(userPubkey: string, patch: Partial<Omit<T.RulesRow, "userPubkey" | "updatedAt">>): Promise<T.RulesRow> {
    const current = await this.getRules(userPubkey);
    const next: T.RulesRow = {
      ...current, ...patch,
      pins: { ...(patch.pins ?? current.pins) },
      allocation: toSplit(patch.allocation ?? current.allocation),
      prevAllocation: patch.prevAllocation === undefined ? current.prevAllocation : patch.prevAllocation ? toSplit(patch.prevAllocation) : null,
      userPubkey, updatedAt: new Date(),
    };
    this.rules.set(userPubkey, next);
    return next;
  }

  async listManagedRules() {
    return [...this.rules.values()].filter((r) => r.managed);
  }

  async addWallet(w: { pubkey: string; userPubkey: string; delegationPda: string; dailyCapCents: number; webhookAdded?: boolean; linkModel?: T.LinkModel }): Promise<T.WalletRow> {
    // An upsert, like Supabase: a re-link resets the delegation, cap, status and webhook flag and keeps the ledger (review I3).
    const { webhookAdded = false, linkModel, ...rest } = w;
    const existing = this.wallets.get(w.pubkey);
    const row: T.WalletRow = {
      ...rest, status: "active", webhookAdded,
      ledgerCents: { ...(existing?.ledgerCents ?? {}) }, createdAt: existing?.createdAt ?? new Date(),
      linkModel: linkModel ?? existing?.linkModel ?? "puller",
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

  async bumpLedger(pubkey: string, asset: LiveAsset, cents: number) {
    const w = this.wallets.get(pubkey);
    if (!w) return;
    w.ledgerCents[asset] = (w.ledgerCents[asset] ?? 0) + cents;
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

  async skrCreditRaw(userPubkey: string) {
    let credit = 0n;
    for (const p of this.plantings.values()) {
      if (p.userPubkey !== userPubkey || p.status === "failed") continue;
      if (p.status === "confirmed") credit += p.skrSurplusRaw ?? 0n;
      credit -= p.skrCarryInRaw;
    }
    return credit;
  }

  async setPlantingSkrSurplus(plantingId: string, surplusRaw: bigint) {
    const p = this.plantings.get(plantingId);
    if (p && p.skrSurplusRaw === null) p.skrSurplusRaw = surplusRaw;
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

  /** Test seam (AMEND 10-04 s20, T3 review I3): the next insertPlanting fails after the planting row is written, as a Postgres legs/carry insert error would. One-shot. */
  insertFault: "legs" | "carry" | null = null;

  async insertPlanting(p: NewPlanting, legs: Omit<T.PlantingLegRow, "plantingId">[]): Promise<T.PlantingRow> {
    checkLegVenues(legs);
    const { sharesBefore = null, ts, carryIn, ...rest } = p;
    const row: T.PlantingRow = { ...rest, id: id(), ts: ts ?? new Date(), sharesBefore, sharesAfter: null, sharesMinted: null, skrCarryInRaw: rest.skrCarryInRaw ?? 0n, skrSurplusRaw: null };
    this.plantings.set(row.id, row);
    try {
      if (this.insertFault === "legs") throw new Error("planting_legs insert failed (insertFault)");
      for (const leg of legs) this.legs.push({ ...leg, plantingId: row.id });
      if (this.insertFault === "carry") throw new Error("carry insert failed (insertFault)");
      for (const [kind, raw] of Object.entries(carryIn ?? {}) as ["WSOL" | "USDC", bigint][]) if (raw > 0n) this.carry.push({ plantingId: row.id, userPubkey: row.userPubkey, kind, carryInRaw: raw, surplusRaw: null });
    } catch (e) {
      this.insertFault = null;
      await this.setPlantingStatus(row.id, "failed");
      throw e;
    }
    return row;
  }

  async plantingCarry(plantingId: string) {
    return Object.fromEntries(this.carry.filter((c) => c.plantingId === plantingId).map((c) => [c.kind, c.carryInRaw])) as Partial<Record<"WSOL" | "USDC", bigint>>;
  }

  async setPlantingStatus(plantingId: string, status: T.PlantingStatus, signature?: string) {
    const p = this.plantings.get(plantingId);
    if (!p) return;
    p.status = status;
    if (signature) p.signature = signature;
  }

  async setLegAmountOut(plantingId: string, asset: LiveAsset, amountOutRaw: bigint) {
    const leg = this.legs.find((l) => l.plantingId === plantingId && l.asset === asset);
    if (leg) leg.amountOutRaw = amountOutRaw;
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

  async addWatcherCall(c: NewWatcherCall) {
    const id = ++this.watcherCallSeq;   // a sequence, like bigserial: a deleted reservation never frees its id
    this.watcherCalls.push({ ...c, id, ts: c.ts ?? new Date() });
    return id;
  }
  async settleWatcherCall(id: number, u: { inputTokens: number; outputTokens: number; costMicrocents: number }) {
    const c = this.watcherCalls.find((x) => x.id === id);
    if (c) Object.assign(c, u);
  }
  async deleteWatcherCall(id: number) {
    this.watcherCalls = this.watcherCalls.filter((c) => c.id !== id);
  }
  async watcherSpendMicrocents(since: Date) {
    return this.watcherCalls.filter((c) => c.ts.getTime() >= since.getTime()).reduce((sum, c) => sum + c.costMicrocents, 0);
  }
  async watcherCallsBy(userPubkey: string, since: Date) {
    return this.watcherCalls.filter((c) => c.userPubkey === userPubkey && c.ts.getTime() >= since.getTime()).length;
  }
  async listWatcherCalls() {
    return this.watcherCalls.map((c) => ({ ...c }));
  }

  async addEvent(e: Omit<T.EventRow, "id" | "ts">) {
    this.events.push({ ...e, id: this.events.length + 1, ts: new Date() });
  }

  async listEvents(userPubkey: string, kinds: T.EventKind[], limit: number) {
    return this.events.filter((e) => e.userPubkey === userPubkey && kinds.includes(e.kind)).sort((a, b) => b.id - a.id).slice(0, limit);
  }

  async putCoinDay(row: T.CoinDayRow) {
    this.coinDays.set(`${row.day}|${row.asset}`, { ...row });
  }
  async getCoinDay(day: string, asset: LiveAsset) {
    return this.coinDays.get(`${day}|${asset}`) ?? null;
  }
  async listCoinDays(asset: LiveAsset, sinceDay: string) {
    return [...this.coinDays.values()].filter((r) => r.asset === asset && r.day >= sinceDay).sort((a, b) => a.day.localeCompare(b.day));
  }
  async putSplitDay(row: T.SplitDayRow) {
    this.splitDays.set(`${row.day}|${row.stop}`, { ...row, split: toSplit(row.split), venuePick: row.venuePick ?? null });
  }
  async getSplitDay(day: string, stop: Stop) {
    return this.splitDays.get(`${day}|${stop}`) ?? null;
  }
  async latestSplitDay(stop: Stop, beforeDay?: string) {
    const rows = [...this.splitDays.values()].filter((r) => r.stop === stop && (!beforeDay || r.day < beforeDay)).sort((a, b) => b.day.localeCompare(a.day));
    return rows[0] ?? null;
  }

  async putVenueDay(row: T.VenueDayRow) {
    this.venueDays.set(`${row.day}|${row.venue}|${row.asset}`, { ...row });
  }
  async listVenueDays(day: string) {
    return [...this.venueDays.values()].filter((r) => r.day === day);
  }
  async listVenueHistory(venue: Venue, asset: LendAsset, sinceDay: string) {
    return [...this.venueDays.values()].filter((r) => r.venue === venue && r.asset === asset && r.day >= sinceDay).sort((a, b) => a.day.localeCompare(b.day));
  }
  async putFoundVenues(rows: T.FoundVenueRow[]) {
    for (const r of rows) this.foundVenues.set(`${r.day}|${r.poolId}`, { ...r });
  }
  async listFoundVenues(sinceDay: string, limit: number) {
    return [...this.foundVenues.values()].filter((r) => r.day >= sinceDay).sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit);
  }
  async insertMoveProposal(p: Omit<T.MoveProposalRow, "id" | "ts" | "status" | "redeemSignature" | "depositSignature" | "closedAt">) {
    if (!(p.gain30dUsd > 3 * p.costUsd)) throw new Error('new row for relation "move_proposals" violates check constraint');
    if (await this.openMoveProposal(p.userPubkey)) return null;
    const row: T.MoveProposalRow = { ...p, id: id(), ts: new Date(), status: "open", redeemSignature: null, depositSignature: null, closedAt: null };
    this.moves.set(row.id, row);
    return { ...row };
  }
  async openMoveProposal(userPubkey: string) {
    const r = [...this.moves.values()].find((m) => m.userPubkey === userPubkey && m.status === "open");
    return r ? { ...r } : null;
  }
  async getMoveProposal(moveId: string) {
    const r = this.moves.get(moveId);
    return r ? { ...r } : null;
  }
  async setMoveProposalStatus(moveId: string, status: T.MoveStatus, sig?: { redeem?: string; deposit?: string }) {
    const m = this.moves.get(moveId);
    if (!m) return;
    m.status = status;
    if (sig?.redeem) m.redeemSignature = sig.redeem;
    if (sig?.deposit) m.depositSignature = sig.deposit;
    if (status !== "open") m.closedAt = new Date();
  }
  async carryCreditRaw(userPubkey: string, kind: T.CarryKind) {
    if (kind === "SKR") return this.skrCreditRaw(userPubkey);
    let credit = 0n;
    for (const c of this.carry) {
      if (c.userPubkey !== userPubkey || c.kind !== kind) continue;
      const status = this.plantings.get(c.plantingId)?.status;
      if (status === "confirmed") credit += c.surplusRaw ?? 0n;
      if (status === "confirmed" || status === "sent") credit -= c.carryInRaw;
    }
    return credit;
  }
  async setPlantingSurplus(plantingId: string, kind: "WSOL" | "USDC", surplusRaw: bigint) {
    const row = this.carry.find((c) => c.plantingId === plantingId && c.kind === kind);
    if (row) {
      if (row.surplusRaw === null) row.surplusRaw = surplusRaw;
      return;
    }
    const p = this.plantings.get(plantingId);
    if (p) this.carry.push({ plantingId, userPubkey: p.userPubkey, kind, carryInRaw: 0n, surplusRaw });
  }
  async setWalletLink(pubkey: string, l: { delegationPda: string; linkModel: T.LinkModel; dailyCapCents?: number }) {
    const w = this.wallets.get(pubkey);
    if (!w) return;
    w.delegationPda = l.delegationPda;
    w.linkModel = l.linkModel;
    if (l.dailyCapCents !== undefined) w.dailyCapCents = l.dailyCapCents;
  }
  async setTermsAccepted(userPubkey: string, version: string, at: Date) {
    const u = this.users.get(userPubkey);
    if (!u) return;
    u.termsVersion = version;
    u.termsAcceptedAt = at;
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
    // Either source: a cooldown the wallet started is the basket too (review I2, [A24]).
    return this.open().filter((w) => w.userPubkey === userPubkey).sort((a, b) => b.unstakeTs.getTime() - a.unstakeTs.getTime())[0] ?? null;
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
