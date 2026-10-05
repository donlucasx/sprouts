import { describe, it, expect } from "vitest";
import { address, type Instruction } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { MemoryRepo } from "@/db/memory";
import type { PlantingLegRow, VenueDayRow } from "@/db/types";
import { proposeMoves, moveDepositRaw, carryMoves, type MoveCarry } from "@/lib/moves";
import { lendingFrom } from "@/lib/holdings";
import { buildMove } from "@/lib/venues/user-builders";

const NOW = new Date("2026-10-06T14:00:00Z");
async function repoWith(kaminoAvg: number, jupAvg: number) {
  const repo = new MemoryRepo();
  await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
  for (const [venue, avg, rate] of [["kamino_klend", kaminoAvg, 1.2], ["jupiter_lend", jupAvg, 1.06]] as const) {
    await repo.putVenueDay({ day: "2026-10-06", venue, asset: "USDC_LEND", supplyPct: avg, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: rate, avg7Pct: avg, daysMeasured: 7, eligible: true, verdict: null, reason: null, served: null, ok: true });
  }
  await repo.putCoinDay({ day: "2026-10-06", asset: "USDC_LEND", rate: null, ratePrev: null, ratePrevDays: null, priceUsd: 1, liquidityUsd: null, priceChange24h: null, tradeable: true, lastUpdateEpoch: null, ok: true });
  return repo;
}
describe("proposeMoves (spec 7, R280): only when 30 days of the gap beat 3x the cost; one open card", () => {
  it("a $5,000 position on the lower venue gets one card; a demo-size one never does (no faked card)", async () => {
    const repo = await repoWith(4.43, 4.19);
    // cost at $121.47: (10_000 + 2_039_280) lamports = $0.2489, x3 = $0.7468; $5,000 x 0.24 points x 30/365 = $0.9863 beats it
    const big = await proposeMoves({ repo, now: NOW, positions: async () => [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 4_716_981_132n }], solUsd: 121.47 });   // x 1.06 = $5,000
    expect(big.proposed).toEqual(["U"]);
    expect(await repo.openMoveProposal("U")).toMatchObject({ fromVenue: "jupiter_lend", toVenue: "kamino_klend", gain30dUsd: expect.closeTo(0.9863, 3) });
    const small = await repoWith(4.43, 4.19);
    expect((await proposeMoves({ repo: small, now: NOW, positions: async () => [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 4_716_981n }], solUsd: 121.47 })).proposed).toEqual([]);
  });
  it("an open card that no longer qualifies expires", async () => {
    const repo = await repoWith(4.43, 4.19);
    await proposeMoves({ repo, now: NOW, positions: async () => [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 4_716_981_132n }], solUsd: 121.47 });
    const flipped = await repoWith(4.19, 4.43);
    flipped.moves = repo.moves;
    const r = await proposeMoves({ repo: flipped, now: NOW, positions: async () => [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 4_716_981_132n }], solUsd: 121.47 });
    expect(r.expired.length).toBe(1);
  });
  it("the move_proposed event carries { id, asset, from, to, receiptRaw, status }", async () => {
    const repo = await repoWith(4.43, 4.19);
    await proposeMoves({ repo, now: NOW, positions: async () => [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 4_716_981_132n }], solUsd: 121.47 });
    const open = await repo.openMoveProposal("U");
    expect(repo.events.find((e) => e.kind === "move_proposed")?.detail).toEqual({ id: open!.id, asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: "4716981132", status: "open" });
  });
});

describe("moveDepositRaw: the deposit never exceeds what /api/me serves for the source position (T14 cap) nor 99.9% of the redeem", () => {
  it("99.9% of the expected out when that is under the served position", () => {
    expect(moveDepositRaw({ expectedOutRaw: 2_001_591n, servedUnderlyingRaw: 2_001_591n })).toBe(1_999_589n);   // 2_001_591 x 9990 / 10000
  });
  it("boundary: interest accrued between the snapshot and the build, so the served position caps it (the rest stays in the wallet)", () => {
    // Snapshot rate 1.2000 (served 1_000_000 x 1.2 = 1_200_000); live rate 1.2020 (expected 1_202_000; 99.9% = 1_200_798 > served).
    expect(moveDepositRaw({ expectedOutRaw: 1_202_000n, servedUnderlyingRaw: 1_200_000n })).toBe(1_200_000n);
    // exactly at the boundary: 99.9% of expected == served
    expect(moveDepositRaw({ expectedOutRaw: 1_201_201n, servedUnderlyingRaw: 1_199_999n })).toBe(1_199_999n);
    expect(moveDepositRaw({ expectedOutRaw: 1_201_201n, servedUnderlyingRaw: 1_200_000n })).toBe(1_199_999n);
  });
});

const leg = (p: Partial<PlantingLegRow>): PlantingLegRow => ({ plantingId: "p", asset: "USDC_LEND", usdcInCents: 0, amountOutRaw: 0n, staked: false, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: null, venue: "jupiter_lend", ...p });
const row = (venue: "kamino_klend" | "jupiter_lend", exchangeRate: number): VenueDayRow => ({ day: "2026-10-06", venue, asset: "USDC_LEND", supplyPct: 4, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1e9, tvlUsd: 1e9, exchangeRate, avg7Pct: 4, daysMeasured: 7, eligible: true, verdict: null, reason: null, served: null, ok: true });

describe("carryMoves: a move keeps the put-in basis and what was earned so far (holdings match legs by (asset, venue))", () => {
  const legs = [leg({ plantingId: "a", usdcInCents: 300, amountOutRaw: 2_000_000n, rateAtPlanting: 1.05 }), leg({ plantingId: "b", usdcInCents: 200, amountOutRaw: 1_000_000n, rateAtPlanting: 1.055 }),
    leg({ plantingId: "c", asset: "SOL_LEND", venue: "kamino_klend", usdcInCents: 100, amountOutRaw: 5n, rateAtPlanting: 1.1 })];
  const prices = { USDC_LEND: 1, SOL_LEND: 150 };
  const carry: MoveCarry = { id: "m1", asset: "USDC_LEND", from: "jupiter_lend", to: "kamino_klend", receiptRaw: 3_000_000n, sourceReceiptRaw: 3_000_000n, depositRaw: 3_176_820n, fromRate: 1.06, toRate: 1.2, toReceiptRaw: 2_647_350n };

  it("earned before the move == earned right after; the basis too; the other asset is untouched", () => {
    const before = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 3_000_000n }], legs, rows: [row("jupiter_lend", 1.06), row("kamino_klend", 1.2)], prices })[0];
    const after = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 2_647_350n }], legs: carryMoves(legs, [carry]), rows: [row("jupiter_lend", 1.06), row("kamino_klend", 1.2)], prices })[0];
    expect(before.earnedUsd).toBeGreaterThan(0);
    expect(after.earnedUsd).toBeCloseTo(before.earnedUsd!, 9);
    expect(after.earnedUnderlyingRaw).toBe(before.earnedUnderlyingRaw);
    expect(after.putInCents).toBe(before.putInCents);
    expect(carryMoves(legs, [carry]).filter((l) => l.asset === "SOL_LEND")).toEqual([legs[2]]);
  });
  it("a partial move splits basis and earned between the two venues; their sum is unchanged", () => {
    const half: MoveCarry = { ...carry, receiptRaw: 1_500_000n, depositRaw: 1_588_410n, toReceiptRaw: 1_323_675n };
    const rows = [row("jupiter_lend", 1.06), row("kamino_klend", 1.2)];
    const before = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 3_000_000n }], legs, rows, prices })[0];
    const after = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 1_500_000n }, { asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 1_323_675n }], legs: carryMoves(legs, [half]), rows, prices });
    expect(after[0].earnedUsd! + after[1].earnedUsd!).toBeCloseTo(before.earnedUsd!, 6);
    expect(after[0].putInCents + after[1].putInCents).toBe(before.putInCents);
  });
  it("a move back carries again (chronological)", () => {
    const back: MoveCarry = { id: "m2", asset: "USDC_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: 2_647_350n, sourceReceiptRaw: 2_647_350n, depositRaw: 3_173_640n, fromRate: 1.2, toRate: 1.06, toReceiptRaw: 2_994_000n };
    const rows = [row("jupiter_lend", 1.06), row("kamino_klend", 1.2)];
    const before = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 3_000_000n }], legs, rows, prices })[0];
    const after = lendingFrom({ positions: [{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 2_994_000n }], legs: carryMoves(legs, [carry, back]), rows, prices })[0];
    expect(after.earnedUsd).toBeCloseTo(before.earnedUsd!, 6);
    expect(after.putInCents).toBe(before.putInCents);
  });
});

describe("buildMove for SOL: the redeem keeps the WSOL account open; the deposit spends it and unwraps the rest in its tail", () => {
  const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
  const isClose = (ix: Instruction) => ix.programAddress === TOKEN_PROGRAM_ADDRESS && ix.data?.length === 1 && ix.data[0] === 9;
  for (const from of ["kamino_klend", "jupiter_lend"] as const) {
    it(`from ${from}`, async () => {
      const to = from === "kamino_klend" ? "jupiter_lend" : "kamino_klend";
      const redeem = await buildMove({ user: USER, asset: "SOL_LEND", from, to, receiptRaw: 1_000n, depositRaw: 900n, part: "redeem" });
      const deposit = await buildMove({ user: USER, asset: "SOL_LEND", from, to, receiptRaw: 1_000n, depositRaw: 900n, part: "deposit" });
      expect(redeem.some(isClose)).toBe(false);
      expect(isClose(deposit[deposit.length - 1])).toBe(true);
    });
  }
});
