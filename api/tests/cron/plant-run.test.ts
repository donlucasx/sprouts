import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { SKR_ONLY } from "@/domain/coins";
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
    // the delivery account gains the minimum: passes the R207 delivery check for SKR (may not fall past the carry) and wallet coins
    simulatePlanting: async (b) => ({ ok: true, err: null, logs: [], units: 200_000, delivery: { pre: 1_000n, post: 1_000n + b.minOutRaw } }),
    sendPlanting: async () => {},
    signatureStatus: async () => "pending",
    readShares: async () => 1_000_000_000n,
    sharePrice: async () => 1_146_000_000n,
    assetBalanceRaw: async () => 0n,
    pullerSkrChangeRaw: async () => 0n,
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
    expect((await repo.getWallet("W"))!.ledgerCents).toEqual({ SKR: 215 });
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

  it("resumes a wallet the run paused for want of USDC once the USDC is back", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.setWalletStatus("W", "paused");
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "paused_no_usdc", detail: null });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.planted.length).toBe(1);
    expect(repo.events.some((e) => e.kind === "resumed")).toBe(true);
  });

  // Security audit R207 (HIGH): the run never undoes a user's pause; only their signed resume does (R84).
  it("never resumes a wallet the user paused, even with USDC back and an older no-USDC pause", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.setWalletStatus("W", "paused");
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "paused_no_usdc", detail: null });
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "resumed", detail: null });
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "paused_by_user", detail: { by: "user" } });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.planted).toEqual([]);
    expect((await repo.getWallet("W"))!.status).toBe("paused");
  });
  // R207 review of the fix: the pause switch on a wallet the run had paused for want of USDC is still the user's pause.
  it("a user pause on top of a no-USDC pause holds: the newest cause is the user's", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.setWalletStatus("W", "paused");
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "paused_no_usdc", detail: null });
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "paused_by_user", detail: { by: "user" } });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.planted).toEqual([]);
    expect((await repo.getWallet("W"))!.status).toBe("paused");
  });
  // R207 review of the fix: the run lists wallets at its start; a pause made while it runs stops the pull.
  it("a user pause made after the run listed the wallet stops its pull", async () => {
    const repo = await seeded([83, 62, 70]);
    const chain = fakeChain({
      readDelegation: async () => {   // the user taps pause while the run reads the chain
        await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "paused_by_user", detail: { by: "user" } });
        await repo.setWalletStatus("W", "paused");
        return DELEGATION;
      },
    });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.planted).toEqual([]);
    expect(r.skipped).toEqual([{ wallet: "W", reason: "paused" }]);
  });
  it("a run resume racing a user pause does not pull: the user's pause is newer than any resume of theirs", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "paused_by_user", detail: { by: "user" } });
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "resumed", detail: null });   // a run's resume, not the user's
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.planted).toEqual([]);
    expect((await repo.getWallet("W"))!.status).toBe("paused");
  });
  it("a pause with no event after the last resume (made before user pauses were recorded) stays paused", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "paused_no_usdc", detail: null });
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "resumed", detail: null });
    await repo.setWalletStatus("W", "paused");
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.planted).toEqual([]);
    expect((await repo.getWallet("W"))!.status).toBe("paused");
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
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 50, stORE: 50 } });
    const chain = fakeChain();
    const a = await runPlanting({ repo, now: NOW, chain });
    await repo.insertSwap({ signature: "s9", walletPubkey: "W", ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 215 });
    const b = await runPlanting({ repo, now: new Date(NOW.getTime() + 86_400_000), chain });
    expect([a.planted[0].asset, b.planted[0].asset].sort()).toEqual(["SKR", "stORE"]);
  });

  // Plan v2 (audits/ore-plan, finding 4): an ORE leg that cannot be built or simulated must not freeze the wallet (the picker
  // would choose stORE again tomorrow) nor count as an outage: the run plants SKR instead and says so.
  it("falls back to SKR in the same run when the stORE leg fails to build, outside the outage count", async () => {
    const repo = await seeded([215]);
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 50, stORE: 50 } });
    await repo.bumpLedger("W", "SKR", 200); // the picker wants stORE next
    const assets: string[] = [];
    const chain = fakeChain({ buildPlantingTx: async (a) => {
      assets.push(a.asset);
      if (a.asset === "stORE") throw new Error("Jupiter: no route");
      return { tx: {} as never, signature: "sigF", expectedOutRaw: a.pullRaw * 48n, minOutRaw: a.pullRaw * 47n, lookupTables: [], lastValidBlockHeight: 0n };
    } });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(assets).toEqual(["stORE", "SKR"]);
    expect(r.planted[0]?.asset).toBe("SKR");
    expect(repo.events.some((e) => e.kind === "leg_fallback")).toBe(true);
    expect(r.skipped.some((s) => s.reason === "build failed")).toBe(false);
  });

  it("falls back to SKR when the stORE leg fails simulation", async () => {
    const repo = await seeded([215]);
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 50, stORE: 50 } });
    await repo.bumpLedger("W", "SKR", 200);
    const built: string[] = [];
    const chain = fakeChain({
      buildPlantingTx: async (a) => { built.push(a.asset); return { tx: { asset: a.asset } as never, signature: `sig-${a.asset}`, expectedOutRaw: a.pullRaw * 48n, minOutRaw: a.pullRaw * 47n, lookupTables: [], lastValidBlockHeight: 0n }; },
      simulatePlanting: async (b) => (b.tx as unknown as { asset: string }).asset === "stORE"
        ? { ok: false, err: { InstructionError: [3, "Custom"] }, logs: ["Program log: account not initialized"], units: 0 }
        : { ok: true, err: null, logs: [], units: 200_000, delivery: { pre: 0n, post: 0n } },
    });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(built).toEqual(["stORE", "SKR"]);
    expect(r.planted[0]?.asset).toBe("SKR");
    expect(repo.events.some((e) => e.kind === "leg_fallback")).toBe(true);
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
    expect(((await repo.getWallet("W"))!.ledgerCents.SKR ?? 0)).toBe(215);
    expect([...repo.plantings.values()].filter((p) => p.status === "confirmed").length).toBe(1);
  });

  it("a send that errors after landing is reconciled as confirmed, never pulled again", async () => {
    const repo = await seeded([83, 62, 70]);
    const chain = fakeChain({ sendPlanting: async () => { throw new Error("websocket closed"); }, signatureStatus: async () => "confirmed" });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.planted.length).toBe(1);
    expect((await repo.unplantedSwaps("W")).length).toBe(0);
    expect(((await repo.getWallet("W"))!.ledgerCents.SKR ?? 0)).toBe(215);
    const again = await runPlanting({ repo, now: NOW, chain });
    expect(again.planted).toEqual([]);
  });

  it("a send that failed on chain releases the round-ups for the next run", async () => {
    const repo = await seeded([83, 62, 70]);
    const chain = fakeChain({ sendPlanting: async () => { throw new Error("blockhash expired"); }, signatureStatus: async () => "failed" });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.skipped[0].reason).toBe("send failed");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
    expect(((await repo.getWallet("W"))!.ledgerCents.SKR ?? 0)).toBe(0);
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
    expect(((await repo.getWallet("W"))!.ledgerCents.SKR ?? 0)).toBe(215);
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
    expect(((await repo.getWallet("W"))!.ledgerCents.SKR ?? 0)).toBe(297);
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

  // R141: the leg records what landed, not the quote. A wallet coin from its balance read before the send and again after
  // confirmation; SKR from its minted shares at the share price. When a read is missing or fails the quote stands and the log says so.
  it("a confirmed wallet-coin leg records what landed: the balance before the send and again after confirmation (R141)", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 0, hSOL: 100 } });
    let bal = 5_000_000n;
    const reads: string[] = [];
    const chain = fakeChain({ assetBalanceRaw: async (owner, asset) => { reads.push(`${owner}:${asset}`); return bal; }, sendPlanting: async () => { bal += 103_000_000n; } });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.planted[0].asset).toBe("hSOL");
    expect(reads).toEqual(["U:hSOL", "U:hSOL"]);                                 // the Seed Vault wallet, before and after
    const [leg] = await repo.plantingLegs((await repo.listPlantings("U", 1))[0].id);
    expect(leg.amountOutRaw).toBe(103_000_000n);                                 // the quote was 2_180_000 * 47 = 102_460_000
  });

  it("one user's wallets plant in series, so two wallets planting the same coin at once do not each count the other's delivery (R141, review I1)", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.addWallet({ pubkey: "W2", userPubkey: "U", delegationPda: "D2", dailyCapCents: 500 });
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `t${i}`, walletPubkey: "W2", ts: new Date(NOW.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 0, hSOL: 100 } });
    let bal = 5_000_000n;
    const chain = fakeChain({ assetBalanceRaw: async () => bal, sendPlanting: async () => { await new Promise((r) => setTimeout(r, 5)); bal += 103_000_000n; } });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.planted.map((p) => p.asset)).toEqual(["hSOL", "hSOL"]);
    const legs = await Promise.all((await repo.listPlantings("U", 2)).map((p) => repo.plantingLegs(p.id)));
    expect(legs.map((l) => l[0].amountOutRaw)).toEqual([103_000_000n, 103_000_000n]);
  });

  it("the SKR leg records the SKR its minted shares are worth at the share price, not the quote (R141)", async () => {
    const repo = await seeded([83, 62, 70]);
    let shares = 1_000_000_000n;
    await runPlanting({ repo, now: NOW, chain: fakeChain({ readShares: async () => shares, sendPlanting: async () => { shares += 250_000_000n; } }) });
    const [leg] = await repo.plantingLegs((await repo.listPlantings("U", 1))[0].id);
    expect(leg.amountOutRaw).toBe(286_500_000n);                                 // 250_000_000 shares at 1.146 SKR a share
  });

  it("a sent planting booked late by the reconciliation recomputes its SKR leg from the stored before-read (R141, review M6)", async () => {
    const repo = await seeded([83, 62, 70]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ sendPlanting: async () => { throw new Error("timeout"); } }) });
    const later = new Date(NOW.getTime() + 10 * 60_000);
    await runPlanting({ repo, now: later, chain: fakeChain({ signatureStatus: async () => "confirmed", readShares: async () => 1_250_000_000n }) });
    const p = (await repo.listPlantings("U", 1))[0];
    expect(p.status).toBe("confirmed");
    expect(p.sharesMinted).toBe(250_000_000n);
    expect((await repo.plantingLegs(p.id))[0].amountOutRaw).toBe(286_500_000n);     // not the quote's 102_460_000
  });

  it("a landed change that is not above zero keeps the quote and says so (R141, review M6)", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 0, hSOL: 100 } });
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => { errors.push(String(m)); });
    try {
      await runPlanting({ repo, now: NOW, chain: fakeChain({ assetBalanceRaw: async () => 5_000_000n }) }); // the same balance before and after
      const [leg] = await repo.plantingLegs((await repo.listPlantings("U", 1))[0].id);
      expect(leg.amountOutRaw).toBe(102_460_000n);
      expect(errors.some((e) => /not above zero; the quote stands/.test(e))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("when the balance read fails the quote stands and the log says so (R141)", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 0, hSOL: 100 } });
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => { errors.push(String(m)); });
    try {
      const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ assetBalanceRaw: async () => { throw new Error("rpc: 503"); } }) });
      expect(r.planted[0].asset).toBe("hSOL");
      const [leg] = await repo.plantingLegs((await repo.listPlantings("U", 1))[0].id);
      expect(leg.amountOutRaw).toBe(102_460_000n);
      expect(errors.some((e) => /quote stands/.test(e))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("a sent planting booked late without a before-read estimates its minted shares from the leg and the share price", async () => {
    const repo = await seeded([]);
    const p = await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "old", usdcPulledCents: 218, networkFeeCents: 3, status: "sent", aiLine: null },
      [{ asset: "SKR", usdcInCents: 215, amountOutRaw: 1_146_000_000n, staked: true, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: null }]);
    p.ts = new Date(NOW.getTime() - 10 * 60_000);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ signatureStatus: async () => "confirmed", readShares: async () => 5_000_000_000n }) });
    const row = repo.plantings.get(p.id)!;
    expect(row.status).toBe("confirmed");
    expect(row.sharesBefore).toBeNull();
    expect(row.sharesAfter).toBe(5_000_000_000n);
    expect(row.sharesMinted).toBe(1_000_000_000n);
  });

  it("an hSOL leg that fails to build plants SKR in the same run and records which coin fell back", async () => {
    const repo = await seeded([215]);
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 50, hSOL: 50 } });
    await repo.bumpLedger("W", "SKR", 200); // the picker wants hSOL next
    const assets: string[] = [];
    const chain = fakeChain({ buildPlantingTx: async (a) => {
      assets.push(a.asset);
      if (a.asset === "hSOL") throw new Error("Jupiter: no route");
      return { tx: {} as never, signature: "sigH", expectedOutRaw: a.pullRaw * 48n, minOutRaw: a.pullRaw * 47n, lookupTables: [], lastValidBlockHeight: 0n };
    } });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(assets).toEqual(["hSOL", "SKR"]);
    expect(r.planted[0]?.asset).toBe("SKR");
    const ev = repo.events.find((e) => e.kind === "leg_fallback");
    expect((ev?.detail as { asset: string }).asset).toBe("hSOL");
    expect(r.skipped.some((s) => s.reason === "build failed")).toBe(false);
  });

  it("a leg records the USDC fee in cents and the coin's rate from today's snapshot, null before the first snapshot", async () => {
    const repo = await seeded([215]);
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 0, hSOL: 100 } });
    const a = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(a.planted[0].asset).toBe("hSOL");
    const legA = (await repo.plantingLegs([...repo.plantings.values()][0].id))[0];
    expect(legA.feeCents).toBe(1);          // 0.5% of $2.18, rounded
    expect(legA.rateAtPlanting).toBeNull();
    expect(legA.feeAmountRaw).toBe(0n);
    await repo.insertSwap({ signature: "s9", walletPubkey: "W", ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 215 });
    await repo.putCoinDay({ day: "2026-09-30", asset: "hSOL", rate: 1.21199, ratePrev: null, ratePrevDays: null, priceUsd: 143, liquidityUsd: 6e8, priceChange24h: 0, tradeable: true, lastUpdateEpoch: 1046, ok: true });
    const b = await runPlanting({ repo, now: new Date(NOW.getTime() + 86_400_000), chain: fakeChain() });
    expect(b.planted[0].asset).toBe("hSOL");
    const legB = (await repo.plantingLegs([...repo.plantings.values()][1].id))[0];
    expect(legB.rateAtPlanting).toBeCloseTo(1.21199, 5);
  });
});

// Security audit R207 #2, spec 3.2 step 4: the stake takes the quote's minimum; what the swap delivered above it is recorded against
// the planting (so the user) after confirmation and added to the same user's next SKR stake, once.
describe("the SKR slippage remainder (R207 #2)", () => {
  type BuildArgs = Parameters<Chain["buildPlantingTx"]>[0];
  const addSwaps = async (repo: MemoryRepo, wallet: string, tag: string) => {
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `${tag}${i}`, walletPubkey: wallet, ts: new Date(NOW.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
  };
  const recording = (builds: BuildArgs[], over: Partial<Chain> = {}) => {
    const base = fakeChain(over);
    return { ...base, buildPlantingTx: async (a: BuildArgs) => { builds.push(a); return base.buildPlantingTx(a); } } as Chain;
  };
  const plantings = (repo: MemoryRepo) => [...repo.plantings.values()].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  it("records the surplus after confirmation and stakes it with the same user's next SKR planting, once", async () => {
    const repo = await seeded([83, 62, 70]);
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds, { pullerSkrChangeRaw: async () => 500n }) });
    expect(builds[0].skrCarryRaw).toBeUndefined();
    expect(plantings(repo)[0]).toMatchObject({ status: "confirmed", skrCarryInRaw: 0n, skrSurplusRaw: 500n });
    expect(await repo.skrCreditRaw("U")).toBe(500n);

    // Next day: the stake carries the 500; this swap left 300 above its minimum, the stake drew 500 more: the change is -200.
    await addSwaps(repo, "W", "d2-");
    const later = new Date(NOW.getTime() + 86_400_000);
    await runPlanting({ repo, now: later, chain: recording(builds, { pullerSkrChangeRaw: async () => -200n }) });
    expect(builds[1].skrCarryRaw).toBe(500n);
    expect(plantings(repo)[1]).toMatchObject({ status: "confirmed", skrCarryInRaw: 500n, skrSurplusRaw: 300n });
    expect(await repo.skrCreditRaw("U")).toBe(300n);
  });

  it("never credits one user's remainder to another user", async () => {
    const repo = await seeded([83, 62, 70]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerSkrChangeRaw: async () => 500n }) });
    await repo.upsertUser({ seedVaultPubkey: "U2", sgtMint: "M2", skrName: null });
    await repo.addWallet({ pubkey: "W2", userPubkey: "U2", delegationPda: "D2", dailyCapCents: 500 });
    await addSwaps(repo, "W2", "u2-");
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds.map((b) => [b.user, b.skrCarryRaw])).toEqual([["U2", undefined]]);
    expect(await repo.skrCreditRaw("U2")).toBe(0n);
    expect(await repo.skrCreditRaw("U")).toBe(500n);
  });

  it("a planting reconciled late records its surplus once; booking it again never adds it twice", async () => {
    const repo = await seeded([83, 62, 70]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ sendPlanting: async () => { throw new Error("socket closed"); }, signatureStatus: async () => "pending" }) });
    expect(await repo.skrCreditRaw("U")).toBe(0n);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    await runPlanting({ repo, now: later, chain: fakeChain({ signatureStatus: async () => "confirmed", pullerSkrChangeRaw: async () => 400n }) });
    expect(await repo.skrCreditRaw("U")).toBe(400n);
    const p = plantings(repo)[0];
    await repo.setPlantingSkrSurplus(p.id, 400n);
    await repo.setPlantingSkrSurplus(p.id, 900n);
    expect(await repo.skrCreditRaw("U")).toBe(400n);
  });

  it("a planting that failed on chain gives its carry back; a stORE leg carries nothing", async () => {
    const repo = await seeded([83, 62, 70]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerSkrChangeRaw: async () => 500n }) });
    await addSwaps(repo, "W", "d2-");
    const later = new Date(NOW.getTime() + 86_400_000);
    await runPlanting({ repo, now: later, chain: fakeChain({ sendPlanting: async () => { throw new Error("custom program error"); }, signatureStatus: async () => "failed" }) });
    expect(plantings(repo)[1]).toMatchObject({ status: "failed", skrCarryInRaw: 500n });
    expect(await repo.skrCreditRaw("U")).toBe(500n);

    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 0, stORE: 100 } });
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: new Date(later.getTime() + 86_400_000), chain: recording(builds) });
    expect(builds.map((b) => [b.asset, b.skrCarryRaw])).toEqual([["stORE", undefined]]);
  });

  it("stands down before claiming or sending when another run spent the same remainder meanwhile", async () => {
    const repo = await seeded([83, 62, 70]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerSkrChangeRaw: async () => 500n }) });
    await addSwaps(repo, "W", "d2-");
    const spy = vi.spyOn(repo, "skrCreditRaw").mockResolvedValueOnce(500n).mockResolvedValueOnce(-500n);
    let sent = 0;
    const r = await runPlanting({ repo, now: new Date(NOW.getTime() + 86_400_000), chain: fakeChain({ sendPlanting: async () => { sent++; } }) });
    spy.mockRestore();
    expect(r.skipped).toEqual([{ wallet: "W", reason: "claimed elsewhere" }]);
    expect(sent).toBe(0);
    expect(plantings(repo)[1].status).toBe("failed");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
    expect(await repo.skrCreditRaw("U")).toBe(500n);
  });

  it("a failed remainder read carries nothing and records nothing", async () => {
    const repo = await seeded([83, 62, 70]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerSkrChangeRaw: async () => { throw new Error("rpc down"); } }) });
    expect(plantings(repo)[0]).toMatchObject({ status: "confirmed", skrSurplusRaw: null });
    expect(await repo.skrCreditRaw("U")).toBe(0n);
  });
});

// R207 review: the pooled puller SKR account holds other users' remainders, so the simulation's own balances must show the swap
// delivered: SKR may fall by at most this user's carry; a wallet coin's account must gain at least the minimum. Nothing is sent otherwise.
describe("the delivery check on the simulation (R207 review)", () => {
  const sim = (pre: bigint, post: bigint) => async () => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre, post } });
  const countSends = () => { const c = { n: 0 }; return { c, sendPlanting: async () => { c.n++; } }; };

  it("happy path: an SKR planting whose stake draws exactly this user's carry from the float is sent", async () => {
    const repo = await seeded([83, 62, 70]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerSkrChangeRaw: async () => 500n }) });
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `h${i}`, walletPubkey: "W", ts: new Date(NOW.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
    const { c, sendPlanting } = countSends();
    const r = await runPlanting({ repo, now: new Date(NOW.getTime() + 86_400_000), chain: fakeChain({ simulatePlanting: sim(10_000n, 9_500n), sendPlanting }) });
    expect(c.n).toBe(1);
    expect(r.planted.length).toBe(1);
  });

  it("refuses an SKR planting whose swap delivered short: the stake would draw on other users' remainders", async () => {
    const repo = await seeded([83, 62, 70]);
    const { c, sendPlanting } = countSends();
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ simulatePlanting: sim(10_000n, 9_999n), sendPlanting }) });
    expect(c.n).toBe(0);
    expect(r.skipped).toEqual([{ wallet: "W", reason: "simulation failed" }]);
    expect(JSON.stringify(repo.events.at(-1)?.detail)).toMatch(/fell by 1, more than this user's carry of 0/);
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
  });

  it("refuses an SKR planting whose stake draws more than this user's credit", async () => {
    const repo = await seeded([83, 62, 70]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerSkrChangeRaw: async () => 500n }) });
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `x${i}`, walletPubkey: "W", ts: new Date(NOW.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
    const { c, sendPlanting } = countSends();
    const r = await runPlanting({ repo, now: new Date(NOW.getTime() + 86_400_000), chain: fakeChain({ simulatePlanting: sim(10_000n, 9_499n), sendPlanting }) });
    expect(c.n).toBe(0);
    expect(r.skipped[0].reason).toBe("simulation failed");
  });

  it("refuses a wallet coin delivered elsewhere (the user's account gains nothing) and plants SKR instead", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 0, hSOL: 100 } });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({
      buildPlantingTx: async (a) => ({ tx: { asset: a.asset } as never, signature: `sig-${a.asset}`, expectedOutRaw: 48n, minOutRaw: 47n, lookupTables: [], lastValidBlockHeight: 0n }),
      simulatePlanting: async (b) => ({ ok: true, err: null, logs: [], units: 1, delivery: (b.tx as unknown as { asset: string }).asset === "hSOL" ? { pre: 100n, post: 146n } : { pre: 0n, post: 0n } }),
    }) });
    expect(r.planted[0]?.asset).toBe("SKR");
    expect(JSON.stringify(repo.events.find((e) => e.kind === "leg_fallback")?.detail)).toMatch(/gained 46, under the minimum 47/);
  });

  it("a simulation that reports no delivery balance fails closed", async () => {
    const repo = await seeded([83, 62, 70]);
    const { c, sendPlanting } = countSends();
    await runPlanting({ repo, now: NOW, chain: fakeChain({ simulatePlanting: async () => ({ ok: true, err: null, logs: [], units: 1 }), sendPlanting }) });
    expect(c.n).toBe(0);
  });
});

describe("lending legs pay nothing and never fall back to SKR (spec 2, R266)", () => {
  const lendOnly = { SKR: 0, stORE: 0, USDC_LEND: 100, SOL_LEND: 0, hSOL: 0, cbBTC: 0 };

  it("a lending leg that fails to build waits for the next run: no SKR planting, no pull, leg_skipped recorded", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: lendOnly });
    const built: string[] = [];
    const chain = fakeChain({ buildPlantingTx: async (a) => { built.push(a.asset); throw new Error("venue down"); } });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(built).toEqual(["USDC_LEND"]);
    expect(r.planted).toEqual([]);
    expect(r.skipped).toEqual([{ wallet: "W", reason: "leg failed" }]);
    expect(repo.events.map((e) => e.kind)).toContain("leg_skipped");
    expect(repo.events.map((e) => e.kind)).not.toContain("leg_fallback");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
  });

  it("a lending leg that fails simulation is skipped the same way", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: lendOnly });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ simulatePlanting: async () => ({ ok: false, err: "x", logs: [], units: 0 }) }) });
    expect(r.skipped[0].reason).toBe("leg failed");
  });

  it("the leg's fee in cents follows the leg: 0 for lending, 0.5% of the pull for a coin", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: lendOnly });
    await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(repo.legs[0]).toMatchObject({ asset: "USDC_LEND", feeCents: 0 });
    const repo2 = await seeded([83, 62, 70]);
    await repo2.saveRules("U", { allocation: { SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 100, cbBTC: 0 } });
    await runPlanting({ repo: repo2, now: NOW, chain: fakeChain() });
    expect(repo2.legs[0]).toMatchObject({ asset: "hSOL", feeCents: 1 });   // 218 cents x 50 / 10_000 = 1.09
  });
});
