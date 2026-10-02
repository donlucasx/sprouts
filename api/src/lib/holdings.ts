import type { Address } from "@solana/kit";
import { fetchAllMaybeToken, fetchMaybeToken, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { Repo } from "@/db/repo";
import type { CoinDayRow, PlantingLegRow } from "@/db/types";
import { ASSETS, COINS, type Asset } from "@/domain/coins";
import { addDays } from "@/domain/day";
import { rpc } from "./rpc";

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

/**
 * Each coin's newest numbers within a week: the rate from the latest good row (ok, with a rate), the price from the latest priced
 * row. A failed re-run today (written ok false) never hides yesterday's good rate.
 */
export async function latestCoinDays(repo: Repo, day: string): Promise<Partial<Record<Asset, CoinDayRow>>> {
  const out: Partial<Record<Asset, CoinDayRow>> = {};
  for (const a of ASSETS) {
    const rows = (await repo.listCoinDays(a, addDays(day, -7))).slice().reverse(); // newest first
    if (!rows.length) continue;
    const rated = rows.find((r) => r.ok && r.rate !== null) ?? null;
    const priced = rows.find((r) => r.priceUsd !== null) ?? null;
    const base = rated ?? rows.find((r) => r.ok) ?? rows[0];
    out[a] = { ...base, rate: rated?.rate ?? null, priceUsd: priced?.priceUsd ?? null };
  }
  return out;
}

export type Holding = { asset: Asset; heldRaw: bigint; putInCents: number; valueUsd: number | null; earnedUsd: number | null; earnedUnderlyingRaw: bigint | null };

/**
 * Spec 7.6: value = balance times today's price; earned = each leg's amount times the rate's rise since it was planted, in the
 * coin's underlying (SOL for an LST, ORE for stORE), priced at the underlying's price derived from the coin's own price over its
 * rate. A leg planted before the first snapshot (null rate) counts 0. cbBTC has no rate, so no earned.
 */
export function holdingsFrom(a: { held: Partial<Record<Asset, bigint>>; legs: PlantingLegRow[]; days: Partial<Record<Asset, CoinDayRow | null>> }): Holding[] {
  const out: Holding[] = [];
  for (const asset of WALLET_COINS) {
    const heldRaw = a.held[asset] ?? 0n;
    if (heldRaw === 0n) continue;
    const coin = COINS[asset];
    const day = a.days[asset] ?? null;
    const legs = a.legs.filter((l) => l.asset === asset);
    const putInCents = legs.reduce((s, l) => s + l.usdcInCents, 0);
    const scale = 10 ** coin.decimals;
    const valueUsd = day?.priceUsd != null ? (Number(heldRaw) / scale) * day.priceUsd : null;
    let earnedUnderlyingRaw: bigint | null = null;
    let earnedUsd: number | null = null;
    if (coin.kind !== "btc" && day?.rate != null && day.rate > 0) {
      const underlying = legs.reduce((s, l) => (l.rateAtPlanting === null ? s : s + (Number(l.amountOutRaw) / scale) * Math.max(0, (day.rate as number) - l.rateAtPlanting)), 0);
      earnedUnderlyingRaw = BigInt(Math.round(underlying * scale));
      earnedUsd = day.priceUsd != null ? underlying * (day.priceUsd / day.rate) : null;
    }
    out.push({ asset, heldRaw, putInCents, valueUsd, earnedUsd, earnedUnderlyingRaw });
  }
  return out;
}
