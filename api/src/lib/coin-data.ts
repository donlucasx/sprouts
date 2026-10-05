import type { Repo } from "@/db/repo";
import type { CoinDayRow } from "@/db/types";
import { ASSETS, COINS, type Asset, type LiveAsset } from "@/domain/coins";
import { dayOf, daysBetween } from "@/domain/day";
import { parseStakePool, solPerToken } from "./stake-pool";
import type { PriceInfo } from "./jupiter";

/** Everything the snapshot reads, injected so it is unit-tested with fakes; the cron wires the real chain and Jupiter. */
export type CoinReads = {
  /** The account's data, or null when it does not exist. */
  accountData(address: string): Promise<Uint8Array | null>;
  skrSharePrice(): Promise<bigint>;   // 1e9 scale
  storeRate(): Promise<bigint>;       // ORE per stORE, 1e9 scale
  currentEpoch(): Promise<bigint>;
  prices(mints: string[]): Promise<Record<string, PriceInfo>>;
  /** A $2 quote with the planting's own settings lands with price impact under the limit. */
  quoteOk(asset: LiveAsset): Promise<boolean>;
};

/** A Solana epoch is about two days: the span of the day-one seed from a pool's last-epoch pair. */
export const EPOCH_DAYS = 2;
export const IMPACT_LIMIT_PCT = 1;
/** A pool whose crank has not run for this many epochs is stale: its rate is yesterday's news. */
const STALE_EPOCHS = 2n;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The daily snapshot (spec 5.2): one row per coin for the day. Every coin's reads are isolated, so one failure never blocks the
 * others; a failed coin is written with `ok false` (no data) and an event, and the model is told.
 */
export async function snapshotCoins(a: { repo: Repo; now: Date; reads: CoinReads }): Promise<CoinDayRow[]> {
  const day = dayOf(a.now);
  const prices = await a.reads.prices(ASSETS.map((c) => COINS[c].mint)).catch((e) => {
    console.error(`snapshot: prices failed: ${msg(e)}`);
    return {} as Record<string, PriceInfo>;
  });
  const epoch = await a.reads.currentEpoch().catch((e) => {
    console.error(`snapshot: epoch read failed: ${msg(e)}`);
    return null;
  });
  const rows: CoinDayRow[] = [];
  for (const asset of ASSETS) {
    const row: CoinDayRow = { day, asset, rate: null, ratePrev: null, ratePrevDays: null, priceUsd: null, liquidityUsd: null, priceChange24h: null, tradeable: false, lastUpdateEpoch: null, ok: false };
    const p = prices[COINS[asset].mint];
    if (p) {
      row.priceUsd = p.usdPrice;
      row.liquidityUsd = p.liquidity;
      row.priceChange24h = p.priceChange24h;
    }
    try {
      await readRate(asset, row, a.reads, epoch);
      row.tradeable = asset === "SKR" || asset === "USDC_LEND" ? true : await a.reads.quoteOk(asset);
      row.ok = true;
    } catch (e) {
      console.error(`snapshot: ${asset} is no data today: ${msg(e)}`);
      await a.repo.addEvent({ userPubkey: null, walletPubkey: null, kind: "coin_no_data", detail: { asset, day, err: msg(e) } });
    }
    await a.repo.putCoinDay(row);
    rows.push(row);
  }
  return rows;
}

async function readRate(asset: Asset, row: CoinDayRow, reads: CoinReads, epoch: bigint | null): Promise<void> {
  const coin = COINS[asset];
  if (coin.kind === "lst") {
    const data = await reads.accountData(coin.pool as string);
    if (!data) throw new Error("pool account missing");
    const t = parseStakePool(data);
    row.rate = solPerToken(t.totalLamports, t.poolTokenSupply);
    row.lastUpdateEpoch = Number(t.lastUpdateEpoch);
    if (epoch !== null && epoch - t.lastUpdateEpoch >= STALE_EPOCHS) throw new Error(`pool last updated in epoch ${t.lastUpdateEpoch}, now ${epoch}`);
    const prev = solPerToken(t.lastEpochTotalLamports, t.lastEpochPoolTokenSupply);
    if (row.rate !== null && prev !== null && prev > 0 && prev <= row.rate) {
      row.ratePrev = prev;
      row.ratePrevDays = EPOCH_DAYS;
    }
  } else if (coin.kind === "skr") {
    row.rate = Number(await reads.skrSharePrice()) / 1e9;
  } else if (coin.kind === "store") {
    row.rate = Number(await reads.storeRate()) / 1e9;
  }
  if (coin.kind !== "btc" && coin.kind !== "lend" && !(row.rate !== null && row.rate > 0)) throw new Error("no rate");
}

export const annualisedPct = (ratio: number, days: number): number => (Math.pow(ratio, 365 / days) - 1) * 100;

/** Measured growth (spec 5.3): today against the oldest good row within seven days, else the day-one seed, else collecting. */
export function growth(rows: CoinDayRow[]): { pct: number | null; days: number } {
  const today = rows[rows.length - 1];
  if (!today || !today.ok || today.rate === null) return { pct: null, days: 0 };
  const old = rows.find((r) => r.ok && r.rate !== null && daysBetween(r.day, today.day) >= 1 && daysBetween(r.day, today.day) <= 7);
  if (old) {
    const days = daysBetween(old.day, today.day);
    return { pct: annualisedPct(today.rate / (old.rate as number), days), days };
  }
  if (today.ratePrev && today.ratePrevDays) return { pct: annualisedPct(today.rate / today.ratePrev, today.ratePrevDays), days: today.ratePrevDays };
  return { pct: null, days: 0 };
}

/** The price move from the oldest row within seven days, with its span (the API itself gives only 24 hours). */
export function priceChange(rows: CoinDayRow[]): { pct: number | null; days: number } {
  const today = rows[rows.length - 1];
  if (!today || today.priceUsd === null) return { pct: null, days: 0 };
  const old = rows.find((r) => r.priceUsd !== null && daysBetween(r.day, today.day) >= 1 && daysBetween(r.day, today.day) <= 7);
  if (!old) return { pct: null, days: 0 };
  return { pct: (today.priceUsd / (old.priceUsd as number) - 1) * 100, days: daysBetween(old.day, today.day) };
}
