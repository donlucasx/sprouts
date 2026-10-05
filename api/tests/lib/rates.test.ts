import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { parseKaminoReserves, parseJupiterEarn, parseKaminoVault, parseLulo, snapshotVenues, getVenueRates, scoutYields, type VenueReads } from "@/lib/venues/rates";

const NOW = new Date("2026-10-05T14:00:00Z");
const KAMINO = [
  { reserve: "AWnKJ9dsiHcoDCThxE5E93ikDTAXkApoNwrKM2tp9KFJ", supplyApy: "0.0862", totalSupplyUsd: "104", totalBorrowUsd: "90" },
  { reserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59", supplyApy: "0.0443", totalSupplyUsd: "120898638", totalBorrowUsd: "110200000" },
  { reserve: "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q", supplyApy: "0.0562", totalSupplyUsd: "280000000", totalBorrowUsd: "255000000" },
];
const JUP = [
  { address: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", asset: { decimals: 6, price: "0.999971332333" }, supplyRate: "383", rewardsRate: "36", totalAssets: "505029240765044", liquiditySupplyData: { withdrawable: "69558178691773" } },
  { address: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", asset: { decimals: 9, price: "121.47" }, supplyRate: "387", rewardsRate: "0", totalAssets: "900000000000000", liquiditySupplyData: { withdrawable: "300000000000000" } },
];
const VAULT = { apy: "0.04208083976517085", apyActual: "0.029898874868728997", tokensAvailableUsd: "446839.99087363747092", tokensInvestedUsd: "1214507.6836710020795" };
const LULO = { regular: { CURRENT: 6.62 }, protected: { CURRENT: 3.855986894226174 } };
const LLAMA = { data: [
  { pool: "525b2dab-ea6a-4cbc-a07f-84ce561d1f83", chain: "Solana", project: "kamino-lend", symbol: "SOL", tvlUsd: 25399214, apyBase: 5.6418, exposure: "single" },
  { pool: "s1", chain: "Solana", project: "save", symbol: "USDC", tvlUsd: 50000000, apyBase: 9, exposure: "single" },
  { pool: "s2", chain: "Solana", project: "credix", symbol: "USDC", tvlUsd: 13406766, apyBase: 0.07463, exposure: "single" },
  { pool: "s3", chain: "Solana", project: "x", symbol: "USDC", tvlUsd: 9_000_000, apyBase: 7, exposure: "single" },
  { pool: "s4", chain: "Ethereum", project: "aave-v3", symbol: "USDC", tvlUsd: 1e9, apyBase: 5, exposure: "single" },
  { pool: "s5", chain: "Solana", project: "orca", symbol: "SOL-USDC", tvlUsd: 1e8, apyBase: 20, exposure: "multi" },
  { pool: "s6", chain: "Solana", project: "drift-staked", symbol: "SOL", tvlUsd: 1e8, apyBase: 8, exposure: "single" },
] };
const reads = (over: Partial<VenueReads> = {}): VenueReads => ({
  kaminoReserves: async () => KAMINO, jupiterEarn: async () => JUP, kaminoVault: async () => VAULT, luloRates: async () => LULO,
  exchangeRate: async (venue) => (venue === "kamino_klend" ? 1.2038 : 1.0629), llamaPools: async () => LLAMA, ...over,
});

describe("venue parsers (pinned instruments only)", () => {
  it("Kamino reads the pinned reserve, never the 8.62% dust reserve", () => {
    expect(parseKaminoReserves(KAMINO, "USDC_LEND")).toEqual({ venue: "kamino_klend", asset: "USDC_LEND", supplyPct: 4.43, rewardsPct: 0, utilizationPct: expect.closeTo(91.1507, 3), withdrawableUsd: 10_698_638, tvlUsd: 120_898_638, note: null });
    expect(parseKaminoReserves([KAMINO[0]], "USDC_LEND").supplyPct).toBeNull();
  });
  it("Jupiter: bps to %, rewards apart, utilization = what cannot be withdrawn now", () => {
    const r = parseJupiterEarn(JUP, "USDC_LEND");
    expect(r).toMatchObject({ venue: "jupiter_lend", supplyPct: 3.83, rewardsPct: 0.36 });
    expect(r.utilizationPct).toBeCloseTo(86.227, 2);
    expect(r.tvlUsd).toBeCloseTo(505_014_762.75, 0);
    expect(r.withdrawableUsd).toBeCloseTo(69_556_184.62, 0);
  });
  it("the SM vault's real rate (apyActual), Lulo Protected's current rate", () => {
    expect(parseKaminoVault(VAULT)).toMatchObject({ venue: "kamino_sm_vault", asset: "USDC_LEND", supplyPct: expect.closeTo(2.99, 2), withdrawableUsd: expect.closeTo(446_839.99, 1), tvlUsd: expect.closeTo(1_661_347.67, 1) });
    expect(parseLulo(LULO)).toMatchObject({ venue: "lulo_protected", asset: "USDC_LEND", supplyPct: expect.closeTo(3.856, 3) });
  });
});

describe("snapshotVenues (one row per venue per asset per day)", () => {
  it("writes the auto venues for both assets and the three table venues for USDC, with exchange rates and eligibility", async () => {
    const repo = new MemoryRepo();
    const rows = await snapshotVenues({ repo, now: NOW, reads: reads() });
    expect(rows.length).toBe(7);
    const k = rows.find((r) => r.venue === "kamino_klend" && r.asset === "USDC_LEND")!;
    expect(k).toMatchObject({ day: "2026-10-05", supplyPct: 4.43, exchangeRate: 1.2038, avg7Pct: 4.43, daysMeasured: 1, eligible: true, ok: true, verdict: null });
    expect(rows.find((r) => r.venue === "marginfi")).toMatchObject({ supplyPct: null, ok: false, eligible: false });
    expect(rows.find((r) => r.venue === "kamino_sm_vault")!.eligible).toBe(false);   // table only, never routed to
  });
  it("one source failing marks only its rows no data; avg7 uses our own history", async () => {
    const repo = new MemoryRepo();
    await repo.putVenueDay({ day: "2026-10-04", venue: "kamino_klend", asset: "USDC_LEND", supplyPct: 4.53, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1, tvlUsd: 1.2e8, exchangeRate: 1.2037, avg7Pct: 4.53, daysMeasured: 1, eligible: true, verdict: null, reason: null, served: null, ok: true });
    const rows = await snapshotVenues({ repo, now: NOW, reads: reads({ jupiterEarn: async () => { throw new Error("502"); } }) });
    expect(rows.find((r) => r.venue === "jupiter_lend" && r.asset === "USDC_LEND")).toMatchObject({ ok: false, eligible: false });
    expect(rows.find((r) => r.venue === "kamino_klend" && r.asset === "USDC_LEND")).toMatchObject({ avg7Pct: 4.48, daysMeasured: 2 });
  });
  it("a second run the same day keeps the AI's verdict and what it was served", async () => {
    const repo = new MemoryRepo();
    await snapshotVenues({ repo, now: NOW, reads: reads() });
    const k = (await repo.listVenueDays("2026-10-05")).find((r) => r.venue === "jupiter_lend" && r.asset === "USDC_LEND")!;
    await repo.putVenueDay({ ...k, verdict: "avoid", reason: "incentive_spike", served: [{ x: 1 }] });
    await snapshotVenues({ repo, now: NOW, reads: reads() });
    expect((await repo.listVenueDays("2026-10-05")).find((r) => r.venue === "jupiter_lend" && r.asset === "USDC_LEND")).toMatchObject({ verdict: "avoid", reason: "incentive_spike", served: [{ x: 1 }] });
  });
  it("getVenueRates serves today's rows for one venue in the tool's shape", async () => {
    const repo = new MemoryRepo();
    await snapshotVenues({ repo, now: NOW, reads: reads() });
    expect(await getVenueRates(repo, "2026-10-05", "kamino_klend")).toEqual([
      { asset: "USDC_LEND", supplyPct: 4.43, rewardsPct: 0, utilizationPct: expect.closeTo(91.15, 2), withdrawableUsd: 10_698_638, tvlUsd: 120_898_638, avg7Pct: 4.43, daysMeasured: 1 },
      { asset: "SOL_LEND", supplyPct: 5.62, rewardsPct: 0, utilizationPct: expect.closeTo(91.07, 2), withdrawableUsd: 25_000_000, tvlUsd: 280_000_000, avg7Pct: 5.62, daysMeasured: 1 },
    ]);
  });
});

describe("scoutYields (filtered in code, Kimi round 2 #10, Claude F15)", () => {
  it("Solana, single exposure, USDC or SOL, apyBase, TVL >= $10M, never the excluded protocols; best first", async () => {
    expect(await scoutYields(reads())).toEqual([
      { poolId: "525b2dab-ea6a-4cbc-a07f-84ce561d1f83", project: "kamino-lend", symbol: "SOL", asset: "SOL", apyBasePct: 5.6418, tvlUsd: 25_399_214 },
      { poolId: "s2", project: "credix", symbol: "USDC", asset: "USDC", apyBasePct: 0.07463, tvlUsd: 13_406_766 },
    ]);
  });
});
