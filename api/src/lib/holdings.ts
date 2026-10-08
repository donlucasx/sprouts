import type { Address } from "@solana/kit";
import { fetchAllMaybeToken, fetchMaybeToken, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { Repo } from "@/db/repo";
import type { CoinDayRow, PlantingLegRow, VenueDayRow } from "@/db/types";
import { ASSETS, COINS, type Asset } from "@/domain/coins";
import { addDays } from "@/domain/day";
import { rpc } from "./rpc";
import { RECEIPT } from "./venues/addresses";
import { LEND_ASSETS, type LendAsset } from "@/domain/coins";
import { AUTO_VENUES, VENUES, type AutoVenue } from "@/domain/venues";
import { growth } from "./coin-data";

/** The coins that sit in the Seed Vault wallet (every coin but SKR today). */
export const WALLET_COINS: Asset[] = ASSETS.filter((a) => COINS[a].held === "wallet");

/** Every wallet coin's balance in one read; a missing account is zero. */
export async function readHoldings(owner: Address): Promise<Partial<Record<Asset, bigint>>> {
  const atas = await Promise.all(WALLET_COINS.map(async (a) => (await findAssociatedTokenPda({ owner, mint: COINS[a].mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]));
  const accounts = await fetchAllMaybeToken(rpc(), atas);
  const out: Partial<Record<Asset, bigint>> = {};
  accounts.forEach((acc, i) => { out[WALLET_COINS[i]] = acc.exists ? acc.data.amount : 0n; });
  return out;
}

/** One wallet coin's balance in the Seed Vault wallet, 0n with no account; throws on an RPC error (which must not read as zero) [R141]. */
export async function assetBalanceRaw(owner: Address, asset: Asset): Promise<bigint> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: COINS[asset].mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const acc = await fetchMaybeToken(rpc(), ata);
  return acc.exists ? acc.data.amount : 0n;
}

/** One lending receipt's balance in the Seed Vault wallet (the user's canonical ATA of the venue's receipt mint), 0n with no account. */
export async function receiptBalanceRaw(owner: Address, asset: LendAsset, venue: AutoVenue): Promise<bigint> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: RECEIPT[asset][venue].mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const acc = await fetchMaybeToken(rpc(), ata);
  return acc.exists ? acc.data.amount : 0n;
}

/** Every lending position (four receipt accounts, one read); only positions above zero. */
export async function readLendingPositions(owner: Address): Promise<{ asset: LendAsset; venue: AutoVenue; receiptRaw: bigint }[]> {
  const keys = LEND_ASSETS.flatMap((asset) => AUTO_VENUES.map((venue) => ({ asset, venue })));
  const atas = await Promise.all(keys.map(async (k) => (await findAssociatedTokenPda({ owner, mint: RECEIPT[k.asset][k.venue].mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]));
  const accounts = await fetchAllMaybeToken(rpc(), atas);
  return keys.map((k, i) => ({ ...k, receiptRaw: accounts[i].exists ? accounts[i].data.amount : 0n })).filter((p) => p.receiptRaw > 0n);
}

/**
 * Each coin's newest numbers within a week: the rate from the latest good row (ok, with a rate), the price from the latest priced
 * row. A failed re-run today (written ok false) never hides yesterday's good rate.
 */
export async function latestCoinDays(repo: Repo, day: string): Promise<Partial<Record<Asset, CoinDayRow>>> {
  const out: Partial<Record<Asset, CoinDayRow>> = {};
  const all = await Promise.all(ASSETS.map((a) => repo.listCoinDays(a, addDays(day, -7))));   // one read per coin, all at once
  for (const [i, a] of ASSETS.entries()) {
    const rows = all[i].slice().reverse(); // newest first
    if (!rows.length) continue;
    const rated = rows.find((r) => r.ok && r.rate !== null) ?? null;
    const priced = rows.find((r) => r.priceUsd !== null) ?? null;
    const base = rated ?? rows.find((r) => r.ok) ?? rows[0];
    out[a] = { ...base, rate: rated?.rate ?? null, priceUsd: priced?.priceUsd ?? null };
  }
  return out;
}

/**
 * R192, R194: each coin's first recorded rate (the stand-in for a leg planted before snapshots began) and its measured growth over
 * the past week (`growth`, spec 5.3), null while collecting.
 */
export type RateFacts = { firstRate: number | null; growthPct: number | null };
export async function rateFacts(repo: Repo, day: string): Promise<Partial<Record<Asset, RateFacts>>> {
  const out: Partial<Record<Asset, RateFacts>> = {};
  const rated = ASSETS.filter((a) => COINS[a].kind !== "btc" && COINS[a].kind !== "lend");
  const reads = await Promise.all(rated.map((a) => repo.listCoinDays(a, "2000-01-01")));   // one read per coin, all at once
  for (const [i, a] of rated.entries()) {
    const all = reads[i];
    const first = all.find((r) => r.ok && r.rate !== null && r.rate > 0) ?? null;
    out[a] = { firstRate: first?.rate ?? null, growthPct: growth(all.filter((r) => r.day >= addDays(day, -8))).pct };
  }
  return out;
}

export type Holding = { asset: Asset; heldRaw: bigint; putInCents: number; valueUsd: number | null; earnedUsd: number | null; earnedUnderlyingRaw: bigint | null; growthPct: number | null };

/**
 * Spec 7.6: value = balance times today's price; earned = each leg's amount times the rate's rise since it was planted, in the
 * coin's underlying (SOL for an LST, ORE for stORE), priced at the underlying's price derived from the coin's own price over its
 * rate. A leg planted before the first snapshot (null rate) counts from the coin's first recorded rate (R192), else 0. cbBTC has no rate, so no earned. What left the wallet takes
 * its share of the basis (R159): both are scaled by the fraction still held.
 */
export function holdingsFrom(a: { held: Partial<Record<Asset, bigint>>; legs: PlantingLegRow[]; days: Partial<Record<Asset, CoinDayRow | null>>; facts?: Partial<Record<Asset, RateFacts>> }): Holding[] {
  const out: Holding[] = [];
  for (const asset of WALLET_COINS) {
    const heldRaw = a.held[asset] ?? 0n;
    if (heldRaw === 0n) continue;
    const coin = COINS[asset];
    const day = a.days[asset] ?? null;
    const legs = a.legs.filter((l) => l.asset === asset);
    // R159: what left the wallet (sold or sent from the wallet app) takes its share of the basis with it: the fraction still
    // held over everything ever planted; more than planted (a coin received elsewhere) counts as the whole basis, never more.
    const plantedRaw = legs.reduce((s, l) => s + l.amountOutRaw, 0n);
    const kept = plantedRaw > 0n ? Math.min(1, Number(heldRaw) / Number(plantedRaw)) : 1;
    const putInCents = Math.round(legs.reduce((s, l) => s + l.usdcInCents, 0) * kept);
    const scale = 10 ** coin.decimals;
    const valueUsd = day?.priceUsd != null ? (Number(heldRaw) / scale) * day.priceUsd : null;
    let earnedUnderlyingRaw: bigint | null = null;
    let earnedUsd: number | null = null;
    if (coin.kind !== "btc" && day?.rate != null && day.rate > 0) {
      const from = (l: PlantingLegRow) => l.rateAtPlanting ?? a.facts?.[asset]?.firstRate ?? null;
      const underlying = kept * legs.reduce((s, l) => { const r = from(l); return r === null ? s : s + (Number(l.amountOutRaw) / scale) * Math.max(0, (day.rate as number) - r); }, 0);
      earnedUnderlyingRaw = BigInt(Math.round(underlying * scale));
      earnedUsd = day.priceUsd != null ? underlying * (day.priceUsd / day.rate) : null;
    }
    out.push({ asset, heldRaw, putInCents, valueUsd, earnedUsd, earnedUnderlyingRaw, growthPct: a.facts?.[asset]?.growthPct ?? null });
  }
  return out;
}

export type LendPosition = { asset: LendAsset; venue: AutoVenue; receiptRaw: bigint };
export type LendingPositionOut = { asset: LendAsset; venue: AutoVenue; receiptMint: Address; receiptRaw: bigint; underlyingRaw: bigint; valueUsd: number | null; ratePct: number | null; avg7Pct: number | null;
  earnedUsd: number | null; earnedUnderlyingRaw: bigint | null; putInCents: number; withdrawableUsd: number | null; poolFull: boolean };

/**
 * Spec 8: value = receipt x the venue's exchange rate (underlying raw per receipt raw, snapshotted daily in `venue_days`) x the
 * underlying's price; earned = each leg's receipt x (rate now - rate at planting), scaled by the fraction still held (R159); a leg
 * with no rate at planting counts 0. `underlyingRaw` is the position's underlying at the newest venue snapshot (the caller's
 * `rows`), floored. With no snapshot the rate is unknown: underlying 0 and value null (never a guess).
 */
export function lendingFrom(a: { positions: LendPosition[]; legs: PlantingLegRow[]; rows: VenueDayRow[]; prices: Partial<Record<LendAsset, number | null>> }): LendingPositionOut[] {
  return a.positions.map((p) => {
    const row = a.rows.find((r) => r.venue === p.venue && r.asset === p.asset) ?? null;
    const rate = row?.exchangeRate ?? null;
    const scale = 10 ** COINS[p.asset].decimals;
    const price = a.prices[p.asset] ?? null;
    const legs = a.legs.filter((l) => l.asset === p.asset && l.venue === p.venue);
    const planted = legs.reduce((s, l) => s + l.amountOutRaw, 0n);
    const kept = planted > 0n ? Math.min(1, Number(p.receiptRaw) / Number(planted)) : 1;
    // No rated snapshot in 7 days: the highest rate any of this position's legs was planted at (rates only rise, so this still
    // understates and is never zero for a funded position); value stays null, no dollar claim on a stale rate. No such leg: 0.
    const plantedRates = legs.map((l) => l.rateAtPlanting).filter((r): r is number => r !== null);
    const amountRate = rate ?? (plantedRates.length ? Math.max(...plantedRates) : null);
    const underlying = amountRate === null ? 0 : Math.floor(Number(p.receiptRaw) * amountRate);   // whole raw units: value and underlyingRaw agree
    const earnedUnderlying = rate === null ? null : kept * legs.reduce((s, l) => (l.rateAtPlanting === null ? s : s + Number(l.amountOutRaw) * Math.max(0, rate - l.rateAtPlanting)), 0);
    const valueUsd = rate !== null && price !== null ? (underlying / scale) * price : null;
    return {
      asset: p.asset, venue: p.venue, receiptMint: RECEIPT[p.asset][p.venue].mint, receiptRaw: p.receiptRaw, underlyingRaw: BigInt(underlying), valueUsd,
      ratePct: row?.supplyPct ?? null, avg7Pct: row?.avg7Pct ?? null,
      earnedUsd: earnedUnderlying !== null && price !== null ? (earnedUnderlying / scale) * price : null, earnedUnderlyingRaw: earnedUnderlying === null ? null : BigInt(Math.round(earnedUnderlying)),
      putInCents: Math.round(legs.reduce((s, l) => s + l.usdcInCents, 0) * kept), withdrawableUsd: row?.withdrawableUsd ?? null,
      poolFull: row?.withdrawableUsd != null && valueUsd !== null && row.withdrawableUsd < valueUsd,
    };
  });
}

/** One Home row per lending leg (contracts 5.2: heldRaw = underlying summed over venues, in the underlying's units: USDC 6 / SOL 9 decimals). */
export function lendHoldings(ps: LendingPositionOut[]): Holding[] {
  return LEND_ASSETS.flatMap((asset) => {
    const mine = ps.filter((p) => p.asset === asset);
    if (!mine.length) return [];
    const sumOrNull = (xs: (number | null)[]) => (xs.every((x) => x === null) ? null : xs.reduce<number>((s, x) => s + (x ?? 0), 0));
    return [{
      asset, heldRaw: mine.reduce((s, p) => s + p.underlyingRaw, 0n), putInCents: mine.reduce((s, p) => s + p.putInCents, 0),
      valueUsd: sumOrNull(mine.map((p) => p.valueUsd)), earnedUsd: sumOrNull(mine.map((p) => p.earnedUsd)),
      earnedUnderlyingRaw: mine.some((p) => p.earnedUnderlyingRaw !== null) ? mine.reduce((s, p) => s + (p.earnedUnderlyingRaw ?? 0n), 0n) : null,
      growthPct: mine.map((p) => p.avg7Pct).filter((x): x is number => x !== null).reduce<number | null>((m, x) => (m === null || x > m ? x : m), null),
    }];
  });
}

/**
 * Each (venue, asset)'s newest row within 7 days that carries a rate, with the exchange rate taken from the newest row that has
 * one (a failed snapshot today never hides yesterday's rate; the same rule as `latestCoinDays`).
 */
export async function latestVenueRows(repo: Repo, day: string): Promise<VenueDayRow[]> {
  const keys = VENUES.flatMap((venue) => LEND_ASSETS.map((asset) => ({ venue, asset })));
  const all = await Promise.all(keys.map(({ venue, asset }) => repo.listVenueHistory(venue, asset, addDays(day, -7))));
  const out: VenueDayRow[] = [];
  for (const history of all) {
    const rows = history.filter((r) => r.day <= day && (r.exchangeRate !== null || r.supplyPct !== null));
    if (!rows.length) continue;
    const base = rows[rows.length - 1];
    const rated = [...rows].reverse().find((r) => r.exchangeRate !== null) ?? null;
    out.push({ ...base, exchangeRate: rated?.exchangeRate ?? null });
  }
  return out;
}
