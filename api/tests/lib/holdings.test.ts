import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { holdingsFrom, latestCoinDays } from "@/lib/holdings";
import type { CoinDayRow, PlantingLegRow } from "@/db/types";

const day = (asset: CoinDayRow["asset"], rate: number | null, priceUsd: number): CoinDayRow => ({ day: "2026-10-04", asset, rate, ratePrev: null, ratePrevDays: null, priceUsd, liquidityUsd: null, priceChange24h: null, tradeable: true, lastUpdateEpoch: 1047, ok: true });
const leg = (asset: PlantingLegRow["asset"], usdcInCents: number, amountOutRaw: bigint, rateAtPlanting: number | null): PlantingLegRow => ({ plantingId: "p", asset, usdcInCents, amountOutRaw, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting });

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
    const rows = holdingsFrom({ held: { cbBTC: 2389n, JupSOL: 14_000_000n, stORE: 0n }, legs: [leg("cbBTC", 200, 2389n, null)], days: { cbBTC: day("cbBTC", null, 83600) } });
    expect(rows.map((r) => r.asset)).toEqual(["JupSOL", "cbBTC"]);
    const btc = rows.find((r) => r.asset === "cbBTC")!;
    expect(btc.valueUsd).toBeCloseTo(1.997, 2);
    expect(btc.earnedUsd).toBeNull();
    const jup = rows.find((r) => r.asset === "JupSOL")!;
    expect(jup.valueUsd).toBeNull();
    expect(jup.earnedUsd).toBeNull();
  });
});

describe("latestCoinDays", () => {
  it("a failed re-run today does not hide the rate: the rate from the latest good row, the price from the latest priced row", async () => {
    const repo = new MemoryRepo();
    await repo.putCoinDay({ ...day("hSOL", 1.2, 168), day: "2026-10-03" });
    await repo.putCoinDay({ ...day("hSOL", null, 170), day: "2026-10-04", ok: false, tradeable: false });
    await repo.putCoinDay({ ...day("JitoSOL", 1.3, 180), day: "2026-10-03" });
    await repo.putCoinDay({ ...day("JitoSOL", null, 0), priceUsd: null, day: "2026-10-04", ok: false });
    const d = await latestCoinDays(repo, "2026-10-04");
    expect(d.hSOL?.rate).toBe(1.2);
    expect(d.hSOL?.priceUsd).toBe(170);
    expect(d.JitoSOL?.rate).toBe(1.3);
    expect(d.JitoSOL?.priceUsd).toBe(180);
    const [h] = holdingsFrom({ held: { hSOL: 1_000_000_000n }, legs: [leg("hSOL", 200, 1_000_000_000n, 1.18)], days: d });
    expect(h.earnedUsd).not.toBeNull();
  });
});
