import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { SKR_ONLY } from "@/domain/coins";
import { runPlanting, PRE_SEND_WAIT_S, PRE_BUILD_WAIT_S, BUILD_HEADROOM_S, type Chain } from "@/lib/plant-run";
import { JupiterRateLimited } from "@/lib/jupiter";
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

/** First planting (domain/threshold.ts): a user past their first planting, so their own threshold ($2 by default) applies. */
async function pastPlanting(repo: MemoryRepo, user = "U", wallet = "W") {
  const p = await repo.insertPlanting({ userPubkey: user, walletPubkey: wallet, signature: `past-${user}`, usdcPulledCents: 200, networkFeeCents: 0, status: "sent", aiLine: null, ts: new Date(NOW.getTime() - 30 * 86_400_000) }, []);
  await repo.setPlantingStatus(p.id, "confirmed");
}

async function seeded(roundups: number[], opts: { cap?: number; ago?: number; planted?: boolean } = {}) {
  const repo = new MemoryRepo();
  await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
  await repo.addWallet({ pubkey: "W", userPubkey: "U", delegationPda: "D", dailyCapCents: opts.cap ?? 500 });
  if (opts.planted) await pastPlanting(repo);
  for (const [i, c] of roundups.entries()) {
    await repo.insertSwap({ signature: `s${i}`, walletPubkey: "W", ts: new Date(NOW.getTime() - (opts.ago ?? 3_600_000)), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
  }
  return repo;
}

/** R-O1 (10-21): stORE switched off (manager on, a 0 pin, R346), for tests of other legs' mechanics: the stORE floor would otherwise send
 * every other planting to stORE. The floor itself is tested in "the stORE floor in the planting run". */
const storeOff = (repo: MemoryRepo) => repo.saveRules("U", { managed: true, pins: { stORE: 0 } });

describe("the stORE floor in the planting run (R-O1, 10-21)", () => {
  type BuildArgs = Parameters<Chain["buildPlantingTx"]>[0];
  const recording = (builds: BuildArgs[], over: Partial<Chain> = {}) => { const base = fakeChain(over); return { ...base, buildPlantingTx: async (a: BuildArgs) => { builds.push(a); return base.buildPlantingTx(a); } } as Chain; };

  it("a manager-off user with the saved SKR 100 default gets a stORE leg: the run plants toward SKR 90 / stORE 10", async () => {
    const repo = await seeded([83, 62, 70]);
    expect((await repo.getRules("U")).allocation).toEqual(SKR_ONLY);   // the saved split is the default, never recomputed
    expect((await repo.getRules("U")).managed).toBe(false);
    await repo.bumpLedger("W", "SKR", 1_000);                          // SKR already holds everything delivered: stORE sits 10 points under
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds.map((b) => b.asset)).toEqual(["stORE"]);
    expect(r.planted[0]).toMatchObject({ asset: "stORE", pullCents: 215 });
    expect(repo.legs[0]).toMatchObject({ asset: "stORE" });
    expect((await repo.getRules("U")).allocation).toEqual(SKR_ONLY);   // nothing written back: the floor is applied at planting time only
  });

  it("over the plantings the floor is honoured: about one in ten goes to stORE, the rest to SKR", async () => {
    const repo = await seeded([215]);
    const assets: string[] = [];
    for (let d = 0; d < 10; d++) {
      if (d > 0) await repo.insertSwap({ signature: `d${d}`, walletPubkey: "W", ts: new Date(NOW.getTime() + d * 86_400_000 - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 215 });
      const r = await runPlanting({ repo, now: new Date(NOW.getTime() + d * 86_400_000), chain: fakeChain() });
      assets.push(r.planted[0].asset);
    }
    expect(assets.filter((a) => a === "stORE").length).toBe(1);
    expect(assets.filter((a) => a === "SKR").length).toBe(9);
  });

  it("stORE switched off by the user (manager on, a 0 pin): no stORE leg", async () => {
    const repo = await seeded([83, 62, 70]);
    await storeOff(repo);
    await repo.bumpLedger("W", "SKR", 1_000);
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds.map((b) => b.asset)).toEqual(["SKR"]);
  });

  it("stORE switched off with the manager off (10-23, a 0 pin): never planted over ten days", async () => {
    const repo = await seeded([215]);
    await repo.saveRules("U", { managed: false, pins: { stORE: 0 } });
    const assets: string[] = [];
    for (let d = 0; d < 10; d++) {
      if (d > 0) await repo.insertSwap({ signature: `m${d}`, walletPubkey: "W", ts: new Date(NOW.getTime() + d * 86_400_000 - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 215 });
      const r = await runPlanting({ repo, now: new Date(NOW.getTime() + d * 86_400_000), chain: fakeChain() });
      assets.push(r.planted[0].asset);
    }
    expect(assets.filter((a) => a === "stORE").length).toBe(0);
  });

  it("stORE's leash leg disabled for a leashed user: no stORE leg, the floor gives way", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.bumpLedger("W", "SKR", 1_000);
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([0]) }) });   // only SKR (leg 0) on
    expect(builds.map((b) => b.asset)).toEqual(["SKR"]);
  });

  it("positive control: the same leashed user with stORE's leg on gets the stORE leg", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.bumpLedger("W", "SKR", 1_000);
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([0, 1]) }) });
    expect(builds[0]?.asset).toBe("stORE");
  });
});

describe("runPlanting", () => {
  it("plants when pending reaches the threshold: 83 + 62 + 70 = 215 cents", async () => {
    const repo = await seeded([83, 62, 70]);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.planted).toEqual([{ wallet: "W", asset: "SKR", pullCents: 215, signature: "sig1" }]);
    expect((await repo.unplantedSwaps("W")).length).toBe(0);
    expect((await repo.getWallet("W"))!.ledgerCents).toEqual({ SKR: 215 });
  });

  it("waits below the threshold", async () => {
    const r = await runPlanting({ repo: await seeded([83, 62], { planted: true }), now: NOW, chain: fakeChain() });
    expect(r.planted).toEqual([]);
    expect(r.skipped[0].reason).toBe("below threshold");
  });

  it("plants below the threshold when the oldest swap is 7 days old", async () => {
    const r = await runPlanting({ repo: await seeded([83, 62], { ago: 8 * 86_400_000 }), now: NOW, chain: fakeChain() });
    expect(r.planted[0].pullCents).toBe(145);
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
    // 10 cents in the wallet: not even the minimum planting (the 200-cent threshold) is covered.
    const repo = await seeded([83, 62, 70]);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 100_000n }) });
    expect(r.skipped[0].reason).toBe("no usdc");
    expect((await repo.getWallet("W"))!.status).toBe("paused");
    expect(repo.events.some((e) => e.kind === "paused_no_usdc")).toBe(true);
    expect((await repo.unplantedSwaps("W")).length).toBe(3);   // nothing claimed: the round-ups wait for the USDC
  });

  // R361 (owner 10-05, "Carry the rest to a later planting"): a short balance that still covers the minimum plants the round-ups it
  // covers, whole and oldest first; the round-ups it does not cover stay waiting (unclaimed) and plant after a top-up. Before, the run
  // paused, the resume brought it back, and the next run asked for everything again.
  const many = (n: number, c: number) => Array.from({ length: n }, () => c);

  it("$2.00 waiting, $0.50 in the wallet: plants the round-ups 50 cents covers, the rest waits, the wallet stays active", async () => {
    const repo = await seeded(many(10, 20));
    await repo.saveRules("U", { plantThresholdCents: 10 });
    const builds: bigint[] = [];
    const base = fakeChain({ usdcBalanceRaw: async () => 500_000n });
    const r = await runPlanting({ repo, now: NOW, chain: { ...base, buildPlantingTx: async (a) => { builds.push(a.pullRaw); return base.buildPlantingTx(a); } } });
    expect(r.planted).toEqual([{ wallet: "W", asset: "SKR", pullCents: 40, signature: "sig1" }]);
    expect(builds).toEqual([400_000n]);
    expect([...repo.plantings.values()][0]).toMatchObject({ usdcPulledCents: 40 });
    expect(repo.legs[0]).toMatchObject({ usdcInCents: 40 });
    expect((await repo.getWallet("W"))!.status).toBe("active");
    expect(repo.events.some((e) => e.kind === "paused_no_usdc")).toBe(false);
    expect((await repo.unplantedSwaps("W")).length).toBe(8);
  });

  it("the old loop ($5.00 waiting, $3.00 in the wallet): plants what is covered, then after a top-up the rest, each round-up once", async () => {
    const repo = await seeded(many(10, 50));
    await storeOff(repo);
    const r1 = await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 3_000_000n }) });
    expect(r1.planted[0].pullCents).toBe(300);   // 6 round-ups (300) fit under 300
    expect((await repo.getWallet("W"))!.status).toBe("active");
    expect((await repo.unplantedSwaps("W")).length).toBe(4);
    // The next day, $0.50: one round-up fits, under the 200 minimum: paused, nothing claimed.
    const day2 = new Date(NOW.getTime() + 86_400_000);
    const r2 = await runPlanting({ repo, now: day2, chain: fakeChain({ usdcBalanceRaw: async () => 500_000n }) });
    expect(r2.skipped[0].reason).toBe("no usdc");
    expect((await repo.unplantedSwaps("W")).length).toBe(4);
    // Topped up: the run resumes it and plants the waiting 200, and nothing is planted twice.
    const day3 = new Date(NOW.getTime() + 2 * 86_400_000);
    const r3 = await runPlanting({ repo, now: day3, chain: fakeChain({ usdcBalanceRaw: async () => 50_000_000n }) });
    expect(r3.planted[0].pullCents).toBe(200);
    expect((await repo.unplantedSwaps("W")).length).toBe(0);
    expect((await repo.getWallet("W"))!.ledgerCents).toEqual({ SKR: 500 });
    const r4 = await runPlanting({ repo, now: new Date(day3.getTime() + 86_400_000), chain: fakeChain() });
    expect(r4.planted).toEqual([]);
  });

  it("a balance in fractions of a cent rounds down: never a pull above the balance", async () => {
    const repo = await seeded(many(10, 50));
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 2_499_999n }) });
    expect(r.planted[0].pullCents).toBe(200);   // 249 cents: 4 round-ups (200) fit, not 5
    expect((await repo.unplantedSwaps("W")).length).toBe(6);
  });

  it("a balance exactly at the minimum plants it; one cent under pauses and claims nothing", async () => {
    const at = await seeded(many(10, 50), { planted: true });
    expect((await runPlanting({ repo: at, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 2_000_000n }) })).planted[0].pullCents).toBe(200);
    const under = await seeded(many(10, 50), { planted: true });
    const r = await runPlanting({ repo: under, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 1_999_999n }) });
    expect(r.skipped[0].reason).toBe("no usdc");
    expect((await under.getWallet("W"))!.status).toBe("paused");
    expect(under.events.find((e) => e.kind === "paused_no_usdc")!.detail).toEqual({ needCents: 500 });
    expect((await under.unplantedSwaps("W")).length).toBe(10);
  });

  it("the 7-day rule never drops round-ups: 4 cents covers none, so it pauses; a partial balance plants the oldest that fit", async () => {
    const old = { ago: 8 * 86_400_000 };
    const four = await seeded([83, 62], old);
    expect((await runPlanting({ repo: four, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 40_000n }) })).skipped[0].reason).toBe("no usdc");
    expect((await four.unplantedSwaps("W")).length).toBe(2);
    const part = await seeded([83, 62], old);
    await storeOff(part);
    expect((await runPlanting({ repo: part, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 1_000_000n }) })).planted[0].pullCents).toBe(83);
    expect((await part.unplantedSwaps("W")).map((s) => s.roundupCents)).toEqual([62]);
    // Topped up the next day: the waiting 62 (still past 7 days) plants on its own.
    const r = await runPlanting({ repo: part, now: new Date(NOW.getTime() + 86_400_000), chain: fakeChain() });
    expect(r.planted[0].pullCents).toBe(62);
    expect((await part.getWallet("W"))!.ledgerCents).toEqual({ SKR: 145 });
  });

  it("covered round-ups are picked oldest first, skipping one that does not fit; only those carry the planting's id", async () => {
    const repo = await seeded([300, 120, 90]);
    await repo.saveRules("U", { plantThresholdCents: 100 });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 2_200_000n }) });
    expect(r.planted[0].pullCents).toBe(210);   // 220 of change fit: 300 skipped, 120 + 90
    const id = [...repo.plantings.values()][0].id;
    expect([...repo.swaps.values()].map((x) => [x.signature, x.plantingId])).toEqual([["s0", null], ["s1", id], ["s2", id]]);
  });

  it("a balance-bounded planting that fails on chain releases only its own round-ups; all of them plant once later", async () => {
    const repo = await seeded(many(10, 40));
    await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 3_000_000n, sendPlanting: async () => { throw new Error("blockhash expired"); }, signatureStatus: async () => "failed" }) });
    expect((await repo.unplantedSwaps("W")).length).toBe(10);
    const r = await runPlanting({ repo, now: new Date(NOW.getTime() + 86_400_000), chain: fakeChain() });
    expect(r.planted[0].pullCents).toBe(400);
    expect((await repo.getWallet("W"))!.ledgerCents).toEqual({ SKR: 400 });
  });

  it("the 7-day minimum of zero applies only when an old round-up is among those planted: no fee-paying drip of new cents", async () => {
    // A $3.00 round-up 8 days old, $1.00 in the wallet, a new 2-cent round-up: the old one does not fit, the new one is under the threshold.
    const repo = await seeded([300], { ago: 8 * 86_400_000 });
    await repo.insertSwap({ signature: "new", walletPubkey: "W", ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 2 });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 1_000_000n }) });
    expect(r.planted).toEqual([]);
    expect(r.skipped[0].reason).toBe("no usdc");
    expect((await repo.unplantedSwaps("W")).length).toBe(2);
  });

  it("a balance above the minimum that covers no whole round-up waits without pausing (the resume would undo a pause at once)", async () => {
    const repo = await seeded([300]);
    const chain = fakeChain({ usdcBalanceRaw: async () => 2_500_000n });
    for (const day of [0, 1]) {
      const r = await runPlanting({ repo, now: new Date(NOW.getTime() + day * 86_400_000), chain });
      expect(r.skipped[0].reason).toBe("no usdc");
    }
    expect((await repo.getWallet("W"))!.status).toBe("active");
    expect(repo.events.some((e) => e.kind === "paused_no_usdc" || e.kind === "resumed")).toBe(false);
    expect((await repo.unplantedSwaps("W")).length).toBe(1);
    const r = await runPlanting({ repo, now: new Date(NOW.getTime() + 2 * 86_400_000), chain: fakeChain() });
    expect(r.planted[0].pullCents).toBe(300);
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

  // 10-07: a revoke made outside the app on a wallet with nothing due was never seen (the threshold returned first): 9ZKi stayed
  // active and the Seeker kept its re-link card. The run now reads the delegation of a wallet with nothing due too.
  const GONE = { exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n };
  it("marks a wallet with nothing due revoked when its delegation is gone", async () => {
    const repo = await seeded([]);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readDelegation: async () => GONE }) });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "revoked" }]);
    expect((await repo.getWallet("W"))!.status).toBe("revoked");
    expect(repo.events.map((e) => e.kind)).toContain("revoke_seen");
  });

  // 10-27 (wallet BTDG): the delegation stayed but the wallet's revoke-approvals tool cleared the USDC delegate; every run failed at simulate.
  it("marks the wallet revoked, once and before any build, when its USDC account no longer names Sprouts as delegate", async () => {
    const repo = await seeded([83, 62, 70]);
    const build = vi.fn();
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readUsdcApproved: async () => false, buildPlantingTx: build }) });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "revoked" }]);
    expect(build).not.toHaveBeenCalled();
    expect((await repo.getWallet("W"))!.status).toBe("revoked");
    expect(repo.events.find((e) => e.kind === "revoke_seen")?.detail).toEqual({ by: "token_revoke" });
  });
  it("an unreadable or missing USDC account is no revoke: the planting goes on", async () => {
    for (const read of [async () => null, async () => { throw new Error("rpc down"); }]) {
      const repo = await seeded([83, 62, 70]);
      const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readUsdcApproved: read }) });
      expect((await repo.getWallet("W"))!.status).not.toBe("revoked");
      expect(r.skipped.some((s) => s.reason === "revoked")).toBe(false);
    }
  });

  it("a wallet below the threshold with its delegation in place stays active, waiting", async () => {
    const repo = await seeded([83, 62], { planted: true });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "below threshold" }]);
    expect((await repo.getWallet("W"))!.status).toBe("active");
  });

  it("a failed delegation read on a wallet with nothing due is ignored: no event, not an outage", async () => {
    const repo = await seeded([]);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readDelegation: async () => { throw new Error("rpc 429"); } }) });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "below threshold" }]);
    expect(repo.events).toEqual([]);
    expect((await repo.getWallet("W"))!.status).toBe("active");
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
    // Cap carry (11-13): round-ups that fit a day (a single $10 one now waits for a full day, see "cap carry" below).
    const repo = await seeded([125, 125, 125]);
    const periodStart = BigInt(Math.floor(NOW.getTime() / 1000) - 3600);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readDelegation: async () => ({ ...DELEGATION, pulledInPeriodRaw: 2_500_000n, periodStartTs: periodStart }) }) });
    expect(r.planted[0].pullCents).toBe(250);
    expect((await repo.unplantedSwaps("W")).length).toBe(1);
  });

  it("when the cap left is below the threshold, nothing is planted and the change waits", async () => {
    const repo = await seeded([1000], { planted: true });
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

  it("kimi M4: one sent planting whose status read throws is skipped (retried next run); the others are still reconciled", async () => {
    const repo = new MemoryRepo();
    const mk = async (sig: string) => (await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: sig, usdcPulledCents: 100, networkFeeCents: 0, status: "sent", aiLine: null, ts: new Date(NOW.getTime() - 40 * 60_000) }, [])).id;
    const bad = await mk("bad"), good = await mk("good");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const chain = fakeChain({ signatureStatus: async (sig: string) => { if (sig === "bad") throw new Error("rpc 500"); return "failed"; } });
    await expect(runPlanting({ repo, now: NOW, chain })).resolves.toBeDefined();
    err.mockRestore();
    expect(repo.plantings.get(bad)!.status).toBe("sent");
    expect(repo.plantings.get(good)!.status).toBe("failed");
  });

  it("kimi M4 review: a booking WRITE that throws is not swallowed (the run fails as before)", async () => {
    const repo = new MemoryRepo();
    await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "s1", usdcPulledCents: 100, networkFeeCents: 0, status: "sent", aiLine: null, ts: new Date(NOW.getTime() - 40 * 60_000) }, [{ asset: "SKR", usdcInCents: 100, amountOutRaw: 1n, staked: true, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: null, venue: null }]);
    vi.spyOn(repo, "bumpLedger").mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runPlanting({ repo, now: NOW, chain: fakeChain({ signatureStatus: async () => "confirmed" }) })).rejects.toThrow("db down");
    err.mockRestore();
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
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ buildPlantingTx: async () => { builds++; throw new Error("Jupiter quote failed: 500"); } }) });
    expect(r.planted).toEqual([]);
    expect(builds).toBe(8);
    expect(r.skipped.filter((s) => s.reason === "run stopped").length).toBe(4);
    expect(repo.events.filter((e) => e.kind === "run_stopped").length).toBe(1);
  });

  it("429s never stop the run", async () => {
    const repo = new MemoryRepo();
    for (let i = 0; i < 12; i++) {
      await repo.upsertUser({ seedVaultPubkey: `U${i}`, sgtMint: `M${i}`, skrName: null });
      await repo.addWallet({ pubkey: `W${i}`, userPubkey: `U${i}`, delegationPda: `D${i}`, dailyCapCents: 500 });
      await repo.insertSwap({ signature: `x${i}`, walletPubkey: `W${i}`, ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 215 });
    }
    let builds = 0;
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ buildPlantingTx: async () => { builds++; throw new JupiterRateLimited("Jupiter quote failed: 429 rate limited"); } }) });
    expect(r.planted).toEqual([]);
    expect(builds).toBe(12);
    expect(r.skipped.length).toBe(12);
    expect(r.skipped.every((s) => s.reason === "jupiter busy")).toBe(true);
    expect(repo.events.filter((e) => e.kind === "run_stopped").length).toBe(0);
    expect(repo.events.filter((e) => e.kind === "pull_failed" && (e.detail as { err?: string }).err === "jupiter 429").length).toBe(12);
    for (let i = 0; i < 12; i++) expect(await repo.unplantedSwaps(`W${i}`)).toHaveLength(1);
  });

  it("a 429 between two build failures neither counts nor resets", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    for (let i = 0; i < 5; i++) {
      await repo.addWallet({ pubkey: `W${i}`, userPubkey: "U", delegationPda: `D${i}`, dailyCapCents: 500 });
      await repo.insertSwap({ signature: `x${i}`, walletPubkey: `W${i}`, ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 215 });
    }
    let builds = 0;
    const errs = [new Error("Jupiter quote failed: 500"), new JupiterRateLimited("Jupiter quote failed: 429"), new Error("Jupiter quote failed: 500"), new Error("Jupiter quote failed: 500"), new Error("never reached")];
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ buildPlantingTx: async () => { throw errs[builds++]; } }) });
    expect(builds).toBe(4);
    expect(r.skipped.map((s) => s.reason)).toEqual(["build failed", "jupiter busy", "build failed", "build failed", "run stopped"]);
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
    // $3 a day in the rules against a $5 delegation: the pull is $3. Cap carry (11-13): each $10 round-up is bigger than the whole
    // $3, so the oldest gets a $3 part and still owes $7; both wait for the next days.
    const repo = await seeded([1000, 1000]);
    await repo.saveRules("U", { dailyCapCents: 300 });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r.planted[0].pullCents).toBe(300);
    expect((await repo.unplantedSwaps("W")).map((s) => s.owedCents)).toEqual([700, 1000]);
    expect(((await repo.getWallet("W"))!.ledgerCents.SKR ?? 0)).toBe(300);
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
    expect((await repo.plantingLegs(p.id))[0].amountOutRaw).toBe(286_500_000n);     // not the quote's 101_050_000
  });

  it("a landed change that is not above zero keeps the quote and says so (R141, review M6)", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: { ...SKR_ONLY, SKR: 0, hSOL: 100 } });
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: unknown) => { errors.push(String(m)); });
    try {
      await runPlanting({ repo, now: NOW, chain: fakeChain({ assetBalanceRaw: async () => 5_000_000n }) }); // the same balance before and after
      const [leg] = await repo.plantingLegs((await repo.listPlantings("U", 1))[0].id);
      expect(leg.amountOutRaw).toBe(101_050_000n);
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
      expect(leg.amountOutRaw).toBe(101_050_000n);
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
    await storeOff(repo);
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
    await storeOff(repo);
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
    await storeOff(repo);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerSkrChangeRaw: async () => 500n }) });
    await addSwaps(repo, "W", "d2-");
    const later = new Date(NOW.getTime() + 86_400_000);
    await runPlanting({ repo, now: later, chain: fakeChain({ sendPlanting: async () => { throw new Error("custom program error"); }, signatureStatus: async () => "failed" }) });
    expect(plantings(repo)[1]).toMatchObject({ status: "failed", skrCarryInRaw: 500n });
    expect(await repo.skrCreditRaw("U")).toBe(500n);

    // 11-15: stORE back on (storeOff's 0 pin cleared); a stale stORE share on a switched-off stORE would never be bought.
    await repo.saveRules("U", { pins: {}, allocation: { ...SKR_ONLY, SKR: 0, stORE: 100 } });
    const builds: BuildArgs[] = [];
    await runPlanting({ repo, now: new Date(later.getTime() + 86_400_000), chain: recording(builds) });
    expect(builds.map((b) => [b.asset, b.carryIn.SKR])).toEqual([["stORE", undefined]]);
  });

  it("stands down before claiming or sending when another run spent the same remainder meanwhile", async () => {
    const repo = await seeded([83, 62, 70]);
    await storeOff(repo);
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
    expect(built).toEqual(["USDC_LEND", "USDC_LEND"]);   // R439: its other venue once, never another asset
    expect(r.planted).toEqual([]);
    expect(r.skipped).toEqual([{ wallet: "W", reason: "leg failed" }]);
    expect(repo.events.map((e) => e.kind)).toContain("leg_skipped");
    expect(repo.events.map((e) => e.kind)).not.toContain("leg_fallback");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
  });

  // R439 (10-07): a lending leg that fails (weather, not a guard refusal) tries the same asset on the other venue once; then it waits.
  it("R439: a failed lending venue retries the same asset on the other venue, which plants", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: { ...lendOnly, USDC_LEND: 0, SOL_LEND: 100 } });
    const built: [string, string | null][] = [];
    const base = fakeChain();
    const chain = fakeChain({ buildPlantingTx: async (a) => { built.push([a.asset, a.venue]); if (a.venue === "kamino_klend") throw new Error("Transaction too large: 1267 bytes"); return base.buildPlantingTx(a); } });
    const r = await runPlanting({ repo, now: NOW, chain });
    expect(built).toEqual([["SOL_LEND", "kamino_klend"], ["SOL_LEND", "jupiter_lend"]]);
    expect(r.planted).toEqual([{ wallet: "W", asset: "SOL_LEND", pullCents: 215, signature: "sig1" }]);
    expect(repo.events.find((e) => e.kind === "venue_fallback")?.detail).toMatchObject({ asset: "SOL_LEND", from: "kamino_klend", to: "jupiter_lend" });
    expect(repo.events.map((e) => e.kind)).not.toContain("leg_skipped");
  });

  it("R439: when the other venue fails too, the planting waits for the next run with an ALERT; no third try", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: lendOnly });
    const built: (string | null)[] = [];
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => { errors.push(m); });
    try {
      const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ buildPlantingTx: async (a) => { built.push(a.venue); throw new Error("venue down"); } }) });
      expect(r.skipped).toEqual([{ wallet: "W", reason: "leg failed" }]);
    } finally {
      spy.mockRestore();
    }
    expect(built).toEqual(["kamino_klend", "jupiter_lend"]);
    expect(errors.some((m) => m.startsWith("ALERT: lending leg USDC_LEND skipped"))).toBe(true);
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
  });

  it("R439: a guard refusal is not retried on the other venue", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: lendOnly });
    const built: (string | null)[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ buildPlantingTx: async (a) => { built.push(a.venue); throw new Error("K-Lend refused: deposit account mismatch"); } }) });
    expect(built).toEqual(["kamino_klend"]);
    expect(r.skipped[0].reason).toBe("leg failed");
  });

  it("R439: a leashed user whose other venue's leg is off is not retried there", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: lendOnly });
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    const built: (string | null)[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readLeashConfig: async () => leashCfg([2]), buildPlantingTx: async (a) => { built.push(a.venue); throw new Error("venue down"); } }) });
    expect(r.skipped[0].reason).toBe("leg failed");
    expect(built).toEqual(["kamino_klend"]);
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
    expect(builds[0]).toMatchObject({ asset: "USDC_LEND", venue: "jupiter_lend", leashed: true, pullRaw: 2_150_000n });
  });

  it("USDC lending disabled and every enabled leg at its max: the largest enabled leg takes the rest, the whole change is pulled (11-15, A5)", async () => {
    const repo = await seeded([150, 150, 150]);   // 450 cents of change
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { stop: "careful", allocation: { SKR: 60, stORE: 0, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 20 } });
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([6, 7]) }) });
    // Careful maxes hSOL 15 + cbBTC 30 = 45%; the other 55 goes to cbBTC, the largest (A5; was 202 cents pulled, the share < 100 path).
    expect(builds[0]).toMatchObject({ asset: "cbBTC", leashed: true, pullRaw: 4_500_000n });
    expect(r.planted[0]).toMatchObject({ pullCents: 450 });
  });

  it("a leashed planting bounded by the USDC balance builds with the bounded pull: the leash's floor and settle read that pullRaw", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { plantThresholdCents: 100, allocation: lendOnly });
    const builds: BuildArgs[] = [];
    // $1.50: 150 cents of change fit; 83 + 62 = 145 are planted, the 70 waits.
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds, { usdcBalanceRaw: async () => 1_500_000n, readLeashConfig: async () => leashCfg([3, 6]) }) });
    expect(builds[0]).toMatchObject({ asset: "USDC_LEND", leashed: true, pullRaw: 1_450_000n });
    expect(r.planted[0]).toMatchObject({ pullCents: 145 });
    expect(repo.legs[0]).toMatchObject({ usdcInCents: 145 });
    expect((await repo.unplantedSwaps("W")).map((s) => s.roundupCents)).toEqual([70]);
  });

  it("the balance-bounded pull works on the covered round-ups only (11-15, A5: no share < 100 any more)", async () => {
    const repo = await seeded([150, 150, 150]);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { plantThresholdCents: 100, stop: "careful", allocation: { SKR: 60, stORE: 0, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 20 } });
    const builds: BuildArgs[] = [];
    // $3.10 covers two round-ups (300), all pulled (A5; was 45% of 300, 135). The third round-up waits.
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds, { usdcBalanceRaw: async () => 3_100_000n, readLeashConfig: async () => leashCfg([6, 7]) }) });
    expect(builds[0]).toMatchObject({ asset: "cbBTC", leashed: true, pullRaw: 3_000_000n });
    expect(r.planted[0]).toMatchObject({ pullCents: 300 });
    expect((await repo.unplantedSwaps("W")).length).toBe(1);
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

  it("N1 (residual): an unleashed user's water-fill never hands points to a 0% lending leg with no venue; the run plants", async () => {
    // Unmanaged pins SKR 70 / SOL_LEND 30, Careful, no venue rows: SOL_LEND is disabled and USDC_LEND (0%) has no venue either.
    const repo = await seeded([83, 62, 70]);
    await repo.bumpLedger("W", "SKR", 10_000);   // SKR-heavy: pickAsset would take a 0% lending leg the fill gave points to
    await repo.saveRules("U", { stop: "careful", allocation: { SKR: 70, stORE: 0, USDC_LEND: 0, SOL_LEND: 30, hSOL: 0, cbBTC: 0 } });
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds.length).toBeGreaterThan(0);
    expect(builds.filter((b) => b.asset === "USDC_LEND" || b.asset === "SOL_LEND")).toEqual([]);
    expect(r.planted.length).toBe(1);
  });

  it("N1 (residual): a 0% lending leg that has a venue may take the fill's points, and plants on that venue", async () => {
    const repo = await seeded([83, 62, 70]);
    await storeOff(repo);
    await seedVenues(repo);
    for (const venue of ["kamino_klend", "jupiter_lend"] as const) {
      await repo.putVenueDay({ day: "2026-09-29", venue, asset: "SOL_LEND", supplyPct: 4, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: 1, avg7Pct: 4, daysMeasured: 3, eligible: false, verdict: null, reason: null, served: null, ok: true });
    }
    await repo.bumpLedger("W", "SKR", 10_000);
    await repo.saveRules("U", { stop: "careful", allocation: { SKR: 70, stORE: 0, USDC_LEND: 0, SOL_LEND: 30, hSOL: 0, cbBTC: 0 } });
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds[0]).toMatchObject({ asset: "USDC_LEND", venue: "kamino_klend" });
    expect(r.planted.length).toBe(1);
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
    await storeOff(repo);
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
    await storeOff(repo);
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
    expect(r.planted).toEqual([{ wallet: "W", asset: "hSOL", pullCents: 215, signature: "sig2" }]);
  });

  it("a 429 building a leashed SKR leg is 'jupiter busy' with the 429 event, not a skipped leg", async () => {
    const repo = await leashed();
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readLeashConfig: async () => leashCfg([0]), buildPlantingTx: async () => { throw new JupiterRateLimited("Jupiter quote failed: 429 x"); } }) });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "jupiter busy" }]);
    expect(repo.events.some((e) => e.kind === "leg_skipped")).toBe(false);
    expect(repo.events.some((e) => e.kind === "pull_failed" && (e.detail as { err?: string }).err === "jupiter 429")).toBe(true);
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

describe("SKR posted (leg 0, contracts 10 item 15): the run with a Pyth key", () => {
  type BuildArgs = Parameters<Chain["buildPlantingTx"]>[0];
  const SKR_FEED = "38846ec4d0dbe808091817f5c0d6ab8058e25422348ddf97db52b6c378a93bf9";
  const skrOnly = { SKR: 100, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 };
  const posted = (ageS = 1) => ({ feedId: SKR_FEED, price: 1_830_000n, conf: 1_216n, exponent: -8, publishTime: BigInt(Math.floor(Date.now() / 1000) - ageS), full: true });
  const leashedRepo = async (allocation: typeof skrOnly = skrOnly) => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { allocation });
    return repo;
  };
  /** A chain whose SKR builds carry a posted price (reclaim pending) as buildPlantingTx returns them; every cleanup is recorded. */
  const postingChain = (o: { builds: BuildArgs[]; cleaned: string[]; ageS?: number; over?: Partial<Chain> }) => {
    // The shipped conf cap (100 bps) on leg 0: leashCfg's 0 would refuse any posted price at the pre-send check.
    const cfg = leashCfg([0, 6]);
    cfg.legs[0].confCapBps = 100;
    const base = fakeChain({ readLeashConfig: async () => cfg, ...o.over });
    return { ...base,
      buildPlantingTx: async (a: BuildArgs) => { o.builds.push(a); const b = await base.buildPlantingTx(a); return a.asset === "SKR" ? { ...b, cleanup: ["reclaim"], postedPrice: posted(o.ageS) } : b; },
      cleanup: async (b) => { o.cleaned.push(b.signature); },
    } as Chain;
  };
  const withKey = async <T,>(f: () => Promise<T>) => { process.env.PYTH_API_KEY = "k"; try { return await f(); } finally { delete process.env.PYTH_API_KEY; } };

  it("a leashed SKR leg is planted with its posted price (no source error), and the price account is reclaimed after the planting", async () => {
    const repo = await leashedRepo();
    const builds: BuildArgs[] = [], cleaned: string[] = [];
    const r = await withKey(() => runPlanting({ repo, now: NOW, chain: postingChain({ builds, cleaned }) }));
    expect(r.planted.map((p) => p.asset)).toEqual(["SKR"]);
    expect(builds.map((b) => [b.asset, b.leashed, b.priceOpts?.maxAgeS])).toEqual([["SKR", true, 60]]);   // the on-chain max age reaches the post
    expect(cleaned).toEqual([r.planted[0].signature]);
  });

  it("the posted price is judged again right before the send: too old, nothing is sent, the round-ups go back, the price is reclaimed", async () => {
    const repo = await leashedRepo();
    const builds: BuildArgs[] = [], cleaned: string[] = [];
    let sent = 0;
    const r = await withKey(() => runPlanting({ repo, now: NOW, chain: postingChain({ builds, cleaned, ageS: 41, over: { sendPlanting: async () => { sent++; } } }) }));
    expect(r.skipped).toEqual([{ wallet: "W", reason: "leg failed" }]);
    expect(sent).toBe(0);
    expect([...repo.plantings.values()].map((p) => p.status)).toEqual(["failed"]);
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
    expect(JSON.stringify(repo.events.find((e) => e.kind === "leg_skipped")?.detail)).toMatch(/price unusable at send: the posted SKR price is 41 s old \(usable under 40 s\)/);
    expect(cleaned).toEqual(["sig1"]);
    // Positive control: 39 s old is sent.
    const repo2 = await leashedRepo();
    const r2 = await withKey(() => runPlanting({ repo: repo2, now: NOW, chain: postingChain({ builds: [], cleaned: [], ageS: 39 }) }));
    expect(r2.planted.length).toBe(1);
  });

  it("every build that is not sent reclaims its price: a failed simulation, and the first build of a SettleMismatch rebuild", async () => {
    const repo = await leashedRepo();
    const builds: BuildArgs[] = [], cleaned: string[] = [];
    const r = await withKey(() => runPlanting({ repo, now: NOW, chain: postingChain({ builds, cleaned, over: { simulatePlanting: async () => ({ ok: false, err: { Custom: 1 }, logs: [], units: 1 }) } }) }));
    expect(r.skipped).toEqual([{ wallet: "W", reason: "simulation failed" }]);
    expect(cleaned).toEqual(["sig1"]);
    const repo2 = await leashedRepo();
    const cleaned2: string[] = [];
    let sims = 0;
    const settleMismatch = { ok: false, err: { InstructionError: [7, { Custom: 6007 }] }, logs: [`Program ${LEASH_PROGRAM} failed: custom program error: 0x1777`], units: 1 };
    const base = fakeChain();
    const r2 = await withKey(() => runPlanting({ repo: repo2, now: NOW, chain: postingChain({ builds: [], cleaned: cleaned2, over: { simulatePlanting: async (b) => (sims++ === 0 ? settleMismatch : base.simulatePlanting(b)) } }) }));
    expect(r2.planted.map((p) => p.signature)).toEqual(["sig2"]);
    expect(cleaned2).toEqual(["sig1", "sig2"]);   // the discarded first build at once, the sent one after the planting
  });

  it("review I2: a throw between the build and the send (a share read, the planting insert) reclaims the posted price, then propagates", async () => {
    const repo = await leashedRepo();
    const cleaned: string[] = [];
    await expect(withKey(() => runPlanting({ repo, now: NOW, chain: postingChain({ builds: [], cleaned, over: { readShares: async () => { throw new Error("rpc down"); } } }) }))).resolves.toBeDefined();
    expect(cleaned).toEqual(["sig1"]);
    const repo2 = await leashedRepo();
    repo2.insertPlanting = async () => { throw new Error("db down"); };
    const cleaned2: string[] = [];
    await withKey(() => runPlanting({ repo: repo2, now: NOW, chain: postingChain({ builds: [], cleaned: cleaned2 }) }));
    expect(cleaned2).toEqual(["sig1"]);
  });

  it("with a key, a leashed coin leg that fails falls back to SKR (it has a source now); without one it is skipped as before (review M4)", async () => {
    const repo = await leashedRepo({ ...skrOnly, SKR: 0, hSOL: 100 });
    const builds: BuildArgs[] = [], cleaned: string[] = [];
    const chain = postingChain({ builds, cleaned });
    const failing = { ...chain, buildPlantingTx: async (a: BuildArgs) => { if (a.asset === "hSOL") { builds.push(a); throw new Error("Jupiter: no route"); } return chain.buildPlantingTx(a); } } as Chain;
    const r = await withKey(() => runPlanting({ repo, now: NOW, chain: failing }));
    expect(builds.map((b) => b.asset)).toEqual(["hSOL", "SKR"]);
    expect(r.planted.map((p) => p.asset)).toEqual(["SKR"]);
    expect(repo.events.map((e) => e.kind)).toContain("leg_fallback");
    // Without the key: today's behaviour, skipped with no fallback.
    const repo2 = await leashedRepo({ ...skrOnly, SKR: 0, hSOL: 100 });
    const builds2: BuildArgs[] = [];
    const chain2 = postingChain({ builds: builds2, cleaned: [] });
    const r2 = await runPlanting({ repo: repo2, now: NOW, chain: { ...chain2, buildPlantingTx: async (a: BuildArgs) => { builds2.push(a); throw new Error("Jupiter: no route"); } } as Chain });
    expect(builds2.map((b) => b.asset)).toEqual(["hSOL"]);
    expect(r2.skipped).toEqual([{ wallet: "W", reason: "leg failed" }]);
    expect(repo2.events.map((e) => e.kind)).toEqual(["leg_skipped"]);
  });
});

describe("first planting (owner 10-22): 50 cents for a user who never planted; the first-only run", () => {
  type BuildArgs = Parameters<Chain["buildPlantingTx"]>[0];
  const counting = (over: Partial<Chain> = {}) => {
    const calls = { builds: [] as BuildArgs[], delegationReads: 0, statusReads: 0 };
    const base = fakeChain(over);
    const chain: Chain = {
      ...base,
      buildPlantingTx: async (a) => { calls.builds.push(a); return base.buildPlantingTx(a); },
      readDelegation: async (pda) => { calls.delegationReads++; return base.readDelegation(pda); },
      signatureStatus: async (sig) => { calls.statusReads++; return base.signatureStatus(sig); },
    };
    return { chain, calls };
  };
  const confirmed = (repo: MemoryRepo) => [...repo.plantings.values()].filter((p) => p.status === "confirmed" && !p.signature?.startsWith("past-"));

  it("a first-time wallet at $0.60 plants in first-only mode", async () => {
    const repo = await seeded([25, 35]);
    const { chain } = counting();
    const r = await runPlanting({ repo, now: NOW, chain, only: "first" });
    expect(r.planted).toEqual([{ wallet: "W", asset: "SKR", pullCents: 60, signature: "sig1" }]);
    expect((await repo.unplantedSwaps("W")).length).toBe(0);
    expect(await repo.hasPlanted("U")).toBe(true);
  });

  it("a wallet whose user already planted, at $0.60, does not plant in first-only mode: not even read from the chain", async () => {
    const repo = await seeded([25, 35], { planted: true });
    const { chain, calls } = counting();
    const r = await runPlanting({ repo, now: NOW, chain, only: "first" });
    expect(r).toEqual({ planted: [], skipped: [] });
    expect(calls.builds.length + calls.delegationReads).toBe(0);
    expect((await repo.unplantedSwaps("W")).length).toBe(2);
  });

  it("the daily run is unchanged for a user who already planted: $0.60 and $1.99 wait, $2.00 plants", async () => {
    for (const [roundups, plants] of [[[25, 35], false], [[100, 99], false], [[100, 100], true]] as const) {
      const repo = await seeded([...roundups], { planted: true });
      const r = await runPlanting({ repo, now: NOW, chain: fakeChain() });
      expect(r.planted.length).toBe(plants ? 1 : 0);
      if (!plants) expect(r.skipped).toEqual([{ wallet: "W", reason: "below threshold" }]);
    }
  });

  it("the daily run plants a first-time wallet at 50 cents too, and waits at 49", async () => {
    const at = await seeded([20, 30]);
    expect((await runPlanting({ repo: at, now: NOW, chain: fakeChain() })).planted[0].pullCents).toBe(50);
    const under = await seeded([20, 29]);
    expect((await runPlanting({ repo: under, now: NOW, chain: fakeChain() })).skipped).toEqual([{ wallet: "W", reason: "below threshold" }]);
  });

  it("after the first planting the user's threshold is back: the next $0.60 waits, in either mode", async () => {
    const repo = await seeded([25, 35]);
    await runPlanting({ repo, now: NOW, chain: fakeChain(), only: "first" });
    await repo.insertSwap({ signature: "next", walletPubkey: "W", ts: NOW, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 60 });
    const later = new Date(NOW.getTime() + 3_600_000);
    expect(await runPlanting({ repo, now: later, chain: fakeChain(), only: "first" })).toEqual({ planted: [], skipped: [] });
    expect((await runPlanting({ repo, now: later, chain: fakeChain() })).skipped).toEqual([{ wallet: "W", reason: "below threshold" }]);
    expect(confirmed(repo).length).toBe(1);
  });

  it("a failed planting does not count as planted; a sent one (in flight) does", async () => {
    const failed = await seeded([25, 35]);
    const f = await failed.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "x", usdcPulledCents: 60, networkFeeCents: 0, status: "sent", aiLine: null }, []);
    await failed.setPlantingStatus(f.id, "failed");
    expect((await runPlanting({ repo: failed, now: NOW, chain: fakeChain(), only: "first" })).planted.length).toBe(1);

    const sent = await seeded([25, 35]);
    await sent.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "y", usdcPulledCents: 60, networkFeeCents: 0, status: "sent", aiLine: null, ts: NOW }, []);
    expect(await runPlanting({ repo: sent, now: NOW, chain: fakeChain(), only: "first" })).toEqual({ planted: [], skipped: [] });
  });

  it("first-only mode never reconciles a `sent` planting (the daily run's job): no status read, the row stays sent", async () => {
    const repo = await seeded([25, 35]);
    const other = "U2";
    await repo.upsertUser({ seedVaultPubkey: other, sgtMint: "M2", skrName: null });
    const p = await repo.insertPlanting({ userPubkey: other, walletPubkey: "W2", signature: "old", usdcPulledCents: 200, networkFeeCents: 0, status: "sent", aiLine: null, ts: new Date(NOW.getTime() - 3_600_000) }, []);
    const { chain, calls } = counting({ signatureStatus: async () => "confirmed" });
    await runPlanting({ repo, now: NOW, chain, only: "first" });
    expect(calls.statusReads).toBe(0);
    expect(repo.plantings.get(p.id)!.status).toBe("sent");
    // ...and the daily run still does reconcile it.
    await runPlanting({ repo, now: NOW, chain });
    expect(repo.plantings.get(p.id)!.status).toBe("confirmed");
  });

  it("first-only mode leaves a first-time wallet with no round-ups to the daily run: no chain read at all", async () => {
    const repo = await seeded([]);
    const { chain, calls } = counting();
    expect(await runPlanting({ repo, now: NOW, chain, only: "first" })).toEqual({ planted: [], skipped: [] });
    expect(calls.delegationReads).toBe(0);
  });

  it("two wallets of one first-time user: the first plants at $0.60, the second is left to the daily run, where $0.60 waits", async () => {
    const repo = await seeded([25, 35]);
    await repo.addWallet({ pubkey: "W2", userPubkey: "U", delegationPda: "D2", dailyCapCents: 500 });
    await repo.insertSwap({ signature: "w2", walletPubkey: "W2", ts: new Date(NOW.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: 60 });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain(), only: "first" });
    expect(r.planted.map((p) => p.wallet)).toEqual(["W"]);
    expect(r.skipped).toEqual([{ wallet: "W2", reason: "not first" }]);
    expect((await runPlanting({ repo, now: NOW, chain: fakeChain() })).skipped.filter((x) => x.wallet === "W2")).toEqual([{ wallet: "W2", reason: "below threshold" }]);
  });

  it("an unreadable plantings table fails closed: the daily run uses the user's own threshold, first-only takes no wallet", async () => {
    const repo = await seeded([25, 35]);
    repo.hasPlanted = async () => { throw new Error("db down"); };
    const { chain, calls } = counting();
    expect(await runPlanting({ repo, now: NOW, chain, only: "first" })).toEqual({ planted: [], skipped: [] });
    expect(calls.builds.length).toBe(0);
    expect((await runPlanting({ repo, now: NOW, chain })).skipped).toEqual([{ wallet: "W", reason: "below threshold" }]);
  });

  it("a first-only run and the daily run overlapping on one first-time wallet plant its round-ups once", async () => {
    const repo = await seeded([25, 35]);
    const chain = fakeChain({ sendPlanting: async () => { await new Promise((r) => setTimeout(r, 5)); } });
    const [a, b] = await Promise.all([runPlanting({ repo, now: NOW, chain, only: "first" }), runPlanting({ repo, now: NOW, chain })]);
    expect(a.planted.length + b.planted.length).toBe(1);
    expect([...a.skipped, ...b.skipped].map((s) => s.reason)).toEqual(["claimed elsewhere"]);
    expect((await repo.getWallet("W"))!.ledgerCents.SKR ?? 0).toBe(60);
    expect(confirmed(repo).length).toBe(1);
  });

  it("two first-only runs overlapping plant once", async () => {
    const repo = await seeded([25, 35]);
    const chain = fakeChain({ sendPlanting: async () => { await new Promise((r) => setTimeout(r, 5)); } });
    const [a, b] = await Promise.all([runPlanting({ repo, now: NOW, chain, only: "first" }), runPlanting({ repo, now: NOW, chain, only: "first" })]);
    expect(a.planted.length + b.planted.length).toBe(1);
    expect(confirmed(repo).length).toBe(1);
  });

  it("first-time, $0.60 waiting and no USDC: paused for USDC at 60 cents; resumed by a first-only run once 50 cents is there", async () => {
    const repo = await seeded([25, 35]);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 0n }), only: "first" });
    expect(r.skipped).toEqual([{ wallet: "W", reason: "no usdc" }]);
    expect((await repo.getWallet("W"))!.status).toBe("paused");
    expect(repo.events.find((e) => e.kind === "paused_no_usdc")!.detail).toEqual({ needCents: 60 });
    // 50 cents covers no whole round-up here (25 + 35 = 60), but it is the resume point: the wallet is active again and waits.
    await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 500_000n }), only: "first" });
    expect((await repo.getWallet("W"))!.status).toBe("active");
    const ok = await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 600_000n }), only: "first" });
    expect(ok.planted[0]).toMatchObject({ wallet: "W", pullCents: 60 });
  });

  it("first-only mode never resumes a wallet whose user already planted (the daily run does, at their own threshold)", async () => {
    const repo = await seeded([83, 62, 70], { planted: true });
    await repo.setWalletStatus("W", "paused");
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "paused_no_usdc", detail: null });
    await runPlanting({ repo, now: NOW, chain: fakeChain(), only: "first" });
    expect((await repo.getWallet("W"))!.status).toBe("paused");
    await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 1_990_000n }) });
    expect((await repo.getWallet("W"))!.status).toBe("paused");    // $1.99 is under their $2 resume point
    await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect((await repo.getWallet("W"))!.status).toBe("active");
  });
});

// Audit F1 (11-13): a remainder the booking could not record was only a console line (Vercel Hobby keeps logs an hour) and nothing
// retried it, so that user's change stayed with the puller for good. Now every failure path writes one `remainder_unrecorded` event
// (enum detail only, no error text), and the daily run retries NULL remainders of the last 14 days, written once.
import { retryUnrecordedRemainders, REMAINDER_RETRY_MAX } from "@/lib/plant-run";

describe("unrecorded remainders are loud and retried (audit F1)", () => {
  const lendOnly = { SKR: 0, stORE: 0, USDC_LEND: 100, SOL_LEND: 0, hSOL: 0, cbBTC: 0 };
  const solOnly = { ...lendOnly, USDC_LEND: 0, SOL_LEND: 100 };
  const remainderEvents = (repo: MemoryRepo) => repo.events.filter((e) => e.kind === "remainder_unrecorded");
  const plantings = (repo: MemoryRepo) => [...repo.plantings.values()].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});
  const addSwaps = async (repo: MemoryRepo, tag: string, at: Date) => {
    for (const [i, c] of [83, 62, 70].entries()) await repo.insertSwap({ signature: `${tag}${i}`, walletPubkey: "W", ts: new Date(at.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
  };
  /** An SKR planting whose remainder read failed: confirmed, skr_surplus_raw NULL. */
  const skrMissing = async (repo?: MemoryRepo, now = NOW, tag = "x") => {
    const r = repo ?? (await seeded([83, 62, 70]));
    if (!repo) await storeOff(r); else await addSwaps(r, tag, now);
    await runPlanting({ repo: r, now, chain: fakeChain({ pullerSkrChangeRaw: async () => { throw new Error("rpc down: https://rpc.example/?api-key=SECRET"); } }) });
    return r;
  };
  const solMissing = async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: solOnly });
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerCarryChangeRaw: async () => { throw new Error("rpc down SECRET"); } }) });
    return repo;
  };

  it("SKR read failed: one event, user and wallet set, enum detail, no error text", async () => {
    const e = quiet();
    const repo = await skrMissing();
    e.mockRestore();
    const p = plantings(repo)[0];
    expect(p).toMatchObject({ status: "confirmed", skrSurplusRaw: null });
    const ev = remainderEvents(repo);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ userPubkey: "U", walletPubkey: "W", detail: { plantingId: p.id, kind: "SKR", reason: "read_failed" } });
    expect(Object.keys(ev[0].detail as object).sort()).toEqual(["kind", "plantingId", "reason"]);
    expect(JSON.stringify(ev[0].detail)).not.toMatch(/rpc|SECRET|api-key/);
  });

  it("SKR below zero: one event with reason below_zero", async () => {
    const repo = await seeded([83, 62, 70]);
    await storeOff(repo);
    const e = quiet();
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerSkrChangeRaw: async () => -5n }) });
    e.mockRestore();
    expect(remainderEvents(repo).map((x) => x.detail)).toEqual([{ plantingId: plantings(repo)[0].id, kind: "SKR", reason: "below_zero" }]);
  });

  it("WSOL read failed: one event with kind WSOL, no error text", async () => {
    const e = quiet();
    const repo = await solMissing();
    e.mockRestore();
    const ev = remainderEvents(repo);
    expect(ev.map((x) => x.detail)).toEqual([{ plantingId: plantings(repo)[0].id, kind: "WSOL", reason: "read_failed" }]);
    expect(ev[0]).toMatchObject({ userPubkey: "U", walletPubkey: "W" });
    expect(JSON.stringify(ev[0].detail)).not.toContain("SECRET");
  });

  it("USDC below zero: one event with kind USDC", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo);
    await repo.saveRules("U", { allocation: lendOnly });
    const e = quiet();
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerCarryChangeRaw: async () => -1n }) });
    e.mockRestore();
    expect(remainderEvents(repo).map((x) => x.detail)).toEqual([{ plantingId: plantings(repo)[0].id, kind: "USDC", reason: "below_zero" }]);
  });

  it("the legs read failed twice (the silent .catch): one event with kind legs", async () => {
    const repo = await seeded([83, 62, 70]);
    await storeOff(repo);
    const spy = vi.spyOn(repo, "plantingLegs").mockRejectedValue(new Error("db down SECRET"));
    const e = quiet();
    await runPlanting({ repo, now: NOW, chain: fakeChain() });
    e.mockRestore();
    spy.mockRestore();
    const ev = remainderEvents(repo);
    expect(ev.map((x) => x.detail)).toEqual([{ plantingId: plantings(repo)[0].id, kind: "legs", reason: "legs_read_failed" }]);
    expect(JSON.stringify(ev[0].detail)).not.toContain("SECRET");
  });

  it("a recorded remainder writes no event", async () => {
    const repo = await seeded([83, 62, 70]);
    await storeOff(repo);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerSkrChangeRaw: async () => 500n }) });
    expect(remainderEvents(repo)).toHaveLength(0);
  });

  it("a throwing event write never breaks the booking: the planting is confirmed and planted, the carry recorder still runs", async () => {
    const repo = await seeded([83, 62, 70]);
    await storeOff(repo);
    const spy = vi.spyOn(repo, "addEvent").mockRejectedValue(new Error("events insert failed"));
    const e = quiet();
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ pullerSkrChangeRaw: async () => { throw new Error("rpc down"); } }) });
    e.mockRestore();
    spy.mockRestore();
    expect(r.planted).toHaveLength(1);
    expect(r.skipped).toEqual([]);
    expect(plantings(repo)[0].status).toBe("confirmed");
  });

  it("retry: records a NULL SKR remainder once, and a second retry never adds it twice", async () => {
    const e = quiet();
    const repo = await skrMissing();
    e.mockRestore();
    const later = new Date(NOW.getTime() + 86_400_000);
    let reads = 0;
    const r1 = await retryUnrecordedRemainders({ repo, now: later, deadlineMs: Date.now() + 60_000, chain: fakeChain({ pullerSkrChangeRaw: async () => { reads++; return 500n; } }) });
    expect(r1).toEqual({ retried: 1, recorded: 1, still_missing: 0, deferred: 0 });
    expect(plantings(repo)[0].skrSurplusRaw).toBe(500n);
    const r2 = await retryUnrecordedRemainders({ repo, now: later, deadlineMs: Date.now() + 60_000, chain: fakeChain({ pullerSkrChangeRaw: async () => { reads++; return 900n; } }) });
    expect(r2).toEqual({ retried: 0, recorded: 0, still_missing: 0, deferred: 0 });
    expect(reads).toBe(1);
    expect(plantings(repo)[0].skrSurplusRaw).toBe(500n);
    expect(await repo.skrCreditRaw("U")).toBe(500n);
    expect(remainderEvents(repo)).toHaveLength(1);   // the retry writes no new event; the first one resolves on Money ops
  });

  it("retry: records a NULL WSOL remainder once (carry row created), never twice", async () => {
    const e = quiet();
    const repo = await solMissing();
    e.mockRestore();
    const later = new Date(NOW.getTime() + 86_400_000);
    const r1 = await retryUnrecordedRemainders({ repo, now: later, deadlineMs: Date.now() + 60_000, chain: fakeChain({ pullerCarryChangeRaw: async () => 777n }) });
    expect(r1).toEqual({ retried: 1, recorded: 1, still_missing: 0, deferred: 0 });
    const r2 = await retryUnrecordedRemainders({ repo, now: later, deadlineMs: Date.now() + 60_000, chain: fakeChain({ pullerCarryChangeRaw: async () => 999n }) });
    expect(r2.retried).toBe(0);
    expect(await repo.carryCreditRaw("U", "WSOL")).toBe(777n);
  });

  it("retry: a read that fails again stays missing and writes no event", async () => {
    const e = quiet();
    const repo = await skrMissing();
    const r = await retryUnrecordedRemainders({ repo, now: NOW, deadlineMs: Date.now() + 60_000, chain: fakeChain({ pullerSkrChangeRaw: async () => { throw new Error("still down"); } }) });
    e.mockRestore();
    expect(r).toEqual({ retried: 1, recorded: 0, still_missing: 1, deferred: 0 });
    expect(remainderEvents(repo)).toHaveLength(1);
  });

  it("retry: respects its cap, newest first; the oldest wait", async () => {
    const e = quiet();
    const repo = await skrMissing();
    const d2 = new Date(NOW.getTime() + 86_400_000), d3 = new Date(NOW.getTime() + 2 * 86_400_000);
    await skrMissing(repo, d2, "b");
    await skrMissing(repo, d3, "c");
    e.mockRestore();
    expect(plantings(repo).filter((p) => p.skrSurplusRaw === null)).toHaveLength(3);
    const r = await retryUnrecordedRemainders({ repo, now: d3, max: 2, deadlineMs: Date.now() + 60_000, chain: fakeChain({ pullerSkrChangeRaw: async () => 10n }) });
    expect(r).toEqual({ retried: 2, recorded: 2, still_missing: 0, deferred: 1 });
    expect(plantings(repo).map((p) => p.skrSurplusRaw)).toEqual([null, 10n, 10n]);
    expect(REMAINDER_RETRY_MAX).toBe(20);
  });

  it("retry: past its cutoff it reads nothing from the chain", async () => {
    const e = quiet();
    const repo = await skrMissing();
    e.mockRestore();
    let reads = 0;
    const r = await retryUnrecordedRemainders({ repo, now: NOW, deadlineMs: Date.now() - 1, chain: fakeChain({ pullerSkrChangeRaw: async () => { reads++; return 10n; } }) });
    expect(r).toEqual({ retried: 0, recorded: 0, still_missing: 0, deferred: 1 });
    expect(reads).toBe(0);
  });

  it("retry: only the last 14 days, only with a signature", async () => {
    const e = quiet();
    const repo = await skrMissing();
    e.mockRestore();
    const r = await retryUnrecordedRemainders({ repo, now: new Date(NOW.getTime() + 15 * 86_400_000), deadlineMs: Date.now() + 60_000, chain: fakeChain({ pullerSkrChangeRaw: async () => 10n }) });
    expect(r.retried).toBe(0);
    const p = plantings(repo)[0];
    repo.plantings.set(p.id, { ...p, signature: null });
    expect((await retryUnrecordedRemainders({ repo, now: NOW, deadlineMs: Date.now() + 60_000, chain: fakeChain({ pullerSkrChangeRaw: async () => 10n }) })).retried).toBe(0);
  });
});

// Owner 11-13 ("Carry it to the next days"): round-ups past the daily cap wait for the next days instead of being claimed and never
// moved. A cap-bounded planting claims the oldest round-ups that fit in its pull, whole (the R361 shape); the rest stay unplanted.
describe("cap carry: round-ups past the daily cap wait for the next days (owner 11-13)", () => {
  type BuildArgs = Parameters<Chain["buildPlantingTx"]>[0];
  const DAY = 86_400_000;
  const recording = (builds: BuildArgs[], over: Partial<Chain> = {}) => { const base = fakeChain(over); return { ...base, buildPlantingTx: async (a: BuildArgs) => { builds.push(a); return base.buildPlantingTx(a); } } as Chain; };
  /** Round-ups an hour apart, the first the oldest (ages in hours before NOW; `old` ones are 8 days old). */
  async function queued(roundups: number[], opts: { old?: number[]; planted?: boolean } = {}) {
    const repo = await seeded([], { planted: opts.planted });
    for (const [i, c] of roundups.entries()) {
      const ts = opts.old?.includes(i) ? new Date(NOW.getTime() - 8 * DAY - (roundups.length - i) * 3_600_000) : new Date(NOW.getTime() - (roundups.length - i) * 3_600_000);
      await repo.insertSwap({ signature: `q${i}`, walletPubkey: "W", ts, inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 100, class: "major", roundupCents: c });
    }
    return repo;
  }
  const waiting = async (repo: MemoryRepo) => (await repo.unplantedSwaps("W")).map((s) => s.roundupCents);
  const owed = async (repo: MemoryRepo) => (await repo.unplantedSwaps("W")).map((s) => s.owedCents);
  const partsOf = (repo: MemoryRepo, id: string) => repo.swapParts.filter((x) => x.plantingId === id).map((x) => [x.signature, x.cents]);
  const lastPlanting = (repo: MemoryRepo) => [...repo.plantings.values()].at(-1)!;
  const claimedBy = (repo: MemoryRepo, id: string) => [...repo.swaps.values()].filter((s) => s.plantingId === id).map((s) => s.roundupCents);

  it("$22.31 waiting with a $5 cap: each day claims only the oldest round-ups that fit; the rest wait; nothing is lost", async () => {
    const repo = await queued([120, 95, 210, 80, 300, 150, 400, 276, 600]);   // 2231 cents
    const pulls: number[] = [];
    for (let d = 0; d < 5; d++) {
      const r = await runPlanting({ repo, now: new Date(NOW.getTime() + d * DAY), chain: fakeChain() });
      pulls.push(r.planted[0].pullCents);
      const p = lastPlanting(repo);
      expect(claimedBy(repo, p.id).reduce((s, c) => s + c, 0)).toBe(d === 4 ? 0 : p.usdcPulledCents);   // claimed = pulled; day 5 is a part
      if (d === 0) expect(await waiting(repo)).toEqual([80, 300, 150, 400, 276, 600]);
    }
    // Day 1: 120 + 95 + 210 (80 would pass 500); day 2: 80 + 300; day 3: 150 + 276; day 4: 400; day 5: a 500 part of the 600.
    expect(pulls).toEqual([425, 380, 426, 400, 500]);
    expect(partsOf(repo, lastPlanting(repo).id)).toEqual([["q8", 500]]);
    expect(await owed(repo)).toEqual([100]);
    // The 100 left is under the $2 threshold: it waits, then the 7-day rule (from the swap's own time) plants it.
    expect((await runPlanting({ repo, now: new Date(NOW.getTime() + 5 * DAY), chain: fakeChain() })).skipped[0].reason).toBe("below threshold");
    const last = await runPlanting({ repo, now: new Date(NOW.getTime() + 7 * DAY), chain: fakeChain() });
    pulls.push(last.planted[0].pullCents);
    expect(pulls.reduce((s, c) => s + c, 0)).toBe(2231);
    expect(await waiting(repo)).toEqual([]);
    expect(pulls.every((p) => p <= 500)).toBe(true);
  });

  it("a single $10 round-up with a $5 cap: day 1 pulls a $5 part (still owing $5), day 2 pulls the $5 and claims it; nothing lost", async () => {
    const repo = await queued([1000, 100, 100]);
    const r1 = await runPlanting({ repo, now: NOW, chain: fakeChain() });
    expect(r1.planted[0].pullCents).toBe(500);
    const p1 = lastPlanting(repo);
    expect(claimedBy(repo, p1.id)).toEqual([]);
    expect(partsOf(repo, p1.id)).toEqual([["q0", 500]]);
    expect(await owed(repo)).toEqual([500, 100, 100]);
    const r2 = await runPlanting({ repo, now: new Date(NOW.getTime() + DAY), chain: fakeChain() });
    expect(r2.planted[0].pullCents).toBe(500);
    expect(claimedBy(repo, lastPlanting(repo).id)).toEqual([1000]);
    expect(partsOf(repo, lastPlanting(repo).id)).toEqual([]);
    expect(await owed(repo)).toEqual([100, 100]);
    const r3 = await runPlanting({ repo, now: new Date(NOW.getTime() + 2 * DAY), chain: fakeChain() });
    expect(r3.planted[0].pullCents).toBe(200);
    expect(await waiting(repo)).toEqual([]);
    expect(Object.values((await repo.getWallet("W"))!.ledgerCents).reduce((a, c) => a + (c ?? 0), 0)).toBe(1200);
    expect([...repo.plantings.values()].reduce((s, p) => s + p.usdcPulledCents, 0)).toBe(1200);
  });

  it("$25 at a $5 cap: five days of $5, four parts then the claim; nothing lost", async () => {
    const repo = await queued([2500]);
    const pulls: number[] = [];
    for (let d = 0; d < 5; d++) {
      expect(await owed(repo)).toEqual([2500 - 500 * d]);
      pulls.push((await runPlanting({ repo, now: new Date(NOW.getTime() + d * DAY), chain: fakeChain() })).planted[0].pullCents);
    }
    expect(pulls).toEqual([500, 500, 500, 500, 500]);
    expect(repo.swapParts.map((x) => x.cents)).toEqual([500, 500, 500, 500]);
    expect(claimedBy(repo, lastPlanting(repo).id)).toEqual([2500]);
    expect(await waiting(repo)).toEqual([]);
  });

  it("a part whose planting fails on chain no longer counts: the owed amount goes back up and is pulled again", async () => {
    const repo = await queued([1000]);
    const r1 = await runPlanting({ repo, now: NOW, chain: fakeChain({ sendPlanting: async () => { throw new Error("blockhash expired"); }, signatureStatus: async () => "failed" }) });
    expect(r1.skipped[0].reason).toBe("send failed");
    expect(lastPlanting(repo).status).toBe("failed");
    expect(await owed(repo)).toEqual([1000]);
    const r2 = await runPlanting({ repo, now: new Date(NOW.getTime() + DAY), chain: fakeChain() });
    expect(r2.planted[0].pullCents).toBe(500);
    expect(await owed(repo)).toEqual([500]);
  });

  it("a part still `sent` counts (reserved) until it fails", async () => {
    const repo = await queued([1000]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ sendPlanting: async () => { throw new Error("websocket closed"); }, signatureStatus: async () => "pending" }) });
    expect(lastPlanting(repo).status).toBe("sent");
    expect(await owed(repo)).toEqual([500]);
    await repo.setPlantingStatus(lastPlanting(repo).id, "failed");
    expect(await owed(repo)).toEqual([1000]);
  });

  // Round 3 (review): a part racing a whole claim of the same swap. Run A sees a $5 cap (the 600 is oversized: a part), run B a $10
  // cap (the 600 fits: a whole claim); both read the swap before either writes. Exactly one pulls.
  it("a part racing a whole claim of the same swap (different caps): exactly one pulls", async () => {
    const repo = await seeded([], {});
    await repo.saveRules("U", { dailyCapCents: 1000 });
    const w = (await repo.getWallet("W"))!;
    w.dailyCapCents = 1000;
    await repo.insertSwap({ signature: "S", walletPubkey: "W", ts: new Date(NOW.getTime() - 3_600_000), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 60_000, class: "major", roundupCents: 600 });
    // A reads S, then waits (its balance read) until B has claimed S whole and sent; only then does A write its part.
    let bSent!: () => void;
    const gate = new Promise<void>((r) => { bSent = r; });
    const capA = fakeChain({ readDelegation: async () => DELEGATION, usdcBalanceRaw: async () => { await gate; return 50_000_000n; } });   // $5
    const capB = fakeChain({ readDelegation: async () => ({ ...DELEGATION, amountPerPeriodRaw: 10_000_000n }), sendPlanting: async () => { bSent(); } });   // $10
    const [a, b] = await Promise.all([runPlanting({ repo, now: NOW, chain: capA }), runPlanting({ repo, now: NOW, chain: capB })]);
    expect(b.planted.length).toBe(1);
    expect(a.planted.length).toBe(0);
    expect(a.skipped[0].reason).toBe("claimed elsewhere");
    const live = [...repo.plantings.values()].filter((p) => p.status !== "failed");
    expect(live.length).toBe(1);
    // Whoever won, the cents pulled for S plus what S still owes is exactly 600: never more.
    const owes = (await owed(repo))[0] ?? 0;
    expect(live[0].usdcPulledCents + owes).toBe(600);
  });

  // Round 3 (review): a whole claim while a part of the same swap is still `sent` would lose that part if its planting then failed.
  it("a swap with a part on a `sent` planting is not claimed whole: it waits; confirmed, the rest is claimed", async () => {
    const repo = await queued([1000]);
    const pending = fakeChain({ sendPlanting: async () => { throw new Error("websocket closed"); }, signatureStatus: async () => "pending" });
    await runPlanting({ repo, now: NOW, chain: pending });
    const p1 = lastPlanting(repo);
    expect(p1.status).toBe("sent");
    expect(await owed(repo)).toEqual([500]);
    const r2 = await runPlanting({ repo, now: new Date(NOW.getTime() + 60_000), chain: pending });
    expect(r2.planted).toEqual([]);
    expect(r2.skipped[0].reason).toBe("part in flight");
    expect(claimedBy(repo, lastPlanting(repo).id)).toEqual([]);
    await repo.setPlantingStatus(p1.id, "confirmed");
    const r3 = await runPlanting({ repo, now: new Date(NOW.getTime() + 120_000), chain: fakeChain() });
    expect(r3.planted[0].pullCents).toBe(500);
    expect(claimedBy(repo, lastPlanting(repo).id)).toEqual([1000]);
    expect(await waiting(repo)).toEqual([]);
  });

  it("a swap with a part on a `sent` planting that then fails: the full owed amount is pulled again", async () => {
    const repo = await queued([1000]);
    await runPlanting({ repo, now: NOW, chain: fakeChain({ sendPlanting: async () => { throw new Error("websocket closed"); }, signatureStatus: async () => "pending" }) });
    const p1 = lastPlanting(repo);
    await repo.setPlantingStatus(p1.id, "failed");
    expect(await owed(repo)).toEqual([1000]);
    const r = await runPlanting({ repo, now: new Date(NOW.getTime() + 60_000), chain: fakeChain() });
    expect(r.planted[0].pullCents).toBe(500);
    expect(partsOf(repo, lastPlanting(repo).id)).toEqual([["q0", 500]]);
    expect(await owed(repo)).toEqual([500]);
  });

  it("two overlapping runs on an oversized round-up record one part", async () => {
    const repo = await queued([1000]);
    const chain = fakeChain({ sendPlanting: async () => { await new Promise((r) => setTimeout(r, 5)); } });
    const [a, b] = await Promise.all([runPlanting({ repo, now: NOW, chain }), runPlanting({ repo, now: NOW, chain })]);
    expect(a.planted.length + b.planted.length).toBeLessThanOrEqual(1);
    expect(await owed(repo)).toEqual([1000 - 500 * (a.planted.length + b.planted.length)]);
    expect([...repo.plantings.values()].filter((p) => p.status !== "failed").length).toBe(a.planted.length + b.planted.length);
  });

  it("an oversized round-up behind smaller ones waits its turn, then is pulled in parts", async () => {
    const repo = await queued([100, 1000, 150]);
    expect((await runPlanting({ repo, now: NOW, chain: fakeChain() })).planted[0].pullCents).toBe(250);
    expect(await waiting(repo)).toEqual([1000]);
    expect((await runPlanting({ repo, now: new Date(NOW.getTime() + DAY), chain: fakeChain() })).planted[0].pullCents).toBe(500);
    expect(await owed(repo)).toEqual([500]);
    expect((await runPlanting({ repo, now: new Date(NOW.getTime() + 2 * DAY), chain: fakeChain() })).planted[0].pullCents).toBe(500);
    expect(await waiting(repo)).toEqual([]);
  });

  it("pending at or under the cap is unchanged: everything claimed in one planting", async () => {
    const repo = await queued([200, 150, 150]);
    expect((await runPlanting({ repo, now: NOW, chain: fakeChain() })).planted[0].pullCents).toBe(500);
    expect(await waiting(repo)).toEqual([]);
  });

  it("cap and a short balance together take the stricter bound once", async () => {
    const repo = await queued([120, 95, 210, 80, 300, 150, 400, 276, 600]);
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ usdcBalanceRaw: async () => 3_000_000n }) });
    expect(r.planted[0].pullCents).toBe(295);   // $3.00: 120 + 95 + 80 (210 skipped)
    expect(await waiting(repo)).toEqual([210, 300, 150, 400, 276, 600]);
    expect((await repo.getWallet("W"))!.status).toBe("active");
  });

  it("the 7-day minimum of zero holds only when an old round-up is among the claimed ones", async () => {
    const periodStart = BigInt(Math.floor(NOW.getTime() / 1000) - 3600);
    const chain = fakeChain({ readDelegation: async () => ({ ...DELEGATION, pulledInPeriodRaw: 3_500_000n, periodStartTs: periodStart }) });   // 150 left
    // The old 100 fits in the 150 left: claimed, so the planting is forced under the $2 threshold.
    const fits = await queued([100, 300, 300], { old: [0], planted: true });
    expect((await runPlanting({ repo: fits, now: NOW, chain })).planted[0].pullCents).toBe(100);
    expect(await waiting(fits)).toEqual([300, 300]);
    // The old 300 does not fit in today's 150 (it fits a full day): the new 100 alone is under the threshold, so nothing is claimed.
    const skipped = await queued([300, 100, 300], { old: [0], planted: true });
    const r = await runPlanting({ repo: skipped, now: NOW, chain });
    expect(r.planted).toEqual([]);
    expect(r.skipped[0].reason).toBe("below threshold");
    expect(await waiting(skipped)).toEqual([300, 100, 300]);
  });

  it("every enabled leg at its max under a binding cap: the cap picks the round-ups, all pulled and claimed; the rest wait (11-15, A5)", async () => {
    const repo = await queued([300, 150, 300, 200]);   // 950 pending, cap 500
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { plantThresholdCents: 100, stop: "careful", allocation: { SKR: 60, stORE: 0, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 20 } });
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([6, 7]) }) });
    // The cap selects 300 + 150 (450; the next 300 would pass 500, the 200 too); all 450 pulled and claimed (A5; was 45%, 202).
    // The 300 and the 200 wait for the next day.
    expect(builds[0]).toMatchObject({ asset: "cbBTC", pullRaw: 4_500_000n });
    expect(r.planted[0]).toMatchObject({ pullCents: 450 });
    expect(claimedBy(repo, [...repo.plantings.values()][0].id)).toEqual([300, 150]);
    expect(await waiting(repo)).toEqual([300, 200]);
  });

  it("an oversized oldest round-up waits for a full day: 490 of 500 already pulled, the old $10 claims nothing today, then goes alone", async () => {
    const repo = await queued([1000, 5], { old: [0] });   // forced: the 1000 is 8 days old
    const periodStart = BigInt(Math.floor(NOW.getTime() / 1000) - 3600);
    const r1 = await runPlanting({ repo, now: NOW, chain: fakeChain({ readDelegation: async () => ({ ...DELEGATION, pulledInPeriodRaw: 4_900_000n, periodStartTs: periodStart }) }) });
    expect(r1.planted).toEqual([]);
    expect(r1.skipped[0].reason).toBe("cap reached");
    expect(await waiting(repo)).toEqual([1000, 5]);   // the 5 behind it does not jump ahead
    const r2 = await runPlanting({ repo, now: new Date(NOW.getTime() + DAY), chain: fakeChain() });   // a fresh period
    expect(r2.planted[0].pullCents).toBe(500);
    expect(partsOf(repo, [...repo.plantings.values()][0].id)).toEqual([["q0", 500]]);
    expect(await owed(repo)).toEqual([500, 5]);
  });

  // Round 3 (review): under a share < 100 a part records what was pulled for it, never the whole day.
  it("every enabled leg at its max with an oversized round-up: the part records the whole day pulled; the rest is still owed (11-15, A5)", async () => {
    const repo = await queued([1000]);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { plantThresholdCents: 100, stop: "careful", allocation: { SKR: 60, stORE: 0, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 20 } });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readLeashConfig: async () => leashCfg([6, 7]) }) });
    expect(r.planted[0].pullCents).toBe(500);   // the 500 day (A5; was 45% of it, 225)
    expect(partsOf(repo, lastPlanting(repo).id)).toEqual([["q0", 500]]);
    expect(await owed(repo)).toEqual([500]);
  });

  it("share under 100: a share too small for any planting skips and claims nothing", async () => {
    const repo = await queued([150], { planted: true });
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { stop: "careful", allocation: { SKR: 60, stORE: 0, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 20 } });
    const r = await runPlanting({ repo, now: NOW, chain: fakeChain({ readLeashConfig: async () => leashCfg([6, 7]) }) });
    expect(r.skipped[0].reason).toBe("below threshold");
    expect(await waiting(repo)).toEqual([150]);
  });
});

import { plantingTarget, SplitUnder100Error } from "@/lib/plant-run";
import { ASSETS } from "@/domain/coins";
import type { Pins } from "@/domain/roundup";

describe("a coin switched off is never bought (11-15, coin flexibility Task 3)", () => {
  type BuildArgs = Parameters<Chain["buildPlantingTx"]>[0];
  const recording = (builds: BuildArgs[], over: Partial<Chain> = {}) => { const base = fakeChain(over); return { ...base, buildPlantingTx: async (a: BuildArgs) => { builds.push(a); return base.buildPlantingTx(a); } } as Chain; };
  const split = (s: Partial<Record<(typeof ASSETS)[number], number>>) => ({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0, ...s });
  const failing = (bad: string, builds: BuildArgs[]) => { const base = fakeChain(); return fakeChain({ buildPlantingTx: async (a) => { builds.push(a); if (a.asset === bad) throw new Error("Jupiter: no route"); return base.buildPlantingTx(a); } }); };

  it("(a) SKR off, the cbBTC leg fails to build: no SKR attempt, leg_skipped, nothing pulled", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { managed: false, pins: { SKR: 0, cbBTC: 90 }, allocation: split({ stORE: 10, cbBTC: 90 }) });
    await repo.bumpLedger("W", "stORE", 1_000);   // the picker wants cbBTC
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: failing("cbBTC", builds) });
    expect(builds.map((b) => b.asset)).toEqual(["cbBTC"]);
    expect(r.planted).toEqual([]);
    expect(r.skipped).toEqual([{ wallet: "W", reason: "leg failed" }]);
    expect(repo.events.map((e) => e.kind)).toContain("leg_skipped");
    expect(repo.events.map((e) => e.kind)).not.toContain("leg_fallback");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
  });

  it("(b) SKR on, the same cbBTC failure: falls back to SKR as before", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { managed: false, pins: { cbBTC: 50 }, allocation: split({ SKR: 40, stORE: 10, cbBTC: 50 }) });
    await repo.bumpLedger("W", "SKR", 1_000);
    await repo.bumpLedger("W", "stORE", 1_000);   // cbBTC furthest under
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: failing("cbBTC", builds) });
    expect(builds.map((b) => b.asset)).toEqual(["cbBTC", "SKR"]);
    expect(r.planted[0]?.asset).toBe("SKR");
    expect(repo.events.map((e) => e.kind)).toContain("leg_fallback");
  });

  it("(c) the only coin on is USDC lending and its venue is out today: no leg enabled, no pull, the round-ups wait", async () => {
    const repo = await seeded([83, 62, 70]);
    await seedVenues(repo, { kamino_klend: { eligible: false }, jupiter_lend: { eligible: false } });
    await repo.saveRules("U", { managed: false, pins: { SKR: 0, stORE: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 }, allocation: split({ USDC_LEND: 100 }) });
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds).toEqual([]);
    expect(r.planted).toEqual([]);
    expect(r.skipped).toEqual([{ wallet: "W", reason: "no leg enabled" }]);
    expect(repo.events.map((e) => e.kind)).not.toContain("pull_failed");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
    expect(repo.plantings.size).toBe(0);
  });

  it("(c) leashed: every on coin's leash leg off is no leg enabled too", async () => {
    const repo = await seeded([83, 62, 70]);
    await repo.setWalletLink("W", { delegationPda: "D", linkModel: "leash" });
    await repo.saveRules("U", { managed: false, pins: { SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0 }, allocation: split({ hSOL: 75, SKR: 25 }) });
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds, { readLeashConfig: async () => leashCfg([0, 1, 7]) }) });   // SKR, stORE, cbBTC legs on; hSOL off
    expect(builds).toEqual([]);
    expect(r.skipped).toEqual([{ wallet: "W", reason: "no leg enabled" }]);
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
  });

  const base = { managed: false, stop: "balanced" as const };
  it("(d) stORE pinned 5: the target keeps stORE at 5 (the net does not raise it)", () => {
    expect(plantingTarget({ ...base, pins: { stORE: 5 }, allocation: split({ SKR: 95, stORE: 5 }) }, [])).toEqual(split({ SKR: 95, stORE: 5 }));
  });

  it("(e) the default user (no pins, SKR 100): target SKR 90 / stORE 10 as today", () => {
    expect(plantingTarget({ ...base, pins: {}, allocation: split({ SKR: 100 }) }, [])).toEqual(split({ SKR: 90, stORE: 10 }));
    expect(plantingTarget({ managed: true, stop: "careful", pins: {}, allocation: split({ SKR: 100 }) }, [])).toEqual(split({ SKR: 90, stORE: 10 }));
  });

  it("(f) SKR on, its leg out: the overflow goes to USDC lending as today", () => {
    expect(plantingTarget({ managed: true, stop: "careful", pins: {}, allocation: split({ SKR: 90, stORE: 10 }) }, ["SKR", "cbBTC"]))
      .toEqual(split({ stORE: 10, USDC_LEND: 60, SOL_LEND: 15, hSOL: 15 }));
  });

  it("(g) USDC lending out as well: the largest on coin takes the rest and the target sums to 100", () => {
    const t = plantingTarget({ managed: true, stop: "careful", pins: {}, allocation: split({ SKR: 90, stORE: 10 }) }, ["SKR", "cbBTC", "USDC_LEND"]);
    expect(t).toEqual(split({ stORE: 10, SOL_LEND: 75, hSOL: 15 }));
  });

  it("(h) a stale allocation with SKR 40 for a user whose SKR is off: target SKR 0", () => {
    const t = plantingTarget({ ...base, pins: { SKR: 0, hSOL: 50 }, allocation: split({ SKR: 40, stORE: 10, hSOL: 50 }) }, []);
    expect(t?.SKR).toBe(0);
    expect(ASSETS.reduce((s, c) => s + t![c], 0)).toBeCloseTo(100, 9);
  });

  it("(h) in the run: the stale SKR share never plants SKR, nor a lending leg with no venue", async () => {
    for (let d = 0; d < 6; d++) {
      const repo = await seeded([83, 62, 70]);
      await repo.saveRules("U", { managed: false, pins: { SKR: 0, hSOL: 50 }, allocation: split({ SKR: 40, stORE: 10, hSOL: 50 }) });
      if (d > 0) await repo.bumpLedger("W", ASSETS[d], 10_000);   // tilt the picker each time
      const builds: BuildArgs[] = [];
      const r = await runPlanting({ repo, now: NOW, chain: recording(builds) });
      expect(r.planted.length).toBe(1);
      expect(builds.map((b) => b.asset).filter((a) => a === "SKR" || a === "USDC_LEND" || a === "SOL_LEND")).toEqual([]);
    }
  });

  it("A5: no target from redistributeDisabled sums under 100 (every disabled set, many splits, pins and stops)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
    let checked = 0;
    for (let i = 0; i < 120; i++) {
      // A whole-percent split summing to 100, and pins switching a random set of coins off (never all of them).
      const cuts = ASSETS.slice(1).map(() => Math.floor(rnd() * 101)).sort((x, y) => x - y);
      const parts = [...cuts, 100].map((c, k) => c - (k ? cuts[k - 1] : 0));
      const allocation = Object.fromEntries(ASSETS.map((c, k) => [c, parts[k]])) as ReturnType<typeof split>;
      const pins: Pins = {};
      for (const c of ASSETS) if (rnd() < 0.3) pins[c] = 0;
      if (rnd() < 0.3 && pins.stORE === undefined) pins.stORE = 5;
      if (ASSETS.every((c) => pins[c] === 0)) delete pins.SKR;
      for (const stop of ["careful", "balanced", "bold"] as const) {
        for (const managed of [true, false]) {
          for (let mask = 0; mask < 64; mask++) {
            const disabled = ASSETS.filter((_, k) => mask & (1 << k));
            const t = plantingTarget({ managed, stop, pins, allocation }, disabled);
            checked++;
            if (t === null) continue;
            expect(ASSETS.reduce((s, c) => s + t[c], 0)).toBeCloseTo(100, 9);
            for (const c of ASSETS) if (pins[c] === 0 || disabled.includes(c)) expect(t[c]).toBe(0);
          }
        }
      }
    }
    expect(checked).toBe(120 * 3 * 2 * 64);
  });

  it("A5: an allocation that is not whole (corrupt row) throws the invariant, which the run skips as split under 100: no pull, nothing claimed, no outage", async () => {
    expect(() => plantingTarget({ ...base, pins: {}, allocation: split({ SKR: 50 }) }, [])).toThrow(SplitUnder100Error);
    const repo = await seeded([83, 62, 70]);
    await repo.saveRules("U", { allocation: split({ SKR: 50 }) });
    const builds: BuildArgs[] = [];
    const r = await runPlanting({ repo, now: NOW, chain: recording(builds) });
    expect(builds).toEqual([]);
    expect(r.skipped).toEqual([{ wallet: "W", reason: "split under 100" }]);
    expect(repo.events.map((e) => e.kind)).not.toContain("pull_failed");
    expect((await repo.unplantedSwaps("W")).length).toBe(3);
    expect(repo.plantings.size).toBe(0);
  });
});
