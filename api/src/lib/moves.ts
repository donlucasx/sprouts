import type { Repo } from "@/db/repo";
import type { MoveProposalRow, PlantingLegRow } from "@/db/types";
import { COINS, isLendAsset, type LendAsset } from "@/domain/coins";
import { AUTO_VENUES, isAutoVenue, moveQualifies, venueCandidates, type AutoVenue } from "@/domain/venues";
import { dayOf, addDays } from "@/domain/day";
import type { LendPosition } from "./holdings";
import { signatureStatus } from "./planting";

const FEE_LAMPORTS = 2 * 5_000;
/** C-I2 / K-I1 / K-I2: what build and dismiss answer for a move whose redeem signature is stored (served as `inFlight: true`). */
/** R337: the moves step runs only when MOVES_ENABLED is exactly "true"; unset (or anything else) is off. */
export const movesEnabled = (): boolean => process.env.MOVES_ENABLED === "true";
export const IN_FLIGHT = "This move is on its way. Check Home in a minute.";
const ATA_RENT_LAMPORTS = 2_039_280;

/** Spec 7: lending-to-lending, same asset, Kamino <-> Jupiter Lend only; proposed when 30 days of the 7-day-average gap beat 3x the cost. */
export type DepositStatus = "confirmed" | "failed" | "pending" | "expired";
/** A deposit's blockhash comes from its build; past this age after the newest build, a signature the chain does not know can never land. */
const BUILD_LIFETIME_MS = 5 * 60_000;

/**
 * The on-chain outcome of one of a card's two transactions, by its stored signature (the confirm stores both before the redeem is
 * sent): "expired" once the chain does not know it and the newest build of the move is older than any blockhash it could carry.
 */
export async function chainTxStatus(repo: Repo, card: MoveProposalRow, signature: string, now: Date): Promise<DepositStatus> {
  const s = await signatureStatus(signature);
  if (s !== "pending") return s;
  const built = (await repo.listEvents(card.userPubkey, ["move_built"], 200)).find((e) => (e.detail as { id?: unknown } | null)?.id === card.id);
  return !built || now.getTime() - built.ts.getTime() > BUILD_LIFETIME_MS ? "expired" : "pending";
}

/**
 * A move whose deposit confirmed: open -> done (compare-and-set), then the move_done event by the writer that won (a failed write is
 * logged; the carry reads the card). False when the card was no longer open: the caller re-reads and answers from that state.
 */
export async function finishMove(repo: Repo, card: MoveProposalRow, receiptRaw: bigint): Promise<boolean> {
  if (!(await repo.transitionMoveProposal(card.id, "open", "done"))) return false;
  try {
    await repo.addEvent({ userPubkey: card.userPubkey, walletPubkey: null, kind: "move_done", detail: moveDetail({ ...card, receiptRaw }, "done") });
  } catch (e) {
    console.error(`moves: ${card.id} is done but the move_done event was not written for ${card.userPubkey}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return true;
}

/** The redeem landed and the deposit cannot: open -> failed (compare-and-set), then move_failed (Activity: the money is back in the wallet). */
export async function failMove(repo: Repo, card: MoveProposalRow): Promise<boolean> {
  if (!(await repo.transitionMoveProposal(card.id, "open", "failed"))) return false;
  try {
    await repo.addEvent({ userPubkey: card.userPubkey, walletPubkey: null, kind: "move_failed", detail: moveDetail(card, "failed") });
  } catch (e) {
    console.error(`moves: ${card.id} failed but the move_failed event was not written for ${card.userPubkey}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return true;
}

/**
 * An open card with a stored redeem signature is a move in flight, never a card to expire, dismiss or rebuild. Its signatures say how
 * it ended: the deposit confirmed -> done (+ move_done, the carry); the deposit can no longer land -> the redeem decides: it landed ->
 * failed (+ move_failed), it never did -> nothing moved, the signatures are cleared and the card is an ordinary open card again
 * ("cleared"); anything still pending -> left alone. Every write is a compare-and-set, so a confirm racing this settles once.
 */
async function settleInFlight(repo: Repo, card: MoveProposalRow, status: (sig: string, card: MoveProposalRow) => Promise<DepositStatus>): Promise<"done" | "failed" | "cleared" | "pending"> {
  const redeem = card.redeemSignature as string;
  if (!card.depositSignature) return (await failMove(repo, card)) ? "failed" : "pending";
  const d = await status(card.depositSignature, card);
  if (d === "pending") return "pending";
  if (d === "confirmed") {
    const built = await latestMoveBuild(repo, card.userPubkey, card.id, redeem);
    return (await finishMove(repo, card, built?.receiptRaw ?? card.receiptRaw)) ? "done" : "pending";
  }
  const r = await status(redeem, card);
  if (r === "pending") return "pending";
  if (r === "confirmed") return (await failMove(repo, card)) ? "failed" : "pending";
  return (await repo.clearMoveSignatures(card.id, redeem)) ? "cleared" : "pending";
}

/**
 * `txStatus` reads one stored signature's outcome (default chainTxStatus); the cron passes one that throws past its moves deadline,
 * which leaves the card in flight for the next run (T21 minor: no chain read outside the deadline).
 */
export async function proposeMoves(a: { repo: Repo; now: Date; positions(user: string): Promise<LendPosition[]>; solUsd: number; txStatus?(signature: string, card: MoveProposalRow): Promise<DepositStatus> }): Promise<{ proposed: string[]; expired: string[]; settled: string[] }> {
  const day = dayOf(a.now);
  const today = await a.repo.listVenueDays(day);
  const yesterday = await a.repo.listVenueDays(addDays(day, -1));
  const costUsd = ((FEE_LAMPORTS + ATA_RENT_LAMPORTS) / 1e9) * a.solUsd;
  const proposed: string[] = [];
  const expired: string[] = [];
  const settled: string[] = [];
  const status = (sig: string, c: MoveProposalRow) => (a.txStatus ? a.txStatus(sig, c) : chainTxStatus(a.repo, c, sig, a.now));
  for (const u of await a.repo.listUsers()) {
    let open = await a.repo.openMoveProposal(u.seedVaultPubkey);
    if (open?.redeemSignature) {
      const card = open;
      const outcome = await settleInFlight(a.repo, card, status).catch((e: unknown) => {
        console.error(`proposeMoves: could not settle move ${card.id}: ${e instanceof Error ? e.message : String(e)}`);
        return "pending" as const;
      });
      if (outcome === "pending") continue;   // still in flight (or another writer won): no new card, nothing expired
      settled.push(`${card.id}:${outcome}`);
      // Cleared: nothing moved, the card is an ordinary open card again and is judged below like any other.
      open = outcome === "cleared" ? { ...card, redeemSignature: null, depositSignature: null } : null;
    }
    // Review minor 1: a failed read is not "no position"; the user is skipped and an open card stays as it is.
    let positions: LendPosition[];
    try { positions = await a.positions(u.seedVaultPubkey); } catch { continue; }
    let best: { p: LendPosition; to: (typeof AUTO_VENUES)[number]; valueUsd: number; from: number; toPct: number; gain: number } | null = null;
    for (const p of positions) {
      const c = venueCandidates(p.asset, today, yesterday);
      const from = c.find((x) => x.venue === p.venue)?.avg7Pct ?? null;
      const price = (await a.repo.getCoinDay(day, p.asset))?.priceUsd ?? null;
      const rate = today.find((r) => r.venue === p.venue && r.asset === p.asset)?.exchangeRate ?? null;
      if (from === null || price === null || rate === null) continue;
      const valueUsd = ((Number(p.receiptRaw) * rate) / 10 ** COINS[p.asset].decimals) * price;
      for (const t of c) {
        if (t.venue === p.venue || !t.eligible || t.verdict === "avoid" || t.avg7Pct === null) continue;
        const m = moveQualifies({ valueUsd, fromAvg7Pct: from, toAvg7Pct: t.avg7Pct, costUsd });
        if (m.qualifies && (!best || m.gain30dUsd > best.gain)) best = { p, to: t.venue, valueUsd, from, toPct: t.avg7Pct, gain: m.gain30dUsd };
      }
    }
    if (open && (!best || best.p.asset !== open.asset || best.p.venue !== open.fromVenue || best.to !== open.toVenue)) {
      // Compare-and-set, and never a card in flight: a confirm that stored its signatures meanwhile wins, and no new card is offered.
      if (!(await a.repo.transitionMoveProposal(open.id, "open", "expired", { notInFlight: true }))) continue;
      expired.push(open.id);
    }
    if (best && !(open && best.p.asset === open.asset && best.p.venue === open.fromVenue && best.to === open.toVenue)) {
      const row = await a.repo.insertMoveProposal({ userPubkey: u.seedVaultPubkey, asset: best.p.asset, fromVenue: best.p.venue, toVenue: best.to, receiptRaw: best.p.receiptRaw, valueUsd: best.valueUsd, fromAvg7Pct: best.from, toAvg7Pct: best.toPct, gain30dUsd: best.gain, costUsd });
      if (row) {
        proposed.push(u.seedVaultPubkey);
        await a.repo.addEvent({ userPubkey: u.seedVaultPubkey, walletPubkey: null, kind: "move_proposed", detail: moveDetail(row, "open") });
      }
    }
  }
  return { proposed, expired, settled };
}

/** The detail every move_proposed / move_done / move_dismissed / move_failed event carries (Activity reads it, contracts 5.7). */
export const moveDetail = (m: { id: string; asset: LendAsset; fromVenue: AutoVenue; toVenue: AutoVenue; receiptRaw: bigint }, status: "open" | "done" | "dismissed" | "failed") =>
  ({ id: m.id, asset: m.asset, from: m.fromVenue, to: m.toVenue, receiptRaw: m.receiptRaw.toString(), status });

/**
 * Contracts 5.4 + T14's cap: 99.9% of what the redeem is expected to pay out, but never above the source position's underlyingRaw as
 * /api/me serves it (the app refuses a deposit above that on 'amount'). The live rate runs ahead of the daily snapshot, so the
 * served figure can be the smaller one; whatever the deposit leaves stays in the user's wallet.
 */
export const moveDepositRaw = (a: { expectedOutRaw: bigint; servedUnderlyingRaw: bigint }): bigint => {
  const haircut = (a.expectedOutRaw * 9_990n) / 10_000n;
  return haircut < a.servedUnderlyingRaw ? haircut : a.servedUnderlyingRaw;
};

/**
 * What one build answered (the `move_built` event): the confirm sends only these amounts, and a done move carries the position's
 * basis and earned with them. Rates are underlying per receipt unit, as `venue_days.exchange_rate` holds them (what /api/me values
 * with); `toReceiptRaw` is the target receipt the deposit should mint at the target's live rate.
 */
export type MoveCarry = { id: string; asset: LendAsset; from: AutoVenue; to: AutoVenue; receiptRaw: bigint; sourceReceiptRaw: bigint; depositRaw: bigint; fromRate: number; toRate: number; toReceiptRaw: bigint;
  /** Set on the build the confirm matched and is about to send (C-I2/K-I2): that build is the carry's, whatever is built later. */
  redeemSignature?: string };

export const moveBuiltDetail = (c: MoveCarry) => ({
  id: c.id, asset: c.asset, from: c.from, to: c.to, receiptRaw: c.receiptRaw.toString(), sourceReceiptRaw: c.sourceReceiptRaw.toString(), depositRaw: c.depositRaw.toString(),
  toReceiptRaw: c.toReceiptRaw.toString(), fromRate: c.fromRate, toRate: c.toRate, ...(c.redeemSignature ? { redeemSignature: c.redeemSignature } : {}),
});

const digits = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
export function parseMoveBuilt(detail: unknown): MoveCarry | null {
  const d = (detail ?? {}) as Record<string, unknown>;
  if (typeof d.id !== "string" || typeof d.asset !== "string" || !isLendAsset(d.asset) || typeof d.from !== "string" || !isAutoVenue(d.from) || typeof d.to !== "string" || !isAutoVenue(d.to)) return null;
  if (!digits(d.receiptRaw) || !digits(d.sourceReceiptRaw) || !digits(d.depositRaw) || !digits(d.toReceiptRaw) || !finite(d.fromRate) || !finite(d.toRate)) return null;
  return { id: d.id, asset: d.asset, from: d.from, to: d.to, receiptRaw: BigInt(d.receiptRaw), sourceReceiptRaw: BigInt(d.sourceReceiptRaw), depositRaw: BigInt(d.depositRaw), toReceiptRaw: BigInt(d.toReceiptRaw), fromRate: d.fromRate, toRate: d.toRate,
    ...(typeof d.redeemSignature === "string" && d.redeemSignature ? { redeemSignature: d.redeemSignature } : {}) };
}

/**
 * The newest build of one move; with `redeemSignature` (a move in flight or done), the build the confirm pinned to that signature
 * first, so a build made after the signatures were stored can never change the carry.
 */
export async function latestMoveBuild(repo: Repo, userPubkey: string, id: string, redeemSignature?: string | null): Promise<MoveCarry | null> {
  let newest: MoveCarry | null = null;
  for (const e of await repo.listEvents(userPubkey, ["move_built"], 200)) {
    const c = parseMoveBuilt(e.detail);
    if (!c || c.id !== id) continue;
    if (!redeemSignature) return c;
    if (c.redeemSignature === redeemSignature) return c;
    newest ??= c;
  }
  return newest;
}

/**
 * Every done move's carry, oldest first. The done CARDS are the record (fix round 1: a lost move_done event cannot erase a carry);
 * each takes the newest build of that move, which is the one its confirm matched (the confirm re-records an older build it matched).
 */
export async function moveCarriesFor(repo: Repo, userPubkey: string): Promise<MoveCarry[]> {
  const done = await repo.listMoveProposals(userPubkey, "done");
  if (!done.length) return [];
  const builds = new Map<string, MoveCarry>();
  const pinned = new Map<string, MoveCarry>();   // `${id}|${redeemSignature}`: the build the confirm sent
  for (const e of await repo.listEvents(userPubkey, ["move_built"], 1_000)) {   // newest first: keep the first seen per id
    const c = parseMoveBuilt(e.detail);
    if (!c) continue;
    if (!builds.has(c.id)) builds.set(c.id, c);
    if (c.redeemSignature && !pinned.has(`${c.id}|${c.redeemSignature}`)) pinned.set(`${c.id}|${c.redeemSignature}`, c);
  }
  return done.flatMap((m) => { const c = pinned.get(`${m.id}|${m.redeemSignature}`) ?? builds.get(m.id); return c ? [c] : []; });
}

/** The recent builds of one move, newest first (the confirm accepts a signed pair from any of them: each is the server's own amounts). */
export async function recentMoveBuilds(repo: Repo, userPubkey: string, id: string, now: Date): Promise<MoveCarry[]> {
  return (await repo.listEvents(userPubkey, ["move_built"], 200))
    .filter((e) => now.getTime() - e.ts.getTime() <= BUILD_LIFETIME_MS)
    .flatMap((e) => { const c = parseMoveBuilt(e.detail); return c && c.id === id ? [c] : []; });
}

/**
 * Spec 8 after a move: holdings match a position's legs by (asset, venue), so a moved position would show no basis and no earned at
 * its new venue. Each done move (oldest first) takes its share of the source legs (receiptRaw over what the wallet held then) and
 * replaces it with one synthetic leg at the target: the same put-in, receipt = what the deposit minted, and a rate at planting set so
 * that receipt x (target rate - it) equals what the moved share had earned at the source rate. Earned right after == before; from then
 * on it grows at the target's rate. Legs of other (asset, venue) pairs are untouched. Pure: the ledger itself is never rewritten.
 */
export function carryMoves(legs: readonly PlantingLegRow[], carries: readonly MoveCarry[]): PlantingLegRow[] {
  let out = legs.map((l) => ({ ...l }));
  for (const c of carries) {
    if (c.sourceReceiptRaw <= 0n || c.toReceiptRaw <= 0n) continue;
    const src = out.filter((l) => l.asset === c.asset && l.venue === c.from);
    const planted = src.reduce((s, l) => s + l.amountOutRaw, 0n);
    if (planted <= 0n) continue;   // no ledger basis at the source (received elsewhere): nothing to carry
    const moved = c.receiptRaw < c.sourceReceiptRaw ? c.receiptRaw : c.sourceReceiptRaw;
    const q = Number(moved) / Number(c.sourceReceiptRaw);
    const kept = Math.min(1, Number(c.sourceReceiptRaw) / Number(planted));
    const earned = q * kept * src.reduce((s, l) => (l.rateAtPlanting === null ? s : s + Number(l.amountOutRaw) * Math.max(0, c.fromRate - l.rateAtPlanting)), 0);
    const putIn = q * kept * src.reduce((s, l) => s + l.usdcInCents, 0);
    const left = c.sourceReceiptRaw - moved;
    out = out.flatMap((l) => {
      if (!src.includes(l)) return [l];
      if (left === 0n) return [];
      return [{ ...l, amountOutRaw: (l.amountOutRaw * left) / c.sourceReceiptRaw, usdcInCents: Math.round((l.usdcInCents * Number(left)) / Number(c.sourceReceiptRaw)) }];
    });
    out.push({ plantingId: `move:${c.id}`, asset: c.asset, venue: c.to, usdcInCents: Math.round(putIn), amountOutRaw: c.toReceiptRaw, staked: false, feeAmountRaw: 0n, feeCents: 0,
      rateAtPlanting: c.toRate - earned / Number(c.toReceiptRaw) });
  }
  return out;
}
