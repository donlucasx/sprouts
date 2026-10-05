import type { Repo } from "@/db/repo";
import type { MoveProposalRow, PlantingLegRow } from "@/db/types";
import { COINS, isLendAsset, type LendAsset } from "@/domain/coins";
import { AUTO_VENUES, isAutoVenue, moveQualifies, venueCandidates, type AutoVenue } from "@/domain/venues";
import { dayOf, addDays } from "@/domain/day";
import type { LendPosition } from "./holdings";
import { signatureStatus } from "./planting";

const FEE_LAMPORTS = 2 * 5_000;
const ATA_RENT_LAMPORTS = 2_039_280;

/** Spec 7: lending-to-lending, same asset, Kamino <-> Jupiter Lend only; proposed when 30 days of the 7-day-average gap beat 3x the cost. */
export type DepositStatus = "confirmed" | "failed" | "pending" | "expired";
/** A deposit's blockhash comes from its build; past this age after the newest build, a signature the chain does not know can never land. */
const BUILD_LIFETIME_MS = 5 * 60_000;

/**
 * The on-chain outcome of a card's deposit, by its stored signature (the confirm stores it before sending): "expired" once the chain
 * does not know it and the newest build of the move is older than any blockhash it could carry.
 */
export async function chainDepositStatus(repo: Repo, card: MoveProposalRow, now: Date): Promise<DepositStatus> {
  const s = await signatureStatus(card.depositSignature as string);
  if (s !== "pending") return s;
  const built = (await repo.listEvents(card.userPubkey, ["move_built"], 200)).find((e) => (e.detail as { id?: unknown } | null)?.id === card.id);
  return !built || now.getTime() - built.ts.getTime() > BUILD_LIFETIME_MS ? "expired" : "pending";
}

/** A move whose deposit confirmed: done with both signatures, then the move_done event (a failed write is logged; the carry reads the card). */
export async function finishMove(repo: Repo, card: MoveProposalRow, sig: { redeem: string; deposit: string }, receiptRaw: bigint): Promise<void> {
  await repo.setMoveProposalStatus(card.id, "done", sig);
  try {
    await repo.addEvent({ userPubkey: card.userPubkey, walletPubkey: null, kind: "move_done", detail: moveDetail({ ...card, receiptRaw }, "done") });
  } catch (e) {
    console.error(`moves: ${card.id} is done but the move_done event was not written for ${card.userPubkey}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Fix round 1 (review I1): an open card whose redeem landed is a move in flight, never a card to expire. Its deposit's signature says
 * how it ended: confirmed -> done (+ move_done, the carry), failed or expired -> failed, still pending -> left alone. No deposit
 * signature (cannot happen once the confirm stores both before the deposit send) -> failed.
 */
async function settleInFlight(repo: Repo, card: MoveProposalRow, status: (card: MoveProposalRow) => Promise<DepositStatus>): Promise<"done" | "failed" | "pending"> {
  if (!card.depositSignature) { await repo.setMoveProposalStatus(card.id, "failed"); return "failed"; }
  const s = await status(card);
  if (s === "pending") return "pending";
  if (s === "confirmed") {
    const built = await latestMoveBuild(repo, card.userPubkey, card.id);
    await finishMove(repo, card, { redeem: card.redeemSignature as string, deposit: card.depositSignature }, built?.receiptRaw ?? card.receiptRaw);
    return "done";
  }
  await repo.setMoveProposalStatus(card.id, "failed");
  return "failed";
}

export async function proposeMoves(a: { repo: Repo; now: Date; positions(user: string): Promise<LendPosition[]>; solUsd: number; depositStatus?(signature: string, card: MoveProposalRow): Promise<DepositStatus> }): Promise<{ proposed: string[]; expired: string[] }> {
  const day = dayOf(a.now);
  const today = await a.repo.listVenueDays(day);
  const yesterday = await a.repo.listVenueDays(addDays(day, -1));
  const costUsd = ((FEE_LAMPORTS + ATA_RENT_LAMPORTS) / 1e9) * a.solUsd;
  const proposed: string[] = [];
  const expired: string[] = [];
  for (const u of await a.repo.listUsers()) {
    let open = await a.repo.openMoveProposal(u.seedVaultPubkey);
    if (open?.redeemSignature) {
      const status = (c: MoveProposalRow) => (a.depositStatus ? a.depositStatus(c.depositSignature as string, c) : chainDepositStatus(a.repo, c, a.now));
      const settled = await settleInFlight(a.repo, open, status).catch((e: unknown) => {
        console.error(`proposeMoves: could not settle move ${open?.id}: ${e instanceof Error ? e.message : String(e)}`);
        return "pending" as const;
      });
      if (settled === "pending") continue;   // still in flight: no new card, nothing expired
      open = null;
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
      await a.repo.setMoveProposalStatus(open.id, "expired");
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
  return { proposed, expired };
}

/** The detail every move_proposed / move_done / move_dismissed event carries (Activity reads it, contracts 5.7). */
export const moveDetail = (m: { id: string; asset: LendAsset; fromVenue: AutoVenue; toVenue: AutoVenue; receiptRaw: bigint }, status: "open" | "done" | "dismissed") =>
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
export type MoveCarry = { id: string; asset: LendAsset; from: AutoVenue; to: AutoVenue; receiptRaw: bigint; sourceReceiptRaw: bigint; depositRaw: bigint; fromRate: number; toRate: number; toReceiptRaw: bigint };

export const moveBuiltDetail = (c: MoveCarry) => ({
  id: c.id, asset: c.asset, from: c.from, to: c.to, receiptRaw: c.receiptRaw.toString(), sourceReceiptRaw: c.sourceReceiptRaw.toString(), depositRaw: c.depositRaw.toString(),
  toReceiptRaw: c.toReceiptRaw.toString(), fromRate: c.fromRate, toRate: c.toRate,
});

const digits = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
export function parseMoveBuilt(detail: unknown): MoveCarry | null {
  const d = (detail ?? {}) as Record<string, unknown>;
  if (typeof d.id !== "string" || typeof d.asset !== "string" || !isLendAsset(d.asset) || typeof d.from !== "string" || !isAutoVenue(d.from) || typeof d.to !== "string" || !isAutoVenue(d.to)) return null;
  if (!digits(d.receiptRaw) || !digits(d.sourceReceiptRaw) || !digits(d.depositRaw) || !digits(d.toReceiptRaw) || !finite(d.fromRate) || !finite(d.toRate)) return null;
  return { id: d.id, asset: d.asset, from: d.from, to: d.to, receiptRaw: BigInt(d.receiptRaw), sourceReceiptRaw: BigInt(d.sourceReceiptRaw), depositRaw: BigInt(d.depositRaw), toReceiptRaw: BigInt(d.toReceiptRaw), fromRate: d.fromRate, toRate: d.toRate };
}

/** The newest build of one move (the confirm checks the posted transactions against exactly this one). */
export async function latestMoveBuild(repo: Repo, userPubkey: string, id: string): Promise<MoveCarry | null> {
  for (const e of await repo.listEvents(userPubkey, ["move_built"], 200)) {
    const c = parseMoveBuilt(e.detail);
    if (c && c.id === id) return c;
  }
  return null;
}

/**
 * Every done move's carry, oldest first. The done CARDS are the record (fix round 1: a lost move_done event cannot erase a carry);
 * each takes the newest build of that move, which is the one its confirm matched (the confirm re-records an older build it matched).
 */
export async function moveCarriesFor(repo: Repo, userPubkey: string): Promise<MoveCarry[]> {
  const done = await repo.listMoveProposals(userPubkey, "done");
  if (!done.length) return [];
  const builds = new Map<string, MoveCarry>();
  for (const e of await repo.listEvents(userPubkey, ["move_built"], 1_000)) {   // newest first: keep the first seen per id
    const c = parseMoveBuilt(e.detail);
    if (c && !builds.has(c.id)) builds.set(c.id, c);
  }
  return done.flatMap((m) => { const c = builds.get(m.id); return c ? [c] : []; });
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
