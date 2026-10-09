import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { reconcileOwnStakes } from "@/lib/reconcile";

const SP = 1_146_000_000n;
/** Past the recent window of every row a test writes: no finality check is needed. */
const LATER = new Date(Date.now() + 3_600_000);
const chainAt = (shares: bigint, unstakingRaw = 0n, finalized = true) => ({ readPosition: async () => ({ shares, stakedRaw: 0n, unstakingRaw, unstakeTs: unstakingRaw ? 1n : null }), sharePrice: async () => SP, finalized: async () => finalized });

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
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(1_500_000_000n) });
    const adj = await repo.listStakeAdjustments("U");
    expect(adj.length).toBe(1);
    expect(adj[0].kind).toBe("own_stake");
    expect(adj[0].sharesDelta).toBe(500_000_000n);
    expect(adj[0].amountRaw).toBe(573_000_000n);
  });

  it("fewer shares is an unstake from the wallet: a wallet-source withdrawal row, no fake signature", async () => {
    const repo = await seeded(1_000_000_000n);
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(400_000_000n, 687_600_000n) });
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
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(400_000_000n, 687_600_000n) });
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(400_000_000n, 687_600_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(1);
  });

  it("rewards alone change nothing: the share count is what it was", async () => {
    const repo = await seeded(1_000_000_000n);
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(1_000_000_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });

  it("a Sprouts pick in the basket is not an own unstake", async () => {
    const repo = await seeded(1_000_000_000n);
    await repo.insertWithdrawal({ userPubkey: "U", asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 100_000_000n, amountRaw: 114_600_000n, principalRaw: 0n });
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(900_000_000n, 114_600_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });

  // [A16] the expected count sums minted shares per planting, so a pick followed by a planting is not re-applied
  it("planting, pick, planting records nothing", async () => {
    const repo = await seeded(1_000_000_000n);
    await repo.insertWithdrawal({ userPubkey: "U", asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 100_000_000n, amountRaw: 114_600_000n, principalRaw: 0n });
    const p2 = await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "s2", usdcPulledCents: 23, networkFeeCents: 3, status: "confirmed", aiLine: null }, []);
    await repo.setPlantingShares(p2.id, { before: 900_000_000n, after: 1_800_000_000n, minted: 900_000_000n });
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(1_800_000_000n, 114_600_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });

  it("a cancelled pick restores the expected count", async () => {
    const repo = await seeded(1_000_000_000n);
    const w = await repo.insertWithdrawal({ userPubkey: "U", asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 100_000_000n, amountRaw: 114_600_000n, principalRaw: 0n });
    await repo.setWithdrawalCancelled(w.id, "c");
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(1_000_000_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });

  // [A1] the position that exists before this column did must be seeded, never booked as an own stake
  it("a user with a confirmed planting lacking its minted shares is skipped, not adjusted", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "old", usdcPulledCents: 23, networkFeeCents: 3, status: "confirmed", aiLine: null }, []);
    const r = await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(247_000_000_000n) });
    expect(r.skipped).toEqual(["U"]);
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });

  // Review C1 [A15]: a wallet-side unstake of the fruit is a fruit pick: principalRaw 0, and the plant is not re-offered the fruit.
  it("a wallet-side unstake of the fruit records principalRaw 0 and leaves earned 0 and fruit 0", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.setJoinedPosition("U", { shares: 0n, sharePrice: SP });
    const p = await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "s", usdcPulledCents: 23, networkFeeCents: 3, status: "confirmed", aiLine: null },
      [{ asset: "SKR", usdcInCents: 20, amountOutRaw: 1_100_000_000n, staked: true, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: null, venue: null }]);
    await repo.setPlantingShares(p.id, { before: 0n, after: 1_000_000_000n, minted: 1_000_000_000n });
    // 1,146 SKR against 1,100 put in: 46 SKR earned. The wallet unstakes exactly that: 40,139,616 shares burn, 46 SKR sit in the cooldown.
    const { potForUser } = await import("@/lib/pot");
    const user = (await repo.getUser("U"))!;
    const before = await potForUser(repo, user, { position: { shares: 1_000_000_000n, stakedRaw: 1_146_000_000n, unstakingRaw: 0n, unstakeTs: null }, sharePrice: SP });
    expect(before.skrEarnedRaw).toBe(46_000_000n);
    expect(before.fruit).toBe(4);
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(959_860_384n, 46_000_000n) });
    const w = (await repo.listWithdrawals("U", 5))[0];
    expect(w.source).toBe("wallet");
    expect(w.principalRaw).toBe(0n);
    const after = await potForUser(repo, user, { position: { shares: 959_860_384n, stakedRaw: 1_100_000_000n, unstakingRaw: 46_000_000n, unstakeTs: 1n }, sharePrice: SP });
    expect(after.skrEarnedRaw).toBe(0n);
    expect(after.fruit).toBe(0);
    expect(after.skrPutInRaw).toBe(1_100_000_000n);
  });

  // Review I6: fewer shares with nothing unstaking is a lagging read or a cooldown already withdrawn, not a fact to book today.
  it("fewer shares with nothing unstaking on chain books nothing this run", async () => {
    const repo = await seeded(1_000_000_000n);
    const r = await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(400_000_000n, 0n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
    expect((await repo.listWithdrawals("U", 5)).length).toBe(0);
    expect(r.adjusted).toEqual([]);
  });

  it("rounding dust under 10,000 shares is ignored", async () => {
    const repo = await seeded(1_000_000_000n);
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(1_000_004_000n) });
    expect((await repo.listStakeAdjustments("U")).length).toBe(0);
  });
  // R499: the 10-06 race on 52vz. A planting's stake booked at `confirmed`, the read at `finalized` 4 s later still without it, and an
  // older cooldown open: the missing shares were booked as a wallet unstake. A recent move not yet finalized waits for the next run.
  it("a recent planting not yet finalized defers the user before the read: the lag is not booked as a wallet unstake", async () => {
    const repo = await seeded(1_000_000_000n);
    const p2 = await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "s2", usdcPulledCents: 106, networkFeeCents: 0, status: "confirmed", aiLine: null }, []);
    await repo.setPlantingShares(p2.id, { before: 1_000_000_000n, after: 1_055_278_224n, minted: 55_278_224n });
    let reads = 0;
    let asked: string[] = [];
    const lagging = {
      readPosition: async () => { reads++; return { shares: 1_000_000_000n, stakedRaw: 0n, unstakingRaw: 10_000_000n, unstakeTs: 1n }; },
      sharePrice: async () => SP,
      finalized: async (sigs: string[]) => { asked = sigs; return false; },
    };
    const r = await reconcileOwnStakes({ repo, now: new Date(p2.ts.getTime() + 4_000), chain: lagging });
    expect(r.deferred).toEqual(["U"]);
    expect(r.adjusted).toEqual([]);
    expect(reads).toBe(0);
    expect(asked.sort()).toEqual(["s", "s2"]);
    expect(await repo.listStakeAdjustments("U")).toEqual([]);
    expect(await repo.listWithdrawals("U", 5)).toEqual([]);
  });

  // The cron plants and reconciles in the same run: an age rule would never reconcile a user who plants every day.
  it("a recent planting already finalized does not defer: a real wallet unstake the same day is booked", async () => {
    const repo = await seeded(1_000_000_000n);
    const p = (await repo.listConfirmedPlantings("U"))[0];
    const r = await reconcileOwnStakes({ repo, now: new Date(p.ts.getTime() + 30_000), chain: chainAt(400_000_000n, 687_600_000n, true) });
    expect(r.deferred).toEqual([]);
    expect((await repo.listStakeAdjustments("U"))[0].kind).toBe("own_unstake");
  });

  it("a recent Sprouts pick not yet finalized defers the user: a read still holding its shares is not an own stake", async () => {
    // No planting at all (shares from the join), so only the pick can defer the user.
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.setJoinedPosition("U", { shares: 1_000_000_000n, sharePrice: SP });
    const w = await repo.insertWithdrawal({ userPubkey: "U", asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 100_000_000n, amountRaw: 114_600_000n, principalRaw: 0n });
    const r = await reconcileOwnStakes({ repo, now: new Date(w.unstakeTs.getTime() + 4_000), chain: chainAt(1_000_000_000n, 0n, false) });
    expect(r.deferred).toEqual(["U"]);
    expect(await repo.listStakeAdjustments("U")).toEqual([]);
  });

  it("a recent row without a signature cannot be proven finalized: deferred without asking the chain", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.setJoinedPosition("U", { shares: 0n, sharePrice: SP });
    const p = await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: null as unknown as string, usdcPulledCents: 23, networkFeeCents: 3, status: "confirmed", aiLine: null }, []);
    await repo.setPlantingShares(p.id, { before: 0n, after: 1_000_000_000n, minted: 1_000_000_000n });
    let asked = false;
    const r = await reconcileOwnStakes({ repo, now: new Date(p.ts.getTime() + 4_000), chain: { ...chainAt(400_000_000n, 687_600_000n), finalized: async () => { asked = true; return true; } } });
    expect(r.deferred).toEqual(["U"]);
    expect(asked).toBe(false);
    expect(await repo.listStakeAdjustments("U")).toEqual([]);
  });

  it("a recent wallet-source row needs no finality check: only Sprouts' own sends are booked at confirmed", async () => {
    const repo = await seeded(1_000_000_000n);
    await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(400_000_000n, 687_600_000n) });
    const r = await reconcileOwnStakes({ repo, now: LATER, chain: chainAt(1_000_000_000n, 0n, false) });
    expect(r.deferred).toEqual([]);
    expect((await repo.listStakeAdjustments("U")).map((x) => x.kind)).toEqual(["own_unstake", "own_stake"]);
  });
  // R499 audit F1: a cancel has no time of its own and can land any time in the cooldown; recency on the unstake's time missed it.
  it("a cancel of a 30-hour-old pick not yet finalized defers the user: the restored shares are not booked as a wallet unstake", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.setJoinedPosition("U", { shares: 1_000_000_000n, sharePrice: SP });
    const w = await repo.insertWithdrawal({ userPubkey: "U", asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 100_000_000n, amountRaw: 114_600_000n, principalRaw: 0n });
    await repo.setWithdrawalCancelled(w.id, "c");
    let asked: string[] = [];
    // The finalized read still shows the pick: 900M shares, its cooldown open.
    const chain = { ...chainAt(900_000_000n, 114_600_000n), finalized: async (sigs: string[]) => { asked = sigs; return false; } };
    const r = await reconcileOwnStakes({ repo, now: new Date(w.unstakeTs.getTime() + 30 * 3_600_000), chain });
    expect(r.deferred).toEqual(["U"]);
    expect(asked).toEqual(["c"]);
    expect(await repo.listStakeAdjustments("U")).toEqual([]);
    expect((await repo.listWithdrawals("U", 5)).filter((x) => x.source === "wallet")).toEqual([]);
  });

  // R499 audit F2: a planting left `sent` may have landed; the ledger does not count it yet, so the chain's extra shares are not the user's.
  it("a planting still marked sent defers the user without reading the chain", async () => {
    const repo = await seeded(1_000_000_000n);
    await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "s2", usdcPulledCents: 50, networkFeeCents: 0, status: "sent", aiLine: null }, []);
    let reads = 0;
    const chain = { ...chainAt(1_500_000_000n), readPosition: async () => { reads++; return { shares: 1_500_000_000n, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: null }; } };
    const r = await reconcileOwnStakes({ repo, now: LATER, chain });
    expect(r.deferred).toEqual(["U"]);
    expect(reads).toBe(0);
    expect(await repo.listStakeAdjustments("U")).toEqual([]);
  });

  // R499 audit F3: a pick posted while the reconcile waited or read is counted once by the chain and once by the ledger.
  it("a ledger that moves during the read defers the user", async () => {
    const repo = await seeded(1_000_000_000n);
    const chain = {
      ...chainAt(900_000_000n, 114_600_000n),
      readPosition: async () => {
        await repo.insertWithdrawal({ userPubkey: "U", asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 100_000_000n, amountRaw: 114_600_000n, principalRaw: 0n });
        return { shares: 900_000_000n, stakedRaw: 0n, unstakingRaw: 114_600_000n, unstakeTs: 1n };
      },
    };
    const r = await reconcileOwnStakes({ repo, now: LATER, chain });
    expect(r.deferred).toEqual(["U"]);
    expect(await repo.listStakeAdjustments("U")).toEqual([]);
    expect((await repo.listWithdrawals("U", 5)).filter((x) => x.source === "wallet")).toEqual([]);
  });

  // R499 audit F4: the route's time limit. Past the deadline nobody is started; the finality wait never runs past it.
  it("past the deadline every user is deferred without a read", async () => {
    const repo = await seeded(1_000_000_000n);
    let reads = 0;
    const chain = { ...chainAt(1_500_000_000n), readPosition: async () => { reads++; return { shares: 1_500_000_000n, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: null }; } };
    const r = await reconcileOwnStakes({ repo, now: LATER, deadlineMs: Date.now() - 1, chain });
    expect(r.deferred).toEqual(["U"]);
    expect(reads).toBe(0);
  });

  it("the finality wait is capped by the time left before the deadline", async () => {
    const repo = await seeded(1_000_000_000n);
    const p = (await repo.listConfirmedPlantings("U"))[0];
    let waited = -1;
    const chain = { ...chainAt(1_000_000_000n), finalized: async (_s: string[], waitMs: number) => { waited = waitMs; return true; } };
    await reconcileOwnStakes({ repo, now: new Date(p.ts.getTime() + 4_000), deadlineMs: Date.now() + 5_000, chain });
    expect(waited).toBeGreaterThan(0);
    expect(waited).toBeLessThanOrEqual(5_000);
  });
});
