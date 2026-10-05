import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { SKR_ONLY } from "@/domain/coins";
import { runPlanting, PRE_SEND_WAIT_S, PRE_BUILD_WAIT_S, BUILD_HEADROOM_S, type Chain } from "@/lib/plant-run";
import type { VenueDayRow } from "@/db/types";
import type { LeashConfig } from "@/lib/leash";

const NOW = new Date("2026-09-29T14:00:00Z");
const DELEGATION = { exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n };

/** T9 review I2, Task 11 review I1: every leg watches the puller's three pooled floats, USDC (PU), WSOL (PW), SKR (PS); a build stub carries them too. */
const FLOAT = { usdcFloat: "PU", wsolFloat: "PW", skrFloat: "PS", watched: ["PU", "PW", "PS"] };
/** ...and the simulation reports it unchanged (the swap spent exactly the pull). */
const HELD = { watched: { PU: { pre: 5_000n, post: 5_000n }, PW: { pre: 5_000n, post: 5_000n }, PS: { pre: 5_000n, post: 5_000n } } };

function fakeChain(over: Partial<Chain> = {}): Chain {
  let n = 0;
  return {
    readDelegation: async () => DELEGATION,
    usdcBalanceRaw: async () => 50_000_000n,
    // The signature is known once the puller signs. Every leg watches the puller's USDC float (PU, T9 review I2); SOL lending its
    // WSOL float (PW); Jupiter Lend the puller's jl account (PJ).
    buildPlantingTx: async (a) => ({
      tx: { asset: a.asset }, signature: `sig${++n}`, expectedOutRaw: a.pullRaw * 48n, minOutRaw: a.pullRaw * 47n, lookupTables: [], lastValidBlockHeight: 0n, asset: a.asset, venue: a.venue,
      usdcFloat: "PU", wsolFloat: "PW", skrFloat: a.asset === "SKR" ? null : "PS",
      watched: ["PU", "PW", ...(a.asset === "SKR" ? [] : ["PS"]), ...(a.venue === "jupiter_lend" ? ["PJ"] : [])], pullerJl: a.venue === "jupiter_lend" ? "PJ" : null,
      jlLeftover: a.venue === "jupiter_lend" ? (a.jlLeftover ?? 0n) : null, cleanup: [],
    }),
    // The delivery account gains the minimum; the floats hold; the jl account ends closed.
    simulatePlanting: async (b) => ({ ok: true, err: null, logs: [], units: 200_000, delivery: { pre: 1_000n, post: 1_000n + b.minOutRaw }, watched: Object.fromEntries((b.watched ?? []).map((x) => [x, { pre: 5_000n, post: x === "PJ" ? null : 5_000n }])) }),
    sendPlanting: async () => {},
    signatureStatus: async () => "pending",
    readShares: async () => 1_000_000_000n,
    sharePrice: async () => 1_146_000_000n,
    assetBalanceRaw: async () => 0n,
    pullerSkrChangeRaw: async () => 0n,
    readLeashConfig: async () => null,
    lendingPositions: async () => [],
    pullerCarryChangeRaw: async () => 0n,
    cleanup: async () => {},
    priceFresh: async () => {},
    ...over,
  };
}

/** Today's (NOW) venue rows: both auto venues eligible, Kamino ahead on its 7-day average, plus the underlying prices. */
async function seedVenues(repo: MemoryRepo, over: Partial<Record<"kamino_klend" | "jupiter_lend", Partial<VenueDayRow>>> = {}) {
  for (const asset of ["USDC_LEND", "SOL_LEND"] as const) {
    for (const [venue, pct, rate] of [["kamino_klend", 4.43, 1.2038], ["jupiter_lend", 4.19, 1.0629]] as const) {
      await repo.putVenueDay({ day: "2026-09-29", venue, asset, supplyPct: pct, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: rate, avg7Pct: pct, daysMeasured: 3, eligible: true, verdict: null, reason: null, served: null, ok: true, ...(over[venue] ?? {}) });
    }
    await repo.putCoinDay({ day: "2026-09-29", asset, rate: null, ratePrev: null, ratePrevDays: null, priceUsd: asset === "USDC_LEND" ? 1 : 121.47, liquidityUsd: null, priceChange24h: null, tradeable: true, lastUpdateEpoch: null, ok: true });
  }
}
const leashCfg = (enabled: number[]): LeashConfig => ({ puller: "P" as never, pullerUsdc: "PU" as never, maxPullRaw: 5_000_000n, legs: [0, 1, 2, 3, 4, 5, 6, 7].map((l) => ({ enabled: enabled.includes(l), reader: 0, feeBps: 0, tolBps: 0, confCapBps: 0, maxAgeS: 60, receiptMint: null, rateAccount: null, extra: null, feedId: null, feedAccount: null })) });

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
      return { tx: {} as never, signature: "sigF", expectedOutRaw: a.pullRaw * 48n, minOutRaw: a.pullRaw * 47n, lookupTables: [], lastValidBlockHeight: 0n, ...FLOAT };
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
      buildPlantingTx: async (a) => { built.push(a.asset); return { tx: { asset: a.asset } as never, signature: `sig-${a.asset}`, expectedOutRaw: a.pullRaw * 48n, minOutRaw: a.pullRaw * 47n, lookupTables: [], lastValidBlockHeight: 0n, ...FLOAT }; },
      simulatePlanting: async (b) => (b.tx as unknown as { asset: string }).asset === "stORE"
        ? { ok: false, err: { InstructionError: [3, "Custom"] }, logs: ["Program log: account not initialized"], units: 0 }
        : { ok: true, err: null, logs: [], units: 200_000, delivery: { pre: 0n, post: 0n }, ...HELD },
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
      [{ asset: "SKR", usdcInCents: 215, amountOutRaw: 1_146_000_000n, staked: true, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: null, venue: null }]);
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
      return { tx: {} as never, signature: "sigH", expectedOutRaw: a.pullRaw * 48n, minOutRaw: a.pullRaw * 47n, lookupTables: [], lastValidBlockHeight: 0n, ...FLOAT };
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
    expect(builds[0].carryIn.SKR).toBeUndefined();
    expect(plantings(repo)[0]).toMatchObject({ status: "confirmed", skrCarryInRaw: 0n, skrSurplusRaw: 500n });
    expect(await repo.skrCreditRaw("U")).toBe(500n);

    // Next day: the stake carries the 500; this swap left 300 above its minimum, the stake drew 500 more: the change is -200.
    await addSwaps(repo, "W", "d2-");
    const later = new Date(NOW.getTime() + 86_400_000);
    await runPlanting({ repo, now: later, chain: recording(builds, { pullerSkrChangeRaw: async () => -200n }) });
    expect(builds[1].carryIn.SKR).toBe(500n);
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
    expect(builds.map((b) => [b.user, b.carryIn.SKR])).toEqual([["U2", undefined]]);
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
    expect(builds.map((b) => [b.asset, b.carryIn.SKR])).toEqual([["stORE", undefined]]);
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
  const sim = (pre: bigint, post: bigint) => async () => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre, post }, ...HELD });
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
      buildPlantingTx: async (a) => ({ tx: { asset: a.asset } as never, signature: `sig-${a.asset}`, expectedOutRaw: 48n, minOutRaw: 47n, lookupTables: [], lastValidBlockHeight: 0n, ...FLOAT }),
      simulatePlanting: async (b) => ({ ok: true, err: null, logs: [], units: 1, delivery: (b.tx as unknown as { asset: string }).asset === "hSOL" ? { pre: 100n, post: 146n } : { pre: 0n, post: 0n }, ...HELD }),
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
    await seedVenues(repo);
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
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: lendOnly });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ simulatePlanting: async () => ({ ok: false, err: "x", logs: [], units: 0 }) }) });
    expect(r.skipped[0].reason).toBe("leg failed");
  });

  it("the leg's fee in cents follows the leg: 0 for lending, 0.5% of the pull for a coin", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: lendOnly });
    await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(repo.legs[0]).toMatchObject({ asset: "USDC_LEND", feeCents: 0 });
    const repo2 = await seeded([83, 62, 70]);
    await seedVenues(repo2);
    await repo2.saveRules("U", { allocation: { SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 100, cbBTC: 0 } });
    await runPlanting({ repo: repo2, now: NOW, chain: fakeChain() });
    expect(repo2.legs[0]).toMatchObject({ asset: "hSOL", feeCents: 1 });   // 218 cents x 50 / 10_000 = 1.09
  });
});

describe("venues, the leash and the carry in the run (contracts 3.2-3.4)", () => {
  type BuildArgs = Parameters<Chain["buildPlantingTx"]>[0];
  const lendOnly = { SKR: 0, stORE: 0, USDC_LEND: 100, SOL_LEND: 0, hSOL: 0, cbBTC: 0 };
  const recording = (builds: BuildArgs[], over: Partial<Chain> = {}) => { const base = fakeChain(over); return { ...base, buildPlantingTx: async (a: BuildArgs) => { builds.push(a); return base.buildPlantingTx(a); } } as Chain; };

  it("USDC goes to the best eligible venue; the leg records the venue and its exchange rate, no fee", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: lendOnly });
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds[0]).toMatchObject({ asset: "USDC_LEND", venue: "kamino_klend", leashed: false });
    expect(repo.legs[0]).toMatchObject({ asset: "USDC_LEND", venue: "kamino_klend", rateAtPlanting: 1.2038, feeCents: 0 });
  });

  it("no eligible venue: the lending share goes to the next leg by the split (spec 3)", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo, { kamino_klend: { eligible: false }, jupiter_lend: { verdict: "avoid", reason: "near_full" } });
    await repo.saveRules("U", { allocation: { ...lendOnly, USDC_LEND: 50, SKR: 50 } });
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds.map((b) => b.asset)).toEqual(["SKR"]);
  });

  it("from $20 of lending no protocol passes 60% (R293): new USDC goes to Jupiter when Kamino holds it all", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: lendOnly });
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds, { lendingPositions: async () => [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 20_000_000n }] }) });   // 20 x 1.2038 = $24.08
    expect(builds[0].venue).toBe("jupiter_lend");
  });

  it("Jupiter Lend: when the venue mints N shares the first simulation fails, and the rebuild with the 1-share burn is the one sent", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo, { kamino_klend: { eligible: false } });
    await repo.saveRules("U", { allocation: lendOnly });
    const builds: BuildArgs[] = [];
    const chain = recording(builds, {
      simulatePlanting: async (b) => (b.jlLeftover === 1n
        ? { ok: true, err: null, logs: [], units: 1, delivery: { pre: 0n, post: b.minOutRaw }, watched: { ...HELD.watched, PU: { pre: 5_000n, post: 5_000n }, PJ: { pre: null, post: null } } }
        : { ok: false, err: { InstructionError: [9, { Custom: 11 }] }, logs: ["Program log: Error: Non-native account can only be closed if its balance is zero"], units: 1 }),
    });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(builds.map((b) => b.jlLeftover)).toEqual([undefined, 1n]);
    expect(r.planted.length).toBe(1);
  });

  it("R297: with LEASH_LIVE=1 an old puller link is refused before any chain read", async () => {
    const repo = await seeded([83, 62, 70]);
    let reads = 0;
    process.env.LEASH_LIVE = "1";
    try {
      const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readDelegation: async () => { reads++; return DELEGATION; } }) });
      expect(r.skipped).toEqual([{ wallet: "W", reason: "relink needed" }]);
      expect(reads).toBe(0);
    } finally { delete process.env.LEASH_LIVE; }
    const r2 = await runPlanting({ repo, now: NOW, chain: fakeChain() });   // positive control: before go-live it plants, unleashed
    expect(r2.planted.length).toBe(1);
  });

  it("a leashed user's disabled legs water-fill the enabled legs to their stop maxes, the rest to USDC lending (R336 follow-up)", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { allocation: { SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 } });
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([3, 6]) }) });   // Day 1 without K-Lend: USDC on Jupiter Lend, hSOL
    // Balanced: SKR 45 + SOL 10 + cbBTC 10 moved; hSOL fills to its max 25, USDC to 30 and takes the other 40: USDC 75, hSOL 25.
    // (The old rule handed all 65 to hSOL: 85% in one volatile coin.)
    expect(builds[0]).toMatchObject({ asset: "USDC_LEND", venue: "jupiter_lend", leashed: true, pullRaw: 2_180_000n });
  });

  it("USDC lending disabled and every enabled leg at its max: only the enabled share is pulled, the rest stays in the wallet", async () => {
    const repo = await seeded([150, 150, 150]);   // 450 cents of change
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { stop: "careful", allocation: { SKR: 60, stORE: 0, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 20 } });
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([6, 7]) }) });
    // Careful maxes hSOL 15 + cbBTC 30 = 45%: 202 cents of change (+3 fee) pulled, not 450.
    expect(builds[0]).toMatchObject({ asset: "cbBTC", leashed: true, pullRaw: 2_050_000n });
    expect(r.planted[0]).toMatchObject({ pullCents: 205 });
  });

  it("a leashed user's USDC goes to Jupiter Lend when only its leash leg is enabled (the Day-1 fallback venue)", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { allocation: lendOnly });
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([3, 6]) }) });
    expect(builds[0]).toMatchObject({ asset: "USDC_LEND", venue: "jupiter_lend", leashed: true });
  });

  it("R339 mixed mode (LEASH_LIVE unset): one re-linked leash wallet plants only its enabled legs; a puller wallet in the same run plants SKR and stORE", async () => {
    delete process.env.LEASH_LIVE;
    const repo = await seeded([83, 62, 70]);   // U / W: the puller link, Bold-ish with SKR and stORE
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: { SKR: 40, stORE: 30, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 10 } });
    await repo.upsertUser({ seedVaultPubkey: "U2", sgtMint: "M2", skrName: null });
    await repo.addWallet({ pubkey: "W2", userPubkey: "U2", delegationPda: "D2", dailyCapCents: 500 });
    await repo.setWalletLink("W2", { delegationPda: "D2", linkModel: "leash" });
    await repo.saveRules("U2", { stop: "careful", allocation: { SKR: 60, stORE: 0, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 20 } });
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `w2-${i}`, walletPubkey: "W2", ts: new Date(NOW.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
    const builds: BuildArgs[] = [];
    // Day 1 with stORE: legs {1,2,6,7}; SKR (leg 0) stays off the leash.
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([1, 2, 6, 7]) }) });
    expect(r.planted.map((p) => p.wallet).sort()).toEqual(["W", "W2"]);
    const byWallet = Object.fromEntries(builds.map((b) => [b.delegator, b]));
    expect(byWallet.W).toMatchObject({ asset: "SKR", leashed: false });   // the puller wallet: everything, SKR first
    expect(byWallet.W2.leashed).toBe(true);
    expect(["stORE", "USDC_LEND", "hSOL", "cbBTC"]).toContain(byWallet.W2.asset);   // never SKR while leg 0 is off
    // Next day the puller wallet's stORE share is planted too (its largest gap after an SKR day).
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `d2-${i}`, walletPubkey: "W", ts: new Date(NOW.getTime() + 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
    const later = new Date(NOW.getTime() + 86_400_000);
    const b2: BuildArgs[] = [];
    await runPlanting({ repo, now: later, chain: recording(b2, { readLeashConfig: async () => leashCfg([1, 2, 6, 7]) }) });
    expect(b2.find((b) => b.delegator === "W")).toMatchObject({ asset: "stORE", leashed: false });
  });

  it("a leashed user plants nothing when the config cannot be read, or no leg is enabled", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    expect((await runPlanting({ repo, now: NOW, chain: fakeChain() })).skipped[0].reason).toBe("leash unavailable");
    expect((await runPlanting({ repo, now: NOW, chain: fakeChain({ readLeashConfig: async () => leashCfg([]) }) })).skipped[0].reason).toBe("no leg enabled");
  });

  it("the WSOL float may fall by at most this user's WSOL carry (Review Focus 3), with its positive control", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: { ...lendOnly, USDC_LEND: 0, SOL_LEND: 100 } });
    const drains = { simulatePlanting: async (b: Parameters<Chain["simulatePlanting"]>[0]) => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre: 0n, post: b.minOutRaw }, watched: { ...HELD.watched, PW: { pre: 5_000n, post: 4_990n }, PU: { pre: 5_000n, post: 5_000n } } }) };
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain(drains) });
    expect(r.skipped[0].reason).toBe("leg failed");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
    repo.carryCreditRaw = async (_u: string, k: string) => (k === "WSOL" ? 10n : 0n);
    expect((await runPlanting({ repo, now: NOW, chain: fakeChain(drains) })).planted.length).toBe(1);
  });

  it("Jupiter Lend is refused while the puller's jl account survives the planting", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo, { kamino_klend: { eligible: false } });
    await repo.saveRules("U", { allocation: lendOnly });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ simulatePlanting: async (b) => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre: 0n, post: b.minOutRaw }, watched: { ...HELD.watched, PU: { pre: 5_000n, post: 5_000n }, PJ: { pre: null, post: 1n } } }) }) });
    expect(r.skipped[0].reason).toBe("leg failed");
  });

  it("a leashed SKR planting still bounds the puller's pooled SKR float (R207)", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readLeashConfig: async () => leashCfg([0]), simulatePlanting: async () => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre: 5_000n, post: 4_999n }, watched: {} }) }) });
    expect(r.skipped[0].reason).toBe("simulation failed");
  });

  it("records the WSOL surplus after confirmation and passes it into the same user's next SOL planting (R295)", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: { ...lendOnly, USDC_LEND: 0, SOL_LEND: 100 } });
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds, { pullerCarryChangeRaw: async () => 1_234n }) });
    expect(await repo.carryCreditRaw("U", "WSOL")).toBe(1_234n);
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `n${i}`, walletPubkey: "W", ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
    await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds[1].carryIn).toEqual({ WSOL: 1_234n });
  });
});

import { LEASH_PROGRAM } from "@/lib/constants";
import { dayOf } from "@/domain/day";

describe("Task 11 carry-ins (T7/T8/T9 reviews)", () => {
  type BuildArgs = Parameters<Chain["buildPlantingTx"]>[0];
  const lendOnly = { SKR: 0, stORE: 0, USDC_LEND: 100, SOL_LEND: 0, hSOL: 0, cbBTC: 0 };
  const hsolOnly = { SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 100, cbBTC: 0 };
  const recording = (builds: BuildArgs[], over: Partial<Chain> = {}) => { const base = fakeChain(over); return { ...base, buildPlantingTx: async (a: BuildArgs) => { builds.push(a); return base.buildPlantingTx(a); } } as Chain; };
  const addSwaps = async (repo: MemoryRepo, wallet: string, tag: string) => {
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `${tag}${i}`, walletPubkey: wallet, ts: new Date(NOW.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
  };
  const leashed = async (allocation = hsolOnly) => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { allocation });
    return repo;
  };
  const settleMismatch = { ok: false, err: { InstructionError: [7, { Custom: 6007 }] }, logs: [`Program ${LEASH_PROGRAM} failed: custom program error: 0x1777`], units: 1 };

  // 1. The carry cap.
  it("carry: the build carries exactly this user's own credit, and a credit at or below zero carries nothing", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: lendOnly });
    repo.carryCreditRaw = async (_u: string, k: string) => (k === "USDC" ? -700n : 0n);
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds[0].carryIn).toEqual({});
    expect(repo.carry.filter((c) => c.carryInRaw > 0n)).toEqual([]);   // nothing reserved
    // Positive control: a credit of 700 carries exactly 700, no more.
    const repo2 = await seeded([83, 62, 70]);
    await seedVenues(repo2);
    await repo2.saveRules("U", { allocation: lendOnly });
    repo2.carryCreditRaw = async (_u: string, k: string) => (k === "USDC" ? 700n : 0n);
    await runPlanting({ repo: repo2, now: NOW, chain: recording(builds) });
    expect(builds[1].carryIn).toEqual({ USDC: 700n });
    expect(repo2.carry.map((c) => c.carryInRaw)).toEqual([700n]);
  });

  it("carry: a Jupiter Lend rebuild reuses the same carry, the planting reserves it once, and confirmation settles it once", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo, { kamino_klend: { eligible: false } });
    await repo.saveRules("U", { allocation: lendOnly });
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerCarryChangeRaw: async () => 500n }) });
    expect(await repo.carryCreditRaw("U", "USDC")).toBe(500n);
    await addSwaps(repo, "W", "d2-");
    const builds: BuildArgs[] = [];
    let sims = 0;
    const later = new Date(NOW.getTime() + 86_400_000);
    await seedVenues(repo, { kamino_klend: { eligible: false } });
    for (const v of [...repo.venueDays.values()]) await repo.putVenueDay({ ...v, day: "2026-09-30" });
    for (const asset of ["USDC_LEND", "SOL_LEND"] as const) await repo.putCoinDay({ ...(await repo.getCoinDay("2026-09-29", asset))!, day: "2026-09-30" });
    const chain = recording(builds, {
      // The first simulation fails (the leftover guess), the rebuild passes; the deposit drew all 500 of the carry: the float fell by 500.
      simulatePlanting: async (b) => (++sims === 1 ? { ok: false, err: "x", logs: [], units: 1 }
        : { ok: true, err: null, logs: [], units: 1, delivery: { pre: 0n, post: b.minOutRaw }, watched: { ...HELD.watched, PU: { pre: 5_000n, post: 4_500n }, PJ: { pre: null, post: null } } }),
      pullerCarryChangeRaw: async () => -500n,
    });
    const r = await runPlanting({ repo, now: later, chain });
    expect(r.planted.length).toBe(1);
    expect(builds.map((b) => b.carryIn)).toEqual([{ USDC: 500n }, { USDC: 500n }]);
    expect(repo.carry.filter((c) => c.carryInRaw > 0n).length).toBe(1);
    expect(await repo.carryCreditRaw("U", "USDC")).toBe(0n);   // 500 earned - 500 drawn + 0 left over: drawn once, not twice
  });

  // 2. T9 review I2: the swap's input is bound to the pull.
  it("I2: a swap leg whose puller USDC falls (the swap spent more than the pull) is refused; the same leg with the float held plants", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: hsolOnly });
    const drain = { simulatePlanting: async (b: Parameters<Chain["simulatePlanting"]>[0]) => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre: 0n, post: b.minOutRaw }, watched: { ...HELD.watched, PU: { pre: 5_000n, post: 4_999n } } }) };
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain(drain) });
    expect(r.planted).toEqual([]);   // hSOL refused, and its SKR fallback too (the same drain)
    expect(JSON.stringify(repo.events.find((e) => e.kind === "leg_fallback")?.detail)).toMatch(/puller's USDC fell by 1, more than this user's carry of 0/);
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
    expect((await runPlanting({ repo, now: NOW, chain: fakeChain() })).planted[0].asset).toBe("hSOL");
  });

  it("I2: SOL lending binds both floats: its WSOL holds but its USDC falls, refused", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: { ...lendOnly, USDC_LEND: 0, SOL_LEND: 100 } });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ simulatePlanting: async (b) => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre: 0n, post: b.minOutRaw }, watched: { ...HELD.watched, PW: { pre: 5_000n, post: 5_000n }, PU: { pre: 5_000n, post: 4_000n } } }) }) });
    expect(r.skipped[0].reason).toBe("leg failed");
  });

  // 3. Run-level prices.
  it("prices: one leash read per run, one wait per FEED (all feeds at once), bounded waits before the build (with headroom) and the send, builds with waitS 0 and the on-chain cap and age", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { allocation: hsolOnly });
    await repo.upsertUser({ seedVaultPubkey: "U2", sgtMint: "M2", skrName: null });
    await repo.addWallet({ pubkey: "W2", userPubkey: "U2", delegationPda: "D2", dailyCapCents: 500, linkModel: "leash" });
    await repo.saveRules("U2", { allocation: hsolOnly });
    await addSwaps(repo, "W2", "u2-");
    const cfg = leashCfg([6, 7]);
    cfg.legs[6] = { ...cfg.legs[6], confCapBps: 150, maxAgeS: 90 };
    cfg.legs[7] = { ...cfg.legs[7], confCapBps: 200, maxAgeS: 600 };
    let reads = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const waits: [number, number][] = [];
    const checks: [number, number, number][] = [];
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds, {
      readLeashConfig: async () => { reads++; return cfg; },
      priceFresh: async (leg, c, waitS) => {
        if (waitS !== 60) { checks.push([leg, c.maxAgeS, waitS]); return; }
        waits.push([leg, waitS]);
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((res) => setTimeout(res, 5));
        inFlight--;
      },
    }) });
    expect(r.planted.length).toBe(2);
    expect(reads).toBe(1);
    expect(waits.sort()).toEqual([[6, 60], [7, 60]]);   // SOL once (two users on it), cbBTC once
    expect(maxInFlight).toBe(2);                        // the two feeds wait at the same time
    expect(builds.map((b) => b.priceOpts)).toEqual([{ waitS: 0, confCapBps: 150, maxAgeS: 90 }, { waitS: 0, confCapBps: 150, maxAgeS: 90 }]);
    // Per wallet (review I2): before the build up to 20 s for a price with 5 s to spare (max age 90 - 5), right before the send up to 15 s.
    expect(checks.sort()).toEqual([[6, 85, 20], [6, 85, 20], [6, 90, 15], [6, 90, 15]]);   // two wallets, run concurrently
  });

  it("prices: a price unusable at send sends nothing; the round-ups and THIS planting's WSOL carry go back and the leg waits (review M7)", async () => {
    const repo = await leashed({ ...hsolOnly, hSOL: 0, SOL_LEND: 100 });
    const cfg = leashCfg([4, 5]);
    const builds: BuildArgs[] = [];
    let sent = 0;
    // Day 1 plants on Kamino (leg 4) and leaves 300 WSOL with the puller: this user's carry.
    await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => cfg, pullerCarryChangeRaw: async () => 300n, sendPlanting: async () => { sent++; } }) });
    expect(await repo.carryCreditRaw("U", "WSOL")).toBe(300n);
    // Day 2: the build carries the 300; the price goes stale between the build and the send and does not come back within 15 s.
    await addSwaps(repo, "W", "d2-");
    for (const v of [...repo.venueDays.values()]) await repo.putVenueDay({ ...v, day: "2026-09-30" });
    for (const asset of ["USDC_LEND", "SOL_LEND"] as const) await repo.putCoinDay({ ...(await repo.getCoinDay("2026-09-29", asset))!, day: "2026-09-30" });
    const r = await runPlanting({ repo, now: new Date(NOW.getTime() + 86_400_000), chain: recording(builds, {
      readLeashConfig: async () => cfg,
      priceFresh: async (_l, _c, waitS) => { if (waitS === PRE_SEND_WAIT_S) throw new Error("sponsored SOL price is 61 s old"); },
      sendPlanting: async () => { sent++; },
    }) });
    expect(builds.map((b) => b.carryIn)).toEqual([{}, { WSOL: 300n }]);
    expect(r.skipped).toEqual([{ wallet: "W", reason: "leg failed" }]);
    expect(sent).toBe(1);
    expect([...repo.plantings.values()].map((p) => p.status)).toEqual(["confirmed", "failed"]);
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
    expect(await repo.carryCreditRaw("U", "WSOL")).toBe(300n);   // reserved by the failed row, now given back
    expect(JSON.stringify(repo.events.find((e) => e.kind === "leg_skipped")?.detail)).toMatch(/price unusable at send/);
  });

  // 4. T9 review M4: SettleMismatch.
  it("6007: a SettleMismatch in simulation is rebuilt once, and the rebuild is the one sent", async () => {
    const repo = await leashed();
    const builds: BuildArgs[] = [];
    let sims = 0;
    const base = fakeChain();
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([0, 6]), simulatePlanting: async (b) => (++sims === 1 ? settleMismatch : base.simulatePlanting(b)) }) });
    expect(builds.map((b) => b.asset)).toEqual(["hSOL", "hSOL"]);
    expect(r.planted).toEqual([{ wallet: "W", asset: "hSOL", pullCents: 218, signature: "sig2" }]);
  });

  it("6007 twice: the leg is skipped (no SKR fallback) and a repeat on a later run raises an alert", async () => {
    const repo = await leashed();
    const builds: BuildArgs[] = [];
    const chain = recording(builds, { readLeashConfig: async () => leashCfg([0, 6]), simulatePlanting: async () => settleMismatch });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "leg failed" }]);
    expect(builds.map((b) => b.asset)).toEqual(["hSOL", "hSOL"]);
    expect(repo.events.map((e) => e.kind)).not.toContain("leg_fallback");
    expect(repo.events.find((e) => e.kind === "leg_skipped")?.detail).toMatchObject({ asset: "hSOL", leashError: "SettleMismatch", alert: false });
    const log = vi.spyOn(console, "error");
    await runPlanting({ repo, now: new Date(NOW.getTime() + 86_400_000), chain });
    expect(log.mock.calls.some((c) => /^ALERT: leash SettleMismatch/.test(String(c[0])))).toBe(true);
    log.mockRestore();
    expect(repo.events.filter((e) => e.kind === "leg_skipped").at(-1)?.detail).toMatchObject({ leashError: "SettleMismatch", alert: true });
  });

  it("6007 from another program (a Jupiter error code) is not a SettleMismatch: no rebuild", async () => {
    const repo = await leashed();
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([6]), simulatePlanting: async () => ({ ...settleMismatch, logs: ["Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1777"] }) }) });
    expect(builds.length).toBe(1);
  });

  // 9. SKR has no price source under the leash.
  it("a leashed SKR leg is skipped when it has no price source: no build, no fallback, not an outage; unleashed SKR still plants", async () => {
    const repo = await leashed({ ...hsolOnly, hSOL: 0, SKR: 100 });
    const builds: BuildArgs[] = [];
    const noSkrPrice = { readLeashConfig: async () => leashCfg([0]), priceFresh: async (leg: number) => { if (leg === 0) throw new Error("leg 0 (SKR) has no price source"); } };
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds, noSkrPrice) });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "leg failed" }]);
    expect(builds).toEqual([]);
    expect(repo.events.find((e) => e.kind === "leg_skipped")?.detail).toMatchObject({ asset: "SKR" });
    // A leashed coin leg that fails falls back to SKR only to be skipped there, never planted unpriced or counted as a build failure.
    const repo2 = await leashed();
    const r2 = await runPlanting({ repo: repo2, now: NOW, chain: fakeChain({ ...noSkrPrice, readLeashConfig: async () => leashCfg([0, 6]), buildPlantingTx: async () => { throw new Error("Jupiter: no route"); } }) });
    expect(r2.skipped).toEqual([{ wallet: "W", reason: "leg failed" }]);
    expect(repo2.events.map((e) => e.kind)).toEqual(["leg_skipped"]);   // review M4: no misleading leg_fallback for a leashed user
    // Unleashed users keep today's SKR path, with the same chain.
    const repo3 = await seeded([83, 62, 70]);
    expect((await runPlanting({ repo: repo3, now: NOW, chain: fakeChain(noSkrPrice) })).planted[0].asset).toBe("SKR");
  });

  // 10. leg_skipped at most once per user per day for the same reason.
  it("a leg skipped on every run is recorded once per user per day for the same reason, again the next day", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: lendOnly });
    const chain = fakeChain({ buildPlantingTx: async () => { throw new Error(`venue down at slot ${Math.random()}`); } });
    await runPlanting({ repo, now: NOW, chain });
    await runPlanting({ repo, now: new Date(NOW.getTime() + 3_600_000), chain });
    expect(repo.events.filter((e) => e.kind === "leg_skipped").length).toBe(1);
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    for (const v of [...repo.venueDays.values()]) await repo.putVenueDay({ ...v, day: "2026-09-30" });
    await runPlanting({ repo, now: tomorrow, chain });
    expect(repo.events.filter((e) => e.kind === "leg_skipped").length).toBe(2);
  });
});

describe("Task 11 fix round 1 (review I1, I2, M1-M4, M7, M9)", () => {
  type BuildArgs = Parameters<Chain["buildPlantingTx"]>[0];
  type Sim = Parameters<Chain["simulatePlanting"]>[0];
  const hsolOnly = { SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 100, cbBTC: 0 };
  const ok = (b: Sim, watched: Record<string, { pre: bigint | null; post: bigint | null }>) => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre: 0n, post: b.minOutRaw }, watched: { ...HELD.watched, ...watched } });
  const assetOf = (b: Sim) => (b.tx as { asset: string }).asset;
  const leashed = async (allocation: Record<string, number> = hsolOnly) => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { allocation: allocation as never });
    return repo;
  };
  const addSwaps = async (repo: MemoryRepo, wallet: string, tag: string, now = NOW) => {
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `${tag}${i}`, walletPubkey: wallet, ts: new Date(now.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
  };

  // I1: every pooled float on every leg.
  it("I1: an hSOL route that spends the pooled SKR float (other users' remainders) instead of the pull is refused, with an ALERT", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: hsolOnly });
    const log = vi.spyOn(console, "error");
    // The forged route: the USDC float RISES by the unspent pull, the user still gets the minimum, 1000 SKR leave the puller's SKR float.
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ simulatePlanting: async (b) => (assetOf(b) === "hSOL" ? ok(b, { PU: { pre: 5_000n, post: 2_185_000n }, PS: { pre: 5_000n, post: 4_000n } }) : ok(b, {})) }) });
    const alerts = log.mock.calls.filter((c) => /^ALERT: guard refusal on hSOL/.test(String(c[0])));
    log.mockRestore();
    expect(r.planted[0]?.asset).toBe("SKR");   // unleashed: the coin leg falls back, the SKR leg is clean
    expect(JSON.stringify(repo.events.find((e) => e.kind === "leg_fallback")?.detail)).toMatch(/puller's SKR fell by 1000, more than this user's carry of 0/);
    expect(alerts.length).toBe(1);
  });

  it("I1: an SKR leg whose route closes the pooled wSOL account (every user's WSOL carry) is refused", async () => {
    const repo = await seeded([83, 62, 70]);
    let sent = 0;
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ sendPlanting: async () => { sent++; }, simulatePlanting: async (b) => ({ ...ok(b, { PW: { pre: 9_000n, post: null } }), delivery: { pre: 1_000n, post: 1_000n } }) }) });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "simulation failed" }]);
    expect(sent).toBe(0);
    expect(JSON.stringify(repo.events.at(-1)?.detail)).toMatch(/puller's WSOL fell by 9000/);
  });

  it("I1: SOL lending may draw its own WSOL carry but no SKR, and USDC lending no WSOL", async () => {
    const repo = await leashed({ ...hsolOnly, hSOL: 0, SOL_LEND: 100 });
    repo.carryCreditRaw = async (_u: string, k: string) => (k === "WSOL" ? 10n : 0n);
    const cfg = { readLeashConfig: async () => leashCfg([2, 4]) };
    const own = await runPlanting({ repo, now: NOW, chain: fakeChain({ ...cfg, sendPlanting: async () => { throw new Error("socket"); }, simulatePlanting: async (b) => ok(b, { PW: { pre: 5_000n, post: 4_990n } }) }) });
    expect(own.skipped[0].reason).toBe("send unknown");   // passed every guard (positive control)
    const repo2 = await leashed({ ...hsolOnly, hSOL: 0, SOL_LEND: 100 });
    repo2.carryCreditRaw = async (_u: string, k: string) => (k === "WSOL" ? 10n : 0n);
    expect((await runPlanting({ repo: repo2, now: NOW, chain: fakeChain({ ...cfg, simulatePlanting: async (b) => ok(b, { PW: { pre: 5_000n, post: 4_990n }, PS: { pre: 5_000n, post: 4_999n } }) }) })).skipped[0].reason).toBe("leg failed");
    const repo3 = await leashed({ ...hsolOnly, hSOL: 0, USDC_LEND: 100 });
    expect((await runPlanting({ repo: repo3, now: NOW, chain: fakeChain({ ...cfg, simulatePlanting: async (b) => ok(b, { PW: { pre: 5_000n, post: 4_999n } }) }) })).skipped[0].reason).toBe("leg failed");
  });

  // I2: the price phase. A virtual Pyth feed publishes every 50-55 s (measured 10-04 for SOL and ORE); a price is usable while
  // younger than max age - 20 s. The build reads it with no wait a moment after the pre-build check; quote, sign, simulate and the
  // database writes take a few seconds before the pre-send check.
  const lcg = (seed: number) => { let x = seed >>> 0; return () => (x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32; };
  function world(seed: number) {
    const rnd = lcg(seed);
    const pubs: number[] = [];
    for (let p = -rnd() * 55; p < 2_000; p += 50 + 5 * rnd()) pubs.push(p);
    let t = rnd() * 55;   // the run starts at a random phase of the update cycle
    const last = () => Math.max(...pubs.filter((p) => p <= t));
    const fresh = (maxAgeS: number) => t - last() < maxAgeS - 20;
    return {
      advance: (lo: number, hi: number) => { t += lo + (hi - lo) * rnd(); },
      fresh,
      priceFresh: async (_leg: number, c: { maxAgeS: number }, waitS: number) => {
        if (fresh(c.maxAgeS)) return;
        const next = Math.min(...pubs.filter((p) => p > t));
        if (next - t <= waitS) { t = next; return; }
        t += waitS;
        throw new Error("sponsored price is stale");
      },
    };
  }
  async function skipRate(oldDesign: boolean) {
    const legs: [string, number, Record<string, number>][] = [["hSOL", 6, hsolOnly], ["stORE", 1, { ...hsolOnly, hSOL: 0, stORE: 100 }], ["SOL_LEND", 4, { ...hsolOnly, hSOL: 0, SOL_LEND: 100 }]];
    let runs = 0;
    let skips = 0;
    for (const [, leg, allocation] of legs) {
      for (let i = 0; i < 100; i++) {
        const wd = world(1_000 * leg + i);
        const repo = await leashed(allocation);
        const r = await runPlanting({ repo, now: NOW, chain: fakeChain({
          readLeashConfig: async () => leashCfg([2, leg]),
          // The wallet's turn comes anywhere in the first 150 s of the run (other wallets plant first): a random phase again.
          readDelegation: async () => { wd.advance(0, 150); return DELEGATION; },
          // The old design (c4530b5): no wait before the build or the send, no headroom.
          priceFresh: async (l, c, waitS) => wd.priceFresh(l, oldDesign && waitS !== PRICE_WAIT ? { maxAgeS: 60 } : c, oldDesign && waitS !== PRICE_WAIT ? 0 : waitS),
          buildPlantingTx: async (a) => {
            wd.advance(0.2, 0.8);                                                  // the builder's own no-wait read (and the second read)
            if (!wd.fresh(a.priceOpts?.maxAgeS ?? 60)) throw new Error("sponsored price stale at build");
            wd.advance(1, 3);                                                      // quote, swap instructions, sign
            return fakeChain().buildPlantingTx(a);
          },
          simulatePlanting: async (b) => { wd.advance(1, 4); return fakeChain().simulatePlanting(b); },   // simulate + DB writes
        }) });
        runs++;
        if (!r.planted.length) skips++;
      }
    }
    return { runs, skips, rate: skips / runs };
  }
  const PRICE_WAIT = 60;

  it("I2: with the measured 50-55 s SOL/ORE update gaps a leashed SOL lending / stORE / hSOL planting rarely skips (old design: often)", async () => {
    const now = await skipRate(false);
    const old = await skipRate(true);
    console.log(`I2 skip rate over ${now.runs} leashed plantings at random phases: ${now.skips} (${(now.rate * 100).toFixed(1)}%); the c4530b5 design: ${old.skips} (${(old.rate * 100).toFixed(1)}%)`);
    expect(now.rate).toBeLessThanOrEqual(0.01);
    expect(old.rate).toBeGreaterThan(0.1);   // the instrument can see the problem
    expect([PRE_BUILD_WAIT_S, PRE_SEND_WAIT_S, BUILD_HEADROOM_S]).toEqual([20, 15, 5]);
  });

  it("I2: a dead feed (its run-level wait failed) fails fast: no wait before the build", async () => {
    const repo = await leashed();
    const waits: number[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readLeashConfig: async () => leashCfg([6]), priceFresh: async (_l, _c, waitS) => { waits.push(waitS); throw new Error("feed down"); } }) });
    expect(r.skipped[0].reason).toBe("leg failed");
    expect(waits).toEqual([60, 0]);
  });

  // M1: the run deadline.
  it("M1: past the run deadline no new wallet starts; each is skipped as 'run deadline' and the log names them", async () => {
    const repo = await seeded([83, 62, 70]);
    let builds = 0;
    const log = vi.spyOn(console, "error");
    const r = await runPlanting({ repo, now: NOW, deadlineMs: Date.now() - 1, chain: fakeChain({ buildPlantingTx: async (a) => { builds++; return fakeChain().buildPlantingTx(a); } }) });
    const line = log.mock.calls.find((c) => /planting run deadline reached: 1 wallet\(s\) not started \(W\)/.test(String(c[0])));
    log.mockRestore();
    expect(r.skipped).toEqual([{ wallet: "W", reason: "run deadline" }]);
    expect(builds).toBe(0);
    expect(line).toBeTruthy();
    expect((await runPlanting({ repo, now: NOW, deadlineMs: Date.now() + 60_000, chain: fakeChain() })).planted.length).toBe(1);   // positive control
  });

  // M2: the dedupe key.
  it("M2: distinct leash error codes on one day are distinct events; two wallets of one user each get theirs", async () => {
    const repo = await leashed();
    await repo.addWallet({ pubkey: "W2", userPubkey: "U", delegationPda: "D2", dailyCapCents: 500, linkModel: "leash" });
    await addSwaps(repo, "W2", "w2-");
    const fail = (code: string) => async () => ({ ok: false, err: "x", logs: [`Program ${LEASH_PROGRAM} failed: custom program error: ${code}`], units: 1 });
    const cfg = { readLeashConfig: async () => leashCfg([6]) };
    await runPlanting({ repo, now: NOW, chain: fakeChain({ ...cfg, simulatePlanting: fail("0x1778") }) });   // BelowFloor, both wallets
    await runPlanting({ repo, now: NOW, chain: fakeChain({ ...cfg, simulatePlanting: fail("0x1779") }) });   // Underdelivered, both wallets
    await runPlanting({ repo, now: NOW, chain: fakeChain({ ...cfg, simulatePlanting: fail("0x1779") }) });   // the same again: deduped
    const skips = repo.events.filter((e) => e.kind === "leg_skipped").map((e) => [e.walletPubkey, /0x177[0-9a-f]/.exec(JSON.stringify(e.detail))?.[0]]);
    expect(skips.sort()).toEqual([["W", "0x1778"], ["W", "0x1779"], ["W2", "0x1778"], ["W2", "0x1779"]]);
  });

  // M3: the 6007 repeat window.
  it("M3: a SettleMismatch repeat alerts within 7 days only", async () => {
    const repo = await leashed();
    const sm = { ok: false, err: "x", logs: [`Program ${LEASH_PROGRAM} failed: custom program error: 0x1777`], units: 1 };
    const chain = fakeChain({ readLeashConfig: async () => leashCfg([6]), simulatePlanting: async () => sm });
    await runPlanting({ repo, now: NOW, chain });
    const later = new Date(NOW.getTime() + 8 * 86_400_000);
    for (const v of [...repo.venueDays.values()]) await repo.putVenueDay({ ...v, day: dayOf(later) });
    await runPlanting({ repo, now: later, chain });
    expect(repo.events.filter((e) => e.kind === "leg_skipped").map((e) => (e.detail as { alert: boolean }).alert)).toEqual([false, false]);
  });

  // M9: a booking throw after `confirmed` still credits the surplus.
  it("M9: a booking that throws after the planting is confirmed still credits its WSOL surplus", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: { ...hsolOnly, hSOL: 0, SOL_LEND: 100 } });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readShares: (() => { let n = 0; return async () => { if (++n > 1) throw new Error("rpc down"); return 1_000_000_000n; }; })(), pullerCarryChangeRaw: async () => 777n }) });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "send unknown" }]);   // the booking was interrupted
    expect([...repo.plantings.values()][0].status).toBe("confirmed");
    expect(await repo.carryCreditRaw("U", "WSOL")).toBe(777n);
  });
});
