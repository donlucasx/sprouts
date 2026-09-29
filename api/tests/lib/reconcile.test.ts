import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { reconcileOwnStakes } from "@/lib/reconcile";

const SP = 1_146_000_000n;
const chainAt = (shares: bigint, unstakingRaw = 0n) => ({ readPosition: async () => ({ shares, stakedRaw: 0n, unstakingRaw, unstakeTs: unstakingRaw ? 1n : null }), sharePrice: async () => SP });

/** A user with one confirmed planting that minted `minted` shares (before 0, after `minted`), or none. */
async function seeded(minted: bigint | null) {
  const repo = new MemoryRepo();
  await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
  await repo.setJoinedPosition("U", { shares: 0n, sharePrice: SP });
  if (minted !== null) {
    const p = await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "s", usdcPulledCents: 23, networkFeeCents: 3, status: "confirmed", aiLine: null }, []);
    await repo.setPlantingShares(p.id, { before: 0n, after: minted, minted });
  }
  return repo;
}

describe("reconcileOwnStakes (R61, [A16])", () => {
  it("more shares than Sprouts minted is a stake from the wallet: recorded as put in", async () => {
    const repo = await seeded(1_000_000_000n);
    await reconcileOwnStakes({ repo, chain: chainAt(1_500_000_000n) });
    const adj = await repo.listStakeAdjustments("U");
    expect(adj.length).toBe(1);
    expect(adj[0].kind).toBe("own_stake");
    expect(adj[0].sharesDelta).toBe(500_000_000n);
    expect(adj[0].amountRaw).toBe(573_000_000n);
  });

  it("fewer shares is an unstake from the wallet: a wallet-source withdrawal row, no fake signature", async () => {
    const repo = await seeded(1_000_000_000n);
    await reconcileOwnStakes({ repo, chain: chainAt(400_000_000n, 687_600_000n) });
    const adj = await repo.listStakeAdjustments("U");
    expect(adj[0].kind).toBe("own_unstake");
    expect(adj[0].sharesDelta).toBe(-600_000_000n);
    const w = await repo.listWithdrawals("U", 5);
    expect(w.length).toBe(1);
    expect(w[0].source).toBe("wallet");
    expect(w[0].unstakeSignature).toBeNull();
  });

  // [A2] the second run must not see the wallet row and the adjustment as two separate facts
  it("a second run after a wallet unstake records nothing more", async () => {
    const repo = await seeded(1_000_000_000n);
    await reconcileOwnStakes({ repo, chain: chainAt(400_000_000n, 687_600_000n) });
    await reconcileOwnStakes({ repo, chain: chainAt(400_000_000n, 687_600_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(1);
  });

  it("rewards alone change nothing: the share count is what it was", async () => {
    const repo = await seeded(1_000_000_000n);
    await reconcileOwnStakes({ repo, chain: chainAt(1_000_000_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });

  it("a Sprouts pick in the basket is not an own unstake", async () => {
    const repo = await seeded(1_000_000_000n);
    await repo.insertWithdrawal({ userPubkey: "U", asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 100_000_000n, amountRaw: 114_600_000n, principalRaw: 0n });
    await reconcileOwnStakes({ repo, chain: chainAt(900_000_000n, 114_600_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });

  // [A16] the expected count sums minted shares per planting, so a pick followed by a planting is not re-applied
  it("planting, pick, planting records nothing", async () => {
    const repo = await seeded(1_000_000_000n);
    await repo.insertWithdrawal({ userPubkey: "U", asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 100_000_000n, amountRaw: 114_600_000n, principalRaw: 0n });
    const p2 = await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "s2", usdcPulledCents: 23, networkFeeCents: 3, status: "confirmed", aiLine: null }, []);
    await repo.setPlantingShares(p2.id, { before: 900_000_000n, after: 1_800_000_000n, minted: 900_000_000n });
    await reconcileOwnStakes({ repo, chain: chainAt(1_800_000_000n, 114_600_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });

  it("a cancelled pick restores the expected count", async () => {
    const repo = await seeded(1_000_000_000n);
    const w = await repo.insertWithdrawal({ userPubkey: "U", asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 100_000_000n, amountRaw: 114_600_000n, principalRaw: 0n });
    await repo.setWithdrawalCancelled(w.id, "c");
    await reconcileOwnStakes({ repo, chain: chainAt(1_000_000_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });

  // [A1] the position that exists before this column did must be seeded, never booked as an own stake
  it("a user with a confirmed planting lacking its minted shares is skipped, not adjusted", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "old", usdcPulledCents: 23, networkFeeCents: 3, status: "confirmed", aiLine: null }, []);
    const r = await reconcileOwnStakes({ repo, chain: chainAt(247_000_000_000n) });
    expect(r.skipped).toEqual(["U"]);
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });

  it("rounding dust under 10,000 shares is ignored", async () => {
    const repo = await seeded(1_000_000_000n);
    await reconcileOwnStakes({ repo, chain: chainAt(1_000_004_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });
});
