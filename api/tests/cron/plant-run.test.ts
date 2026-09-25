import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { runPlanting, type Chain } from "@/lib/plant-run";

const NOW = new Date("2026-09-29T14:00:00Z");
const DELEGATION = { exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n };

function fakeChain(over: Partial<Chain> = {}): Chain {
  let n = 0;
  return {
    readDelegation: async () => DELEGATION,
    usdcBalanceRaw: async () => 50_000_000n,
    buildPlantingTx: async (a) => ({ tx: {}, expectedOutRaw: a.pullRaw * 48n, minOutRaw: a.pullRaw * 47n, lookupTables: [], lastValidBlockHeight: 0n }),
    simulatePlanting: async () => ({ ok: true, err: null, logs: [], units: 200_000 }),
    sendPlanting: async () => `sig${++n}`,
    ...over,
  };
}

async function seeded(roundups: number[], opts: { cap?: number; ago?: number } = {}) {
  const repo = new MemoryRepo();
  await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
  await repo.addWallet({ pubkey: "W", userPubkey: "U", delegationPda: "D", dailyCapCents: opts.cap ?? 500 });
  for (const [i, c] of roundups.entries()) {
    await repo.insertSwap({ signature: `s${i}`, walletPubkey: "W", ts: new Date(NOW.getTime() - (opts.ago ?? 3_600_000)), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
  }
  return repo;
}

describe("runPlanting", () => {
  it("plants when pending reaches the threshold: 83 + 62 + 70 = 215 cents", async () => {
    const repo = await seeded([83, 62, 70]);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.planted).toEqual([{ wallet: "W", asset: "SKR", pullCents: 218, signature: "sig1" }]);
    expect((await repo.unplantedSwaps("W")).length).toBe(0);
    expect((await repo.getWallet("W"))!.ledgerSkrCents).toBe(215);
  });

  it("waits below the threshold", async () => {
    const r = await runPlanting({ repo: await seeded([83, 62]), now: NOW, chain: fakeChain() });
    expect(r.planted).toEqual([]);
    expect(r.skipped[0].reason).toBe("below threshold");
  });

  it("plants below the threshold when the oldest swap is 7 days old", async () => {
    const r = await runPlanting({ repo: await seeded([83, 62], { ago: 8 * 86_400_000 }), now: NOW, chain: fakeChain() });
    expect(r.planted[0].pullCents).toBe(148);
  });

  it("cap left bounds the pull including fee", async () => {
    const r = await runPlanting({ repo: await seeded([1000, 1000, 1000]), now: NOW, chain: fakeChain() });
    expect(r.planted[0].pullCents).toBe(500);
  });

  it("second run is a no-op", async () => {
    const repo = await seeded([83, 62, 70]);
    const chain = fakeChain();
    await runPlanting({ repo, now: NOW, chain });
    const r2 = await runPlanting({ repo, now: NOW, chain });
    expect(r2.planted).toEqual([]);
  });

  it("pauses the wallet when USDC is short and writes an event", async () => {
    const repo = await seeded([83, 62, 70]);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 100_000n }) });
    expect(r.skipped[0].reason).toBe("no usdc");
    expect((await repo.getWallet("W"))!.status).toBe("paused");
    expect(repo.events.some((e) => e.kind === "paused_no_usdc")).toBe(true);
  });

  it("resumes a paused wallet once USDC is back", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.setWalletStatus("W", "paused");
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.planted.length).toBe(1);
    expect(repo.events.some((e) => e.kind === "resumed")).toBe(true);
  });

  it("marks the wallet revoked when the delegation is gone", async () => {
    const repo = await seeded([83, 62, 70]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ readDelegation: async () => ({ exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n }) }) });
    expect((await repo.getWallet("W"))!.status).toBe("revoked");
  });

  it("a failed simulation records a failed planting and leaves swaps unplanted", async () => {
    const repo = await seeded([83, 62, 70]);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ simulatePlanting: async () => ({ ok: false, err: { InstructionError: [2, "Custom"] }, logs: ["x"], units: 0 }) }) });
    expect(r.skipped[0].reason).toBe("simulation failed");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
  });

  it("uses the allocation: 50/50 alternates assets over two plantings", async () => {
    const repo = await seeded([215]);
    await repo.saveRules("U", { allocation: { SKR: 50, stORE: 50 } });
    const chain = fakeChain();
    const a = await runPlanting({ repo, now: NOW, chain });
    await repo.insertSwap({ signature: "s9", walletPubkey: "W", ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 215 });
    const b = await runPlanting({ repo, now: new Date(NOW.getTime() + 86_400_000), chain });
    expect([a.planted[0].asset, b.planted[0].asset].sort()).toEqual(["SKR", "stORE"]);
  });

  it("counts what the chain already pulled this period against the cap", async () => {
    const repo = await seeded([1000]);
    const periodStart = BigInt(Math.floor(NOW.getTime() / 1000) - 3600);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readDelegation: async () => ({ ...DELEGATION, pulledInPeriodRaw: 2_500_000n, periodStartTs: periodStart }) }) });
    expect(r.planted[0].pullCents).toBe(250);
  });

  it("when the cap left is below the threshold, nothing is planted and the change waits", async () => {
    const repo = await seeded([1000]);
    const periodStart = BigInt(Math.floor(NOW.getTime() / 1000) - 3600);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readDelegation: async () => ({ ...DELEGATION, pulledInPeriodRaw: 4_000_000n, periodStartTs: periodStart }) }) });
    expect(r.planted).toEqual([]);
    expect((await repo.unplantedSwaps("W")).length).toBe(1);
  });
});
