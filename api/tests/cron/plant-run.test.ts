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
    // the signature is known once the puller signs, before anything is sent
    buildPlantingTx: async (a) => ({ tx: {}, signature: `sig${++n}`, expectedOutRaw: a.pullRaw * 48n, minOutRaw: a.pullRaw * 47n, lookupTables: [], lastValidBlockHeight: 0n }),
    simulatePlanting: async () => ({ ok: true, err: null, logs: [], units: 200_000 }),
    sendPlanting: async () => {},
    signatureStatus: async () => "pending",
    readShares: async () => 1_000_000_000n,
    sharePrice: async () => 1_146_000_000n,
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

  // Review C1 (2026-09-28): Vercel Hobby occasionally fires the cron twice and Lucas triggers it by hand; two runs that both
  // read the same unplanted set must not both pull. The claim on the swaps is one conditional statement.
  it("two overlapping runs pull the same round-ups once", async () => {
    const repo = await seeded([83, 62, 70]);
    const chain = fakeChain({ sendPlanting: async () => { await new Promise((r) => setTimeout(r, 5)); } });
    const [a, b] = await Promise.all([runPlanting({ repo, now: NOW, chain }), runPlanting({ repo, now: NOW, chain })]);
    expect(a.planted.length + b.planted.length).toBe(1);
    expect((await repo.getWallet("W"))!.ledgerSkrCents).toBe(215);
    expect([...repo.plantings.values()].filter((p) => p.status === "confirmed").length).toBe(1);
  });

  it("a send that errors after landing is reconciled as confirmed, never pulled again", async () => {
    const repo = await seeded([83, 62, 70]);
    const chain = fakeChain({ sendPlanting: async () => { throw new Error("websocket closed"); }, signatureStatus: async () => "confirmed" });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.planted.length).toBe(1);
    expect((await repo.unplantedSwaps("W")).length).toBe(0);
    expect((await repo.getWallet("W"))!.ledgerSkrCents).toBe(215);
    const again = await runPlanting({ repo, now: NOW, chain });
    expect(again.planted).toEqual([]);
  });

  it("a send that failed on chain releases the round-ups for the next run", async () => {
    const repo = await seeded([83, 62, 70]);
    const chain = fakeChain({ sendPlanting: async () => { throw new Error("blockhash expired"); }, signatureStatus: async () => "failed" });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.skipped[0].reason).toBe("send failed");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
    expect((await repo.getWallet("W"))!.ledgerSkrCents).toBe(0);
  });

  it("a send whose fate is unknown stays claimed and is reconciled on the next run", async () => {
    const repo = await seeded([83, 62, 70]);
    const chain = fakeChain({ sendPlanting: async () => { throw new Error("timeout"); } });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.skipped[0].reason).toBe("send unknown");
    expect((await repo.unplantedSwaps("W")).length).toBe(0);
    expect([...repo.plantings.values()][0].status).toBe("sent");
    // ten minutes later the chain shows it landed: confirmed, ledger bumped once, nothing re-pulled
    const later = new Date(NOW.getTime() + 10 * 60_000);
    const r2 = await runPlanting({ repo, now: later, chain: fakeChain({ signatureStatus: async () => "confirmed" }) });
    expect(r2.planted).toEqual([]);
    expect([...repo.plantings.values()][0].status).toBe("confirmed");
    expect((await repo.getWallet("W"))!.ledgerSkrCents).toBe(215);
  });

  it("a sent planting that never lands within half an hour is failed and its round-ups released", async () => {
    const repo = await seeded([83, 62, 70]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ sendPlanting: async () => { throw new Error("timeout"); } }) });
    const later = new Date(NOW.getTime() + 31 * 60_000);
    await runPlanting({ repo, now: later, chain: fakeChain({ signatureStatus: async () => "pending", buildPlantingTx: async () => { throw new Error("not reached in this test"); } }) });
    expect([...repo.plantings.values()][0].status).toBe("failed");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
  });

  // Review I1: one wallet's Jupiter or build error must not abort everyone's day.
  it("one wallet's build error is recorded and the next wallet still plants", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.upsertUser({ seedVaultPubkey: "U2", sgtMint: "M2", skrName: null });
    await repo.addWallet({ pubkey: "W2", userPubkey: "U2", delegationPda: "D2", dailyCapCents: 500 });
    await repo.insertSwap({ signature: "t1", walletPubkey: "W2", ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 215 });
    const base = fakeChain();
    const chain = fakeChain({ buildPlantingTx: async (a) => { if (a.delegator === "W") throw new Error("Jupiter quote failed: 400 no route"); return base.buildPlantingTx(a); } });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.planted.map((p) => p.wallet)).toEqual(["W2"]);
    expect(r.skipped.find((s) => s.wallet === "W")?.reason).toBe("build failed");
    expect(repo.events.some((e) => e.kind === "pull_failed" && e.walletPubkey === "W")).toBe(true);
  });

  // 09-29: the first Saga planting failed on Vercel with a bare "TypeError: fetch failed"; Node keeps the host and the reason
  // (DNS, connect timeout, reset) in the error's cause, which the log dropped. The recorded error now carries it.
  it("a network error records its cause, so the log names the failing call", async () => {
    const repo = await seeded([83, 62, 70]);
    const netErr = new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.jup.ag") });
    await runPlanting({ repo, now: NOW, chain: fakeChain({ buildPlantingTx: async () => { throw netErr; } }) });
    const ev = repo.events.find((e) => e.kind === "pull_failed");
    expect((ev!.detail as { err: string }).err).toBe("fetch failed (getaddrinfo ENOTFOUND api.jup.ag)");
  });

  // 09-29: the Saga's first planting was sent, then a network call after the send threw and the run reported "build failed",
  // which also counts toward the three-strikes stop. Once sent, an error is "send unknown": the next run reconciles it by signature.
  it("an error after the send is send unknown, not build failed, and the next run books it", async () => {
    const repo = await seeded([83, 62, 70]);
    const setStatus = repo.setPlantingStatus.bind(repo);
    let fail = true;
    repo.setPlantingStatus = async (id, st) => { if (fail) { fail = false; throw new TypeError("fetch failed"); } return setStatus(id, st); };
    const chain = fakeChain({ signatureStatus: async () => "confirmed" });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "send unknown" }]);
    expect((await repo.listPlantings("U", 5))[0].status).toBe("sent");
    await runPlanting({ repo, now: new Date(NOW.getTime() + 10 * 60_000), chain });
    expect((await repo.listPlantings("U", 5))[0].status).toBe("confirmed");
  });

  it("three build failures in a row stop the run and leave the rest for tomorrow", async () => {
    // Wallets run eight at a time, so an outage hits the first eight before the stop lands; the other four wait for tomorrow.
    const repo = new MemoryRepo();
    for (let i = 0; i < 12; i++) {
      await repo.upsertUser({ seedVaultPubkey: `U${i}`, sgtMint: `M${i}`, skrName: null });
      await repo.addWallet({ pubkey: `W${i}`, userPubkey: `U${i}`, delegationPda: `D${i}`, dailyCapCents: 500 });
      await repo.insertSwap({ signature: `x${i}`, walletPubkey: `W${i}`, ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 215 });
    }
    let builds = 0;
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ buildPlantingTx: async () => { builds++; throw new Error("Jupiter quote failed: 429"); } }) });
    expect(r.planted).toEqual([]);
    expect(builds).toBe(8);
    expect(r.skipped.filter((s) => s.reason === "run stopped").length).toBe(4);
    expect(repo.events.filter((e) => e.kind === "run_stopped").length).toBe(1);
  });

  // Review I8: an RPC blip is not "no USDC".
  it("an RPC error reading the balance skips the wallet without pausing it", async () => {
    const repo = await seeded([83, 62, 70]);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => { throw new Error("rpc: 503"); } }) });
    expect(r.skipped[0].reason).toBe("build failed");
    expect((await repo.getWallet("W"))!.status).toBe("active");
    expect(repo.events.some((e) => e.kind === "paused_no_usdc")).toBe(false);
  });

  // Review M1: the user's own daily limit (rules) binds when it is lower than the delegation's.
  it("the user's daily limit in the rules bounds the pull", async () => {
    // $3 a day in the rules against a $5 delegation: the pull is $3 (the fee inside it), and the rest of the change waits.
    const repo = await seeded([1000, 1000]);
    await repo.saveRules("U", { dailyCapCents: 300 });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.planted[0].pullCents).toBe(300);
    expect((await repo.unplantedSwaps("W")).length).toBe(0);
    expect((await repo.getWallet("W"))!.ledgerSkrCents).toBe(297);
  });

  // [A16] the reconciliation works from what each planting minted: shares before the send, shares after confirmation.
  it("a confirmed planting records the shares it minted: read before the send, read again after confirmation", async () => {
    const repo = await seeded([83, 62, 70]);
    let shares = 1_000_000_000n;
    const chain = fakeChain({ readShares: async () => shares, sendPlanting: async () => { shares += 250_000_000n; } });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.planted.length).toBe(1);
    const p = (await repo.listConfirmedPlantings("U"))[0];
    expect(p.sharesBefore).toBe(1_000_000_000n);
    expect(p.sharesAfter).toBe(1_250_000_000n);
    expect(p.sharesMinted).toBe(250_000_000n);
  });

  it("a sent planting booked late without a before-read estimates its minted shares from the leg and the share price", async () => {
    const repo = await seeded([]);
    const p = await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "old", usdcPulledCents: 218, networkFeeCents: 3, status: "sent", aiLine: null },
      [{ asset: "SKR", usdcInCents: 215, amountOutRaw: 1_146_000_000n, staked: true, feeAmountRaw: 0n }]);
    p.ts = new Date(NOW.getTime() - 10 * 60_000);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ signatureStatus: async () => "confirmed", readShares: async () => 5_000_000_000n }) });
    const row = repo.plantings.get(p.id)!;
    expect(row.status).toBe("confirmed");
    expect(row.sharesBefore).toBeNull();
    expect(row.sharesAfter).toBe(5_000_000_000n);
    expect(row.sharesMinted).toBe(1_000_000_000n);
  });
});
