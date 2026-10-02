import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { zeroSplit, type Split } from "@/domain/coins";

const SP = 1_146_000_000n;
const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });
vi.mock("@/lib/staking", () => ({
  readPosition: vi.fn(async () => ({ shares: 1_000_000_000n, stakedRaw: 1_146_000_000n, unstakingRaw: 0n, unstakeTs: null })),
  sharePrice: vi.fn(async () => SP),
}));
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));
vi.mock("@/lib/store", () => ({ storeBalanceRaw: vi.fn(async () => 0n), storeRedeemRate: vi.fn(async () => 1_049_600_000n) }));
vi.mock("@/lib/holdings", async (orig) => ({ ...(await orig<object>()), readHoldings: vi.fn(async () => ({ hSOL: 2_000_000_000n, cbBTC: 0n })) }));
vi.mock("@/lib/subscriptions", () => ({ readDelegation: vi.fn(async () => ({ exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 2_180_000n, periodStartTs: BigInt(Math.floor(Date.now() / 1000) - 600), periodLengthS: 86_400n })) }));

import { GET as me } from "@/app/api/me/route";

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("GET /api/me with the Yield Manager (spec 7.7)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: "lucas.skr" });
    await repo.setJoinedPosition(U, { shares: 0n, sharePrice: SP });
    await repo.addWallet({ pubkey: "W", userPubkey: U, delegationPda: U, dailyCapCents: 500 }); // a real address: the route validates it before reading the delegation
    await repo.bumpLedger("W", "SKR", 200);
    const p = await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", signature: "sig", usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed", aiLine: null },
      [{ asset: "hSOL", usdcInCents: 200, amountOutRaw: 1_000_000_000n, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: 1.18 }]);
    await repo.setPlantingShares(p.id, { before: 0n, after: 0n, minted: 0n });
    const today = new Date().toISOString().slice(0, 10);
    await repo.putCoinDay({ day: today, asset: "hSOL", rate: 1.2, ratePrev: null, ratePrevDays: null, priceUsd: 168, liquidityUsd: 1e8, priceChange24h: 0, tradeable: true, lastUpdateEpoch: 1047, ok: true });
    await repo.putSplitDay({ day: today, stop: "balanced", split: split({ SKR: 40, stORE: 5, hSOL: 25, JitoSOL: 15, JupSOL: 10, cbBTC: 5 }), modelAnswer: null, why: "hSOL grew the most.", fallback: null, callId: 1 });
    await repo.saveRules(U, { managed: true, stop: "balanced", allocation: split({ SKR: 40, stORE: 5, hSOL: 25, JitoSOL: 15, JupSOL: 10, cbBTC: 5 }), prevAllocation: split({ SKR: 100 }), allocationDay: today });
  });

  it("serves holdings with earned, the manager block, a real cap left, and the receipt's price", async () => {
    const res = await me(new Request("http://x/api/me", bearer(await issueSession(U, "M"))));
    expect(res.status).toBe(200);
    const b = (await res.json()) as {
      holdings: { asset: string; heldRaw: string; putInCents: number; valueUsd: number; earnedUsd: number }[];
      manager: { managed: boolean; stop: string; why: string; undoAvailable: boolean; changedDay: string; stopSplit: Split; fallback: string | null };
      nextPlanting: { capLeftCents: number; asset: string };
      lastReceipt: { asset: string; usdPrice: number; feeCents: number; feeAmountRaw: string };
      history: { plantings: { asset: string; feeCents: number }[] };
      rules: { managed: boolean; pins: Record<string, number>; allocation: Split };
    };
    expect(b.holdings).toEqual([{ asset: "hSOL", heldRaw: "2000000000", putInCents: 200, valueUsd: 336, earnedUsd: expect.closeTo(2.8, 6), earnedUnderlyingRaw: "20000000" }]);
    expect(b.manager.managed).toBe(true);
    expect(b.manager.why).toBe("hSOL grew the most.");
    expect(b.manager.undoAvailable).toBe(true);
    expect(b.manager.stopSplit.hSOL).toBe(25);
    expect(b.nextPlanting.capLeftCents).toBe(282);           // 500 minus the 218 pulled this period
    expect(b.nextPlanting.asset).not.toBe("SKR");             // the ledger holds SKR only, the split wants the others
    expect(b.lastReceipt.asset).toBe("hSOL");
    expect(b.lastReceipt.usdPrice).toBe(168);
    expect(b.lastReceipt.feeAmountRaw).toBe("0");                 // R139: the app says "fee under 1 cent" from this, as on Activity
    expect(b.lastReceipt.feeCents).toBe(1);                   // spec 7.4: the receipt's one-cent fee
    expect(b.history.plantings[0].feeCents).toBe(1);
    expect(b.rules.allocation.hSOL).toBe(25);
  });
});
