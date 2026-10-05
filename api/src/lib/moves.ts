import type { Repo } from "@/db/repo";
import type { PlantingLegRow } from "@/db/types";
import { COINS, isLendAsset, type LendAsset } from "@/domain/coins";
import { AUTO_VENUES, isAutoVenue, moveQualifies, venueCandidates, type AutoVenue } from "@/domain/venues";
import { dayOf, addDays } from "@/domain/day";
import type { LendPosition } from "./holdings";

const FEE_LAMPORTS = 2 * 5_000;
const ATA_RENT_LAMPORTS = 2_039_280;

/** Spec 7: lending-to-lending, same asset, Kamino <-> Jupiter Lend only; proposed when 30 days of the 7-day-average gap beat 3x the cost. */
export async function proposeMoves(a: { repo: Repo; now: Date; positions(user: string): Promise<LendPosition[]>; solUsd: number }): Promise<{ proposed: string[]; expired: string[] }> {
  const day = dayOf(a.now);
  const today = await a.repo.listVenueDays(day);
  const yesterday = await a.repo.listVenueDays(addDays(day, -1));
  const costUsd = ((FEE_LAMPORTS + ATA_RENT_LAMPORTS) / 1e9) * a.solUsd;
  const proposed: string[] = [];
  const expired: string[] = [];
  for (const u of await a.repo.listUsers()) {
    const open = await a.repo.openMoveProposal(u.seedVaultPubkey);
    let best: { p: LendPosition; to: (typeof AUTO_VENUES)[number]; valueUsd: number; from: number; toPct: number; gain: number } | null = null;
    for (const p of await a.positions(u.seedVaultPubkey).catch(() => [])) {
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

/** Every done move's carry, oldest first: for each move_done, the newest build of that move written before it. */
export async function moveCarriesFor(repo: Repo, userPubkey: string): Promise<MoveCarry[]> {
  const events = (await repo.listEvents(userPubkey, ["move_built", "move_done"], 1_000)).slice().sort((p, q) => p.id - q.id);
  const out: MoveCarry[] = [];
  const builds = new Map<string, MoveCarry>();
  for (const e of events) {
    if (e.kind === "move_built") { const c = parseMoveBuilt(e.detail); if (c) builds.set(c.id, c); continue; }
    const id = (e.detail as { id?: unknown } | null)?.id;
    const c = typeof id === "string" ? builds.get(id) : undefined;
    if (c) out.push(c);
  }
  return out;
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
