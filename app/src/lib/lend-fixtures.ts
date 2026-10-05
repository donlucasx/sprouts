import type { ActivityResponse, Holding, LendingPosition, LendSign, MeResponse, MoveProposal, VenuesResponse } from "./api";

/**
 * Contract-shaped data (contracts 5.1 to 5.7) for tests and the dev mock. Numbers are illustrative, chosen to be consistent with each
 * other (the aggregated holding is the positions summed); receipt mints are the real ones (contracts 1.4). Never shown in a release build.
 */
export const FIXTURE_TERMS_VERSION = "2026-10-06";
export const FIXTURE_POSITIONS: LendingPosition[] = [
  { asset: "USDC_LEND", venue: "kamino_klend", receiptMint: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D", receiptRaw: "1661200", underlyingRaw: "1999752", valueUsd: 2.0, ratePct: 4.43, avg7Pct: 4.41, earnedUsd: 0.02, putInCents: 200, withdrawableUsd: 12_000_000, poolFull: false },
  { asset: "USDC_LEND", venue: "jupiter_lend", receiptMint: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", receiptRaw: "940000", underlyingRaw: "999140", valueUsd: 1.0, ratePct: 3.83, avg7Pct: 3.9, earnedUsd: 0.0004, putInCents: 100, withdrawableUsd: 0, poolFull: true },
  { asset: "SOL_LEND", venue: "jupiter_lend", receiptMint: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", receiptRaw: "9408000", underlyingRaw: "9999904", valueUsd: 1.5, ratePct: 3.87, avg7Pct: 3.9, earnedUsd: 0.0004, putInCents: 150, withdrawableUsd: 8_000_000, poolFull: false },
];
export const FIXTURE_LEND_HOLDINGS: Holding[] = [
  { asset: "USDC_LEND", heldRaw: "2998892", putInCents: 300, valueUsd: 3.0, earnedUsd: 0.0204, earnedUnderlyingRaw: "20400" },
  { asset: "SOL_LEND", heldRaw: "9999904", putInCents: 150, valueUsd: 1.5, earnedUsd: 0.0004, earnedUnderlyingRaw: "2600" },
];
export const FIXTURE_LEND_SIGNS: Partial<Record<"USDC_LEND" | "SOL_LEND", LendSign | null>> = {
  USDC_LEND: { line1: "USDC", line2: "Kamino 4.4%", venue: "kamino_klend", ratePct: 4.43 },
  SOL_LEND: { line1: "SOL", line2: "Jupiter 3.9%", venue: "jupiter_lend", ratePct: 3.87 },
};
export const FIXTURE_MOVE: MoveProposal = { id: "mock-move-1", ts: "2026-10-06T15:00:00.000Z", asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: "940000", valueUsd: 1.0, fromAvg7Pct: 3.9, toAvg7Pct: 4.41, gain30dUsd: 0.04, costUsd: 0.01 };
export const FIXTURE_VENUES: VenuesResponse = {
  day: "2026-10-05",
  venues: [
    { venue: "kamino_klend", asset: "USDC_LEND", name: "Kamino", auto: true, supplyPct: 4.43, rewardsPct: 0, avg7Pct: 4.41, daysMeasured: 7, utilizationPct: 91, tvlUsd: 120_000_000, withdrawableUsd: 12_000_000, eligible: true, verdict: "ok", reason: null, picked: true, note: null },
    { venue: "jupiter_lend", asset: "USDC_LEND", name: "Jupiter", auto: true, supplyPct: 3.83, rewardsPct: 0.36, avg7Pct: 3.9, daysMeasured: 7, utilizationPct: 88, tvlUsd: 400_000_000, withdrawableUsd: 40_000_000, eligible: true, verdict: "ok", reason: null, picked: false, note: null },
    { venue: "kamino_klend", asset: "SOL_LEND", name: "Kamino", auto: true, supplyPct: 5.62, rewardsPct: 0, avg7Pct: 5.5, daysMeasured: 7, utilizationPct: 94, tvlUsd: 900_000_000, withdrawableUsd: 50_000_000, eligible: true, verdict: "avoid", reason: "near_full", picked: false, note: null },
    { venue: "jupiter_lend", asset: "SOL_LEND", name: "Jupiter", auto: true, supplyPct: 3.87, rewardsPct: 0, avg7Pct: 3.9, daysMeasured: 7, utilizationPct: 80, tvlUsd: 300_000_000, withdrawableUsd: 60_000_000, eligible: true, verdict: "ok", reason: null, picked: true, note: null },
    { venue: "kamino_sm_vault", asset: "USDC_LEND", name: "Kamino SM Vault", auto: false, supplyPct: 2.96, rewardsPct: 1.21, avg7Pct: null, daysMeasured: 1, utilizationPct: null, tvlUsd: 15_000_000, withdrawableUsd: null, eligible: false, verdict: null, reason: null, picked: false, note: null },
    { venue: "marginfi", asset: "USDC_LEND", name: "marginfi", auto: false, supplyPct: null, rewardsPct: null, avg7Pct: null, daysMeasured: 0, utilizationPct: null, tvlUsd: null, withdrawableUsd: null, eligible: false, verdict: null, reason: null, picked: false, note: "rate unavailable" },
    { venue: "lulo_protected", asset: "USDC_LEND", name: "Lulo Protected", auto: false, supplyPct: 5.1, rewardsPct: null, avg7Pct: null, daysMeasured: 1, utilizationPct: null, tvlUsd: null, withdrawableUsd: null, eligible: false, verdict: null, reason: null, picked: false, note: null },
  ],
  picks: { USDC_LEND: "kamino_klend", SOL_LEND: "jupiter_lend" },
  why: "Your USDC goes to Kamino, 4.43% vs Jupiter 4.19%; Jupiter's 0.36 is rewards.",
  found: [{ day: "2026-10-05", project: "Fixture Venue", symbol: "USDC", asset: "USDC", apyBasePct: 6.1, tvlUsd: 25_000_000, note: "A higher base rate this week; not on the list Sprouts lends to." }],
};
const DAY = 86_400_000;
export const FIXTURE_ACTIVITY: Required<Pick<ActivityResponse, "lendWithdrawals" | "moves" | "found">> & { plantings: ActivityResponse["plantings"] } = {
  plantings: [
    { id: "mock-a1", ts: "2026-10-05T15:00:00.000Z", status: "confirmed", signature: null, usdcPulledCents: 200, networkFeeCents: 0,
      legs: [{ asset: "USDC_LEND", usdcInCents: 200, amountOutRaw: "1661200", feeCents: 0, feeAmountRaw: "0", usdPrice: 1, venue: "kamino_klend" }] },
  ],
  lendWithdrawals: [{ ts: "2026-10-05T18:00:00.000Z", asset: "SOL_LEND", venue: "jupiter_lend", receiptRaw: "940800", underlyingRaw: "1000000", signature: "mockSig1" }],
  moves: [{ ts: "2026-10-05T19:00:00.000Z", asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: "940000", status: "dismissed" }],
  found: FIXTURE_VENUES.found,
};

/** The real read with the lending fields filled (the dev mock and the device checks). Lending plants appear through two plantings. */
export function mockMe(real: MeResponse, now: Date, o: { move: boolean; termsAccepted: boolean }): MeResponse {
  const ago = (d: number) => new Date(now.getTime() - d * DAY).toISOString();
  return {
    ...real,
    holdings: [...real.holdings.filter((h) => h.asset !== "USDC_LEND" && h.asset !== "SOL_LEND"), ...FIXTURE_LEND_HOLDINGS],
    positions: FIXTURE_POSITIONS,
    lendSigns: FIXTURE_LEND_SIGNS,
    history: {
      ...real.history,
      plantings: [
        ...real.history.plantings,
        { id: "mock-usdc-1", ts: ago(2), asset: "USDC_LEND", usdcInCents: 200, amountOutRaw: "1661200", feeCents: 0, signature: null, venue: "kamino_klend" },
        { id: "mock-sol-1", ts: ago(3), asset: "SOL_LEND", usdcInCents: 150, amountOutRaw: "9408000", feeCents: 0, signature: null, venue: "jupiter_lend" },
      ],
    },
    rules: { ...real.rules, allocation: { SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 } },
    manager: { ...real.manager, picks: FIXTURE_VENUES.picks, legsEnabled: null },
    relink: { needed: true, wallets: [{ pubkey: real.user.pubkey, via: "app" }] },
    terms: { currentVersion: FIXTURE_TERMS_VERSION, acceptedVersion: o.termsAccepted ? FIXTURE_TERMS_VERSION : null },
    moveProposal: o.move ? FIXTURE_MOVE : null,
  };
}
