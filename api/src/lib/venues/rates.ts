import type { Repo } from "@/db/repo";
import type { VenueDayRow } from "@/db/types";
import type { LendAsset } from "@/domain/coins";
import { avg7, eligibleVenue, isAutoVenue, type AutoVenue, type Venue } from "@/domain/venues";
import { addDays, dayOf } from "@/domain/day";
import { JLEND, KLEND, KLEND_MARKET, SM_VAULT } from "./addresses";
import { klendRate } from "./klend";
import { jlendRate } from "./jlend";
import { config } from "../config";

export type VenueReads = {
  kaminoReserves(): Promise<unknown>; jupiterEarn(): Promise<unknown>; kaminoVault(): Promise<unknown>; luloRates(): Promise<unknown>;
  /** Underlying raw per receipt raw, read on chain from the pinned reserve or lending account (value = receipt x rate, spec 8). */
  exchangeRate(venue: AutoVenue, asset: LendAsset): Promise<number>;
  llamaPools(): Promise<unknown>;
};
export type VenueRate = { venue: Venue; asset: LendAsset; supplyPct: number | null; rewardsPct: number | null; utilizationPct: number | null; withdrawableUsd: number | null; tvlUsd: number | null; note: string | null };
export type ServedRate = { asset: LendAsset; supplyPct: number | null; rewardsPct: number | null; utilizationPct: number | null; withdrawableUsd: number | null; tvlUsd: number | null; avg7Pct: number | null; daysMeasured: number };
export type FoundPool = { poolId: string; project: string; symbol: string; asset: "USDC" | "SOL"; apyBasePct: number; tvlUsd: number };

const blank = (venue: Venue, asset: LendAsset, note: string): VenueRate => ({ venue, asset, supplyPct: null, rewardsPct: null, utilizationPct: null, withdrawableUsd: null, tvlUsd: null, note });

/** Kamino's reserves/metrics, read by the PINNED reserve id (spec 3: never "the best reserve in the market"). */
export function parseKaminoReserves(json: unknown, asset: LendAsset): VenueRate {
  const r = (json as { reserve: string; supplyApy: string; totalSupplyUsd: string; totalBorrowUsd: string }[]).find((x) => x.reserve === KLEND[asset].reserve);
  if (!r) return blank("kamino_klend", asset, "pinned reserve missing from the API");
  const supply = Number(r.totalSupplyUsd);
  const borrow = Number(r.totalBorrowUsd);
  return { venue: "kamino_klend", asset, supplyPct: Number(r.supplyApy) * 100, rewardsPct: 0, utilizationPct: supply > 0 ? (borrow / supply) * 100 : null, withdrawableUsd: supply - borrow, tvlUsd: supply, note: null };
}
/** Jupiter's lend/v1/earn/tokens by f-token mint: rates in bps; "utilization" = the share not withdrawable right now [decision: JL publishes no utilization]. */
export function parseJupiterEarn(json: unknown, asset: LendAsset): VenueRate {
  const t = (json as { address: string; asset: { decimals: number; price: string }; supplyRate: string; rewardsRate: string; totalAssets: string; liquiditySupplyData: { withdrawable: string } }[]).find((x) => x.address === JLEND[asset].fTokenMint);
  if (!t) return blank("jupiter_lend", asset, "f-token missing from the API");
  const scale = 10 ** t.asset.decimals;
  const price = Number(t.asset.price);
  const total = Number(t.totalAssets) / scale;
  const withdrawable = Number(t.liquiditySupplyData.withdrawable) / scale;
  return { venue: "jupiter_lend", asset, supplyPct: Number(t.supplyRate) / 100, rewardsPct: Number(t.rewardsRate) / 100, utilizationPct: total > 0 ? (1 - withdrawable / total) * 100 : null, withdrawableUsd: withdrawable * price, tvlUsd: total * price, note: null };
}
/** R285: the Solana Mobile vault's REAL rate (apyActual), table only. */
export function parseKaminoVault(json: unknown): VenueRate {
  const v = json as { apyActual: string; tokensAvailableUsd: string; tokensInvestedUsd: string };
  return { venue: "kamino_sm_vault", asset: "USDC_LEND", supplyPct: Number(v.apyActual) * 100, rewardsPct: 0, utilizationPct: null, withdrawableUsd: Number(v.tokensAvailableUsd), tvlUsd: Number(v.tokensAvailableUsd) + Number(v.tokensInvestedUsd), note: null };
}
export function parseLulo(json: unknown): VenueRate {
  const v = json as { protected?: { CURRENT?: number } };
  const pct = v.protected?.CURRENT;
  return typeof pct === "number" ? { venue: "lulo_protected", asset: "USDC_LEND", supplyPct: pct, rewardsPct: null, utilizationPct: null, withdrawableUsd: null, tvlUsd: null, note: null } : blank("lulo_protected", "USDC_LEND", "rate unavailable");
}

/** Review M1: a field that is not a finite number (missing, "", NaN, Infinity) is no number at all, never a NaN row marked ok. */
const finiteOrNull = (v: number | null): number | null => (v !== null && Number.isFinite(v) ? v : null);
const finiteRate = (r: VenueRate): VenueRate => {
  const c = { ...r, supplyPct: finiteOrNull(r.supplyPct), rewardsPct: finiteOrNull(r.rewardsPct), utilizationPct: finiteOrNull(r.utilizationPct), withdrawableUsd: finiteOrNull(r.withdrawableUsd), tvlUsd: finiteOrNull(r.tvlUsd) };
  return c.supplyPct === null && r.supplyPct !== null ? { ...c, note: "rate unreadable" } : c;
};
/** Review I4: a body of the wrong shape (a 200 with an error object) marks only that venue's row no data, never the whole snapshot. */
const parsedOr = (venue: Venue, asset: LendAsset, json: unknown, parse: (j: unknown) => VenueRate): VenueRate => {
  if (json === null) return blank(venue, asset, "API failed");
  try {
    return finiteRate(parse(json));
  } catch (e) {
    console.error(`venue parse failed (${venue} ${asset}): ${e instanceof Error ? e.message : String(e)}`);
    return blank(venue, asset, "API shape changed");
  }
};

const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => { try { return await fn(); } catch (e) { console.error(`venue read failed: ${e instanceof Error ? e.message : String(e)}`); return null; } };

/** Spec 3/4: today's numbers per venue per asset, our own 7-day average, code eligibility. Run before the coin snapshot and the manager. */
export async function snapshotVenues(a: { repo: Repo; now: Date; reads: VenueReads }): Promise<VenueDayRow[]> {
  const day = dayOf(a.now);
  const [kamino, jup, vault, lulo] = await Promise.all([safe(a.reads.kaminoReserves), safe(a.reads.jupiterEarn), safe(a.reads.kaminoVault), safe(a.reads.luloRates)]);
  const rates: VenueRate[] = [];
  for (const asset of ["USDC_LEND", "SOL_LEND"] as const) {
    rates.push(parsedOr("kamino_klend", asset, kamino, (j) => parseKaminoReserves(j, asset)));
    rates.push(parsedOr("jupiter_lend", asset, jup, (j) => parseJupiterEarn(j, asset)));
  }
  rates.push(parsedOr("kamino_sm_vault", "USDC_LEND", vault, parseKaminoVault));
  rates.push(blank("marginfi", "USDC_LEND", "rate unavailable"));
  rates.push(parsedOr("lulo_protected", "USDC_LEND", lulo, parseLulo));
  const existing = await a.repo.listVenueDays(day);
  const out: VenueDayRow[] = [];
  for (const r of rates) {
    const ok = r.supplyPct !== null;
    const rawRate = isAutoVenue(r.venue) && ok ? await safe(() => a.reads.exchangeRate(r.venue as AutoVenue, r.asset)) : null;
    const exchangeRate = rawRate !== null && Number.isFinite(rawRate) && rawRate > 0 ? rawRate : null;
    const history = (await a.repo.listVenueHistory(r.venue, r.asset, addDays(day, -6))).filter((h) => h.day !== day);
    const { avg7Pct, daysMeasured } = avg7([...history, { supplyPct: r.supplyPct, ok }]);
    const prev = existing.find((e) => e.venue === r.venue && e.asset === r.asset);
    const row: VenueDayRow = {
      day, venue: r.venue, asset: r.asset, supplyPct: r.supplyPct, rewardsPct: r.rewardsPct, utilizationPct: r.utilizationPct, withdrawableUsd: r.withdrawableUsd, tvlUsd: r.tvlUsd,
      exchangeRate, avg7Pct, daysMeasured, eligible: isAutoVenue(r.venue) && ok && exchangeRate !== null && eligibleVenue(r),
      verdict: prev?.verdict ?? null, reason: prev?.reason ?? null, served: prev?.served ?? null, ok,
    };
    await a.repo.putVenueDay(row);
    out.push(row);
  }
  return out;
}

/** The get_venue_rates tool (contracts 5.1): today's snapshotted numbers for one venue, exactly what is stored and served. */
export async function getVenueRates(repo: Repo, day: string, venue: Venue): Promise<ServedRate[]> {
  return (await repo.listVenueDays(day)).filter((r) => r.venue === venue).sort((p, q) => (p.asset === q.asset ? 0 : p.asset === "USDC_LEND" ? -1 : 1))
    .map((r) => ({ asset: r.asset, supplyPct: r.supplyPct, rewardsPct: r.rewardsPct, utilizationPct: r.utilizationPct, withdrawableUsd: r.withdrawableUsd, tvlUsd: r.tvlUsd, avg7Pct: r.avg7Pct, daysMeasured: r.daysMeasured }));
}

const EXCLUDED = ["save", "solend", "drift", "carrot", "loopscale"];   // R267, hacked (spec 3)
const SCOUT_MIN_TVL = 10_000_000;
/** The scout_yields tool: DefiLlama filtered in code before the model sees anything; display only, never routed to (R278). */
export async function scoutYields(reads: VenueReads): Promise<FoundPool[]> {
  const pools = ((await reads.llamaPools()) as { data: { pool: string; chain: string; project: string; symbol: string; tvlUsd: number; apyBase: number | null; exposure: string }[] }).data;
  return pools
    .filter((p) => p.chain === "Solana" && p.exposure === "single" && (p.symbol === "USDC" || p.symbol === "SOL") && typeof p.apyBase === "number" && p.tvlUsd >= SCOUT_MIN_TVL && !EXCLUDED.some((x) => p.project.toLowerCase().includes(x)))
    .sort((p, q) => (q.apyBase as number) - (p.apyBase as number))
    .slice(0, 10)
    .map((p) => ({ poolId: p.pool, project: p.project, symbol: p.symbol, asset: p.symbol as "USDC" | "SOL", apyBasePct: p.apyBase as number, tvlUsd: p.tvlUsd }));
}

const getJson = async (url: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url.split("?")[0]} answered ${res.status}`);
  return res.json();
};
export function realVenueReads(): VenueReads {
  return {
    kaminoReserves: () => getJson(`https://api.kamino.finance/kamino-market/${KLEND_MARKET}/reserves/metrics`),
    jupiterEarn: () => getJson("https://api.jup.ag/lend/v1/earn/tokens", { "x-api-key": config().jupiterApiKey }),
    kaminoVault: () => getJson(`https://api.kamino.finance/kvaults/${SM_VAULT}/metrics`),
    luloRates: () => getJson("https://api.lulo.fi/v1/rates.getRates"),
    exchangeRate: async (venue, asset) => { const r = venue === "kamino_klend" ? await klendRate(asset) : await jlendRate(asset); return Number(r.rn) / Number(r.rd); },
    llamaPools: () => getJson("https://yields.llama.fi/pools"),
  };
}
