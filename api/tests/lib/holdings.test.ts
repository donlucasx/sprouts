import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { holdingsFrom, latestCoinDays, rateFacts } from "@/lib/holdings";
import type { CoinDayRow, PlantingLegRow } from "@/db/types";

const day = (asset: CoinDayRow["asset"], rate: number | null, priceUsd: number): CoinDayRow => ({ day: "2026-10-04", asset, rate, ratePrev: null, ratePrevDays: null, priceUsd, liquidityUsd: null, priceChange24h: null, tradeable: true, lastUpdateEpoch: 1047, ok: true });
const leg = (asset: PlantingLegRow["asset"], usdcInCents: number, amountOutRaw: bigint, rateAtPlanting: number | null): PlantingLegRow => ({ plantingId: "p", asset, usdcInCents, amountOutRaw, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting, venue: null });

// Spec 7.6: value from the balance and today's price; earned from each leg's amount times the rate's rise since planting, in the
// coin's underlying (SOL or ORE), priced at today's underlying price derived from the coin's own price over its rate.
describe("holdingsFrom", () => {
  it("values a held coin and computes earned from the rate delta", () => {
    const [h] = holdingsFrom({
      held: { hSOL: 2_000_000_000n },
      legs: [leg("hSOL", 200, 1_000_000_000n, 1.18), leg("hSOL", 200, 1_000_000_000n, null)],
      days: { hSOL: day("hSOL", 1.20, 168) },     // SOL at 140: 168 / 1.2
    });
    expect(h.asset).toBe("hSOL");
    expect(h.putInCents).toBe(400);
    expect(h.valueUsd).toBeCloseTo(336, 6);
    expect(Number(h.earnedUnderlyingRaw) / 1e9).toBeCloseTo(0.02, 9);   // 1 hSOL grew 0.02 SOL; the null-rate leg counts 0
    expect(h.earnedUsd).toBeCloseTo(2.8, 6);                             // 0.02 SOL at 140
  });
  it("cbBTC has value but no earned; a coin without a price has neither; zero balances are omitted", () => {
    const rows = holdingsFrom({ held: { cbBTC: 2389n, hSOL: 14_000_000n, stORE: 0n }, legs: [leg("cbBTC", 200, 2389n, null)], days: { cbBTC: day("cbBTC", null, 83600) } });
    expect(rows.map((r) => r.asset)).toEqual(["hSOL", "cbBTC"]);
    const btc = rows.find((r) => r.asset === "cbBTC")!;
    expect(btc.valueUsd).toBeCloseTo(1.997, 2);
    expect(btc.earnedUsd).toBeNull();
    const sol = rows.find((r) => r.asset === "hSOL")!;
    expect(sol.valueUsd).toBeNull();
    expect(sol.earnedUsd).toBeNull();
  });
  it("a coin half sold keeps half its basis (R159): put in and earned follow the fraction still held; more than planted caps at 1", () => {
    const legs = [leg("hSOL", 200, 1_000_000_000n, 1.18), leg("hSOL", 200, 1_000_000_000n, 1.18)];
    const days = { hSOL: day("hSOL", 1.20, 168) };
    const [whole] = holdingsFrom({ held: { hSOL: 2_000_000_000n }, legs, days });
    const [half] = holdingsFrom({ held: { hSOL: 1_000_000_000n }, legs, days });
    const [more] = holdingsFrom({ held: { hSOL: 3_000_000_000n }, legs, days });
    expect(half.putInCents).toBe(200);
    expect(half.earnedUsd).toBeCloseTo((whole.earnedUsd as number) / 2, 9);
    expect(Number(half.earnedUnderlyingRaw)).toBeCloseTo(Number(whole.earnedUnderlyingRaw) / 2, -2);
    expect(more.putInCents).toBe(400);
    expect(more.earnedUsd).toBeCloseTo(whole.earnedUsd as number, 9);
  });
});

describe("latestCoinDays", () => {
  it("a failed re-run today does not hide the rate: the rate from the latest good row, the price from the latest priced row", async () => {
    const repo = new MemoryRepo();
    await repo.putCoinDay({ ...day("hSOL", 1.2, 168), day: "2026-10-03" });
    await repo.putCoinDay({ ...day("hSOL", null, 170), day: "2026-10-04", ok: false, tradeable: false });
    await repo.putCoinDay({ ...day("stORE", 1.3, 180), day: "2026-10-03" });
    await repo.putCoinDay({ ...day("stORE", null, 0), priceUsd: null, day: "2026-10-04", ok: false });
    const d = await latestCoinDays(repo, "2026-10-04");
    expect(d.hSOL?.rate).toBe(1.2);
    expect(d.hSOL?.priceUsd).toBe(170);
    expect(d.stORE?.rate).toBe(1.3);
    expect(d.stORE?.priceUsd).toBe(180);
    const [h] = holdingsFrom({ held: { hSOL: 1_000_000_000n }, legs: [leg("hSOL", 200, 1_000_000_000n, 1.18)], days: d });
    expect(h.earnedUsd).not.toBeNull();
  });
});

// R192: a leg planted before snapshots began counts from the coin's first recorded rate; R194: the week's measured growth rides along.
describe("rateFacts", () => {
  it("gives each rated coin its first good rate and its measured growth; cbBTC has none; a null-rate leg counts from the first rate", async () => {
    const repo = new MemoryRepo();
    await repo.putCoinDay({ ...day("stORE", null, 110), day: "2026-09-30", ok: false });
    await repo.putCoinDay({ ...day("stORE", 1.049906576, 116), day: "2026-10-01" });
    await repo.putCoinDay({ ...day("stORE", 1.050113682, 122), day: "2026-10-02" });
    const f = await rateFacts(repo, "2026-10-02");
    expect(f.stORE?.firstRate).toBe(1.049906576);
    expect(f.stORE?.growthPct).toBeCloseTo(7.46, 1);   // one day of the production rows, annualised
    expect(f.cbBTC).toBeUndefined();
    expect(f.hSOL).toEqual({ firstRate: null, growthPct: null });
    const days = { stORE: { ...day("stORE", 1.050113682, 122), day: "2026-10-02" } };
    const [h] = holdingsFrom({ held: { stORE: 100_000_000_000n }, legs: [leg("stORE", 100, 100_000_000_000n, null)], days, facts: f });
    expect(Number(h.earnedUnderlyingRaw) / 1e11).toBeCloseTo(1.050113682 - 1.049906576, 9);
    expect(h.growthPct).toBeCloseTo(7.46, 1);
    const [none] = holdingsFrom({ held: { stORE: 100_000_000_000n }, legs: [leg("stORE", 100, 100_000_000_000n, null)], days });
    expect(none.earnedUnderlyingRaw).toBe(0n);   // without the facts, the old rule: a null-rate leg counts 0
    expect(none.growthPct).toBeNull();
  });
});

import { lendingFrom, lendHoldings, latestVenueRows } from "@/lib/holdings";
import type { VenueDayRow } from "@/db/types";

describe("lending value and earned (spec 8)", () => {
  const vrow = (over: Partial<VenueDayRow> = {}): VenueDayRow => ({ day: "2026-10-06", venue: "kamino_klend", asset: "USDC_LEND", supplyPct: 4.43, rewardsPct: 0, utilizationPct: 91, withdrawableUsd: 10_698_638, tvlUsd: 1.2e8, exchangeRate: 1.205, avg7Pct: 4.4, daysMeasured: 2, eligible: true, verdict: null, reason: null, served: null, ok: true, ...over });
  const lendLeg = (amountOutRaw: bigint, rateAtPlanting: number | null): PlantingLegRow => ({ plantingId: "p", asset: "USDC_LEND", venue: "kamino_klend", usdcInCents: 200, amountOutRaw, staked: false, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting });

  it("value = receipt x exchange rate x price; earned = receipt x (rate now - rate at planting)", () => {
    const [p] = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 1_661_072n }], legs: [lendLeg(1_661_072n, 1.2038)], rows: [vrow()], prices: { USDC_LEND: 1 } });
    expect(p.underlyingRaw).toBe(2_001_591n);   // 1_661_072 x 1.205 = 2_001_591.76
    expect(p.valueUsd).toBeCloseTo(2.001591, 6);
    expect(p.earnedUsd).toBeCloseTo(0.0019933, 7);   // 1.661072 x 0.0012
    expect(p).toMatchObject({ receiptMint: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D", ratePct: 4.43, avg7Pct: 4.4, putInCents: 200, poolFull: false });
  });
  it("half withdrawn keeps half the basis; a full pool says so; no price, no value", () => {
    const [half] = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 830_536n }], legs: [lendLeg(1_661_072n, 1.2038)], rows: [vrow({ withdrawableUsd: 0.5 })], prices: { USDC_LEND: 1 } });
    expect(half.putInCents).toBe(100);
    expect(half.poolFull).toBe(true);
    const [none] = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 830_536n }], legs: [], rows: [vrow()], prices: {} });
    expect(none.valueUsd).toBeNull();
  });
  it("R359: a partial withdrawal (the receipt read from chain drops) reduces Put in and Earned in proportion; the position stays", () => {
    const legs = [lendLeg(1_000_000n, 1.2), lendLeg(661_072n, 1.2038)];
    const args = { legs, rows: [vrow()], prices: { USDC_LEND: 1 } };
    const [whole] = lendingFrom({ ...args, positions: [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 1_661_072n }] });
    const [part] = lendingFrom({ ...args, positions: [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 415_268n }] });   // a quarter left
    expect(whole.putInCents).toBe(400);
    expect(part.putInCents).toBe(100);
    expect(part.earnedUsd! / whole.earnedUsd!).toBeCloseTo(0.25, 6);
    expect(part.underlyingRaw).toBe(500_397n);   // 415_268 x 1.205
    const [h] = lendHoldings([part]);
    expect(h).toMatchObject({ asset: "USDC_LEND", heldRaw: 500_397n, putInCents: 100 });
  });
  it("one aggregated holding per lending asset, underlying summed", () => {
    const ps = lendingFrom({
      positions: [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 1_000_000n }, { asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 1_000_000n }],
      legs: [], rows: [vrow(), vrow({ venue: "jupiter_lend", exchangeRate: 1.0629, avg7Pct: 4.19 })], prices: { USDC_LEND: 1 },
    });
    const [h] = lendHoldings(ps);
    expect(h).toMatchObject({ asset: "USDC_LEND", heldRaw: 2_267_900n, growthPct: 4.4 });
    expect(h.valueUsd).toBeCloseTo(2.2679, 4);
  });
  it("Kamino SOL: receipt 6 dp, underlying lamports 9 dp; the rate is raw per raw, so value uses the underlying's decimals", () => {
    const [p] = lendingFrom({ positions: [{ asset: "SOL_LEND", venue: "kamino_klend", receiptRaw: 1_000_000n }], legs: [], rows: [vrow({ asset: "SOL_LEND", exchangeRate: 1100.5 })], prices: { SOL_LEND: 150 } });
    expect(p.underlyingRaw).toBe(1_100_500_000n);
    expect(p.valueUsd).toBeCloseTo(165.075, 6);
  });
  it("no rated snapshot in 7 days: underlying at the highest rate at planting (understates, never 0 for a funded position); no value; no legs with a rate, 0 (I1)", () => {
    const legs = [lendLeg(1_000_000n, 1.2038), lendLeg(661_072n, 1.205), lendLeg(1n, null)];
    const [p] = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 1_661_072n }], legs, rows: [], prices: { USDC_LEND: 1 } });
    expect(p.underlyingRaw).toBe(2_001_591n);   // 1_661_072 x 1.205 (the higher planting rate)
    expect(p).toMatchObject({ valueUsd: null, earnedUsd: null, earnedUnderlyingRaw: null, poolFull: false, ratePct: null });
    const [none] = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 1_661_072n }], legs: [lendLeg(1_661_072n, null)], rows: [], prices: { USDC_LEND: 1 } });
    expect(none.underlyingRaw).toBe(0n);
    const [rated] = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 1_661_072n }], legs, rows: [vrow({ exchangeRate: 1.21 })], prices: { USDC_LEND: 1 } });
    expect(rated.underlyingRaw).toBe(2_009_897n);   // a snapshot's rate wins over the planting fallback: 1_661_072 x 1.21
  });
  it("latestVenueRows: a failed snapshot today keeps yesterday's exchange rate; rows older than 7 days are dropped", async () => {
    const repo = new MemoryRepo();
    await repo.putVenueDay(vrow({ day: "2026-10-05", exchangeRate: 1.2 }));
    await repo.putVenueDay(vrow({ day: "2026-10-06", exchangeRate: null, supplyPct: 4.5 }));
    await repo.putVenueDay(vrow({ day: "2026-09-20", venue: "jupiter_lend", exchangeRate: 1.05 }));
    const rows = await latestVenueRows(repo, "2026-10-06");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: "2026-10-06", supplyPct: 4.5, exchangeRate: 1.2 });
  });
});
