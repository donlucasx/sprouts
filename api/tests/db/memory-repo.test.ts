import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { SKR_ONLY } from "@/domain/coins";
import type { CoinDayRow } from "@/db/types";
import type { Asset } from "@/domain/coins";
import type { AutoVenue } from "@/domain/venues";

async function withWallet() {
  const r = new MemoryRepo();
  await r.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
  await r.addWallet({ pubkey: "W", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
  return r;
}

const swap = (signature: string, roundupCents = 83) => ({
  signature, walletPubkey: "W", ts: new Date(), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1,
  usdSizeCents: 117, class: "memecoin" as const, roundupCents,
});

describe("MemoryRepo", () => {
  it("insertSwap rejects a duplicate signature", async () => {
    const r = await withWallet();
    expect(await r.insertSwap(swap("sig1"))).toBe(true);
    expect(await r.insertSwap(swap("sig1"))).toBe(false);
    expect((await r.unplantedSwaps("W")).length).toBe(1);
  });

  it("useNonce works once and refuses expired", async () => {
    const r = new MemoryRepo();
    await r.putNonce({ nonce: "n1", expiresAt: new Date(Date.now() + 60_000) });
    expect(await r.useNonce("n1", "p")).toBe(true);
    expect(await r.useNonce("n1", "p")).toBe(false);
    await r.putNonce({ nonce: "n2", expiresAt: new Date(Date.now() - 1) });
    expect(await r.useNonce("n2", "p")).toBe(false);
  });

  it("getRules creates defaults for a known user and saveRules changes them", async () => {
    const r = new MemoryRepo();
    await r.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    expect((await r.getRules("U")).dailyCapCents).toBe(500);
    await r.saveRules("U", { roundupOn: false });
    expect((await r.getRules("U")).roundupOn).toBe(false);
  });

  it("claimSwaps takes only unclaimed swaps, reports how many, and releaseSwaps gives them back", async () => {
    const r = await withWallet();
    await r.insertSwap(swap("s", 100));
    const p = await r.insertPlanting(
      { userPubkey: "U", walletPubkey: "W", signature: "sig", usdcPulledCents: 103, networkFeeCents: 3, status: "sent", aiLine: null },
      [{ asset: "SKR", usdcInCents: 100, amountOutRaw: 4_800_000n, staked: true, feeAmountRaw: 24_000n, feeCents: 0, rateAtPlanting: null, venue: null }],
    );
    expect(await r.claimSwaps(["s"], p.id)).toBe(1);
    expect(await r.claimSwaps(["s"], "another")).toBe(0);
    expect((await r.unplantedSwaps("W")).length).toBe(0);
    expect((await r.plantingLegs(p.id))[0].asset).toBe("SKR");
    await r.releaseSwaps(p.id);
    expect((await r.unplantedSwaps("W")).length).toBe(1);
    expect((await r.unplantedSwaps("W"))[0].plantingId).toBeNull();
    await r.claimSwaps(["s"], p.id);
  });

  it("bindLinkCode binds only an unbound code (two wallets racing: the first keeps it)", async () => {
    const r = new MemoryRepo();
    await r.putLinkCode({ code: "RACEME", userPubkey: "U", expiresAt: new Date(Date.now() + 60_000), nonce: 1n });
    await r.bindLinkCode("RACEME", "W1", "pda1");
    await r.bindLinkCode("RACEME", "W2", "pda2");
    expect((await r.peekLinkCode("RACEME"))?.walletPubkey).toBe("W1");
  });

  it("addWallet on an existing wallet resets the delegation, cap and status and keeps the ledger", async () => {
    const r = await withWallet();
    await r.bumpLedger("W", "SKR", 50);
    await r.setWalletStatus("W", "revoked");
    const row = await r.addWallet({ pubkey: "W", userPubkey: "U", delegationPda: "D2", dailyCapCents: 300, webhookAdded: true });
    expect(row.status).toBe("active");
    expect(row.delegationPda).toBe("D2");
    expect(row.dailyCapCents).toBe(300);
    expect(row.ledgerCents).toEqual({ SKR: 50 });
  });

  it("link codes: peek, bind, take; a taken code cannot be peeked again", async () => {
    const r = new MemoryRepo();
    await r.putLinkCode({ code: "ABC234", userPubkey: "U", expiresAt: new Date(Date.now() + 60_000), nonce: 7n });
    expect((await r.peekLinkCode("ABC234"))?.nonce).toBe(7n);
    await r.bindLinkCode("ABC234", "W", "PDA");
    expect((await r.peekLinkCode("ABC234"))?.walletPubkey).toBe("W");
    expect(await r.takeLinkCode("ABC234", "OTHER")).toBeNull();
    expect((await r.takeLinkCode("ABC234", "W"))?.delegationPda).toBe("PDA");
    expect(await r.peekLinkCode("ABC234")).toBeNull();
    expect(await r.takeLinkCode("ABC234", "W")).toBeNull();
  });

  it("wallet status and the ledger", async () => {
    const r = await withWallet();
    expect((await r.listActiveWallets()).length).toBe(1);
    await r.setWalletStatus("W", "paused");
    expect((await r.listActiveWallets()).length).toBe(0);
    expect((await r.listPausedWallets()).length).toBe(1);
    await r.bumpLedger("W", "SKR", 215);
    expect((await r.getWallet("W"))?.ledgerCents).toEqual({ SKR: 215 });
  });
});

describe("the Yield Manager's rows (spec 8)", () => {
  it("bumpLedger keeps one cents map per asset", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: "W", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
    await repo.bumpLedger("W", "SKR", 200);
    await repo.bumpLedger("W", "hSOL", 50);
    await repo.bumpLedger("W", "hSOL", 25);
    expect((await repo.getWallet("W"))!.ledgerCents).toEqual({ SKR: 200, hSOL: 75 });
  });

  it("rules carry the manager's fields with their defaults, and saveRules patches them", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    const r = await repo.getRules("U");
    expect(r.managed).toBe(false);
    expect(r.stop).toBe("balanced");
    expect(r.pins).toEqual({});
    expect(r.allocation).toEqual(SKR_ONLY);
    expect(r.prevAllocation).toBeNull();
    expect(r.allocationDay).toBeNull();
    const s = await repo.saveRules("U", { managed: true, stop: "bold", pins: { cbBTC: 10 }, allocation: { ...SKR_ONLY, SKR: 60, hSOL: 30, cbBTC: 10 }, prevAllocation: SKR_ONLY, allocationDay: "2026-10-01" });
    expect(s.managed).toBe(true);
    expect(s.stop).toBe("bold");
    expect(s.pins).toEqual({ cbBTC: 10 });
    expect(s.allocation.hSOL).toBe(30);
    expect(s.prevAllocation).toEqual(SKR_ONLY);
    expect(s.allocationDay).toBe("2026-10-01");
    expect((await repo.listManagedRules()).map((x) => x.userPubkey)).toEqual(["U"]);
  });

  it("coin days and split days are keyed by day, read in order, and the latest before a day is found", async () => {
    const repo = new MemoryRepo();
    const row = (day: string, rate: number): CoinDayRow => ({ day, asset: "hSOL", rate, ratePrev: null, ratePrevDays: null, priceUsd: 140, liquidityUsd: 1e8, priceChange24h: 0, tradeable: true, lastUpdateEpoch: 1046, ok: true });
    await repo.putCoinDay(row("2026-10-03", 1.19));
    await repo.putCoinDay(row("2026-10-01", 1.18));
    await repo.putCoinDay(row("2026-10-02", 1.185));
    await repo.putCoinDay(row("2026-10-02", 1.186)); // same key: replaced
    expect((await repo.listCoinDays("hSOL", "2026-10-02")).map((r) => [r.day, r.rate])).toEqual([["2026-10-02", 1.186], ["2026-10-03", 1.19]]);
    expect((await repo.getCoinDay("2026-10-01", "hSOL"))?.rate).toBe(1.18);
    expect(await repo.getCoinDay("2026-10-01", "cbBTC")).toBeNull();

    await repo.putSplitDay({ day: "2026-10-01", stop: "balanced", split: SKR_ONLY, modelAnswer: null, why: null, fallback: "no data", callId: null, venuePick: null });
    await repo.putSplitDay({ day: "2026-10-02", stop: "balanced", split: { ...SKR_ONLY, SKR: 90, hSOL: 10 }, modelAnswer: { SKR: 90 }, why: "w", fallback: null, callId: 7, venuePick: null });
    expect((await repo.getSplitDay("2026-10-02", "balanced"))?.split.hSOL).toBe(10);
    expect((await repo.latestSplitDay("balanced"))?.day).toBe("2026-10-02");
    expect((await repo.latestSplitDay("balanced", "2026-10-02"))?.day).toBe("2026-10-01");
    expect(await repo.latestSplitDay("bold")).toBeNull();
  });

  it("legs keep the USDC fee and the rate at planting; watcher calls may have no user and return an id", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: "W", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
    const p = await repo.insertPlanting({ userPubkey: "U", walletPubkey: "W", signature: "s", usdcPulledCents: 203, networkFeeCents: 3, status: "sent", aiLine: null },
      [{ asset: "hSOL", usdcInCents: 200, amountOutRaw: 14_000_000n, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: 1.1889, venue: null }]);
    const [leg] = await repo.plantingLegs(p.id);
    expect(leg.feeCents).toBe(1);
    expect(leg.rateAtPlanting).toBe(1.1889);
    const id = await repo.addWatcherCall({ userPubkey: null, kind: "split", inputTokens: 500, outputTokens: 80, costMicrocents: 90_000 });
    expect(typeof id).toBe("number");
    expect((await repo.listWatcherCalls())[0].userPubkey).toBeNull();
  });

  it("listEvents returns the user's events of the kinds asked, newest first, capped", async () => {
    const repo = new MemoryRepo();
    await repo.addEvent({ userPubkey: "U", walletPubkey: null, kind: "split_changed", detail: { n: 1 } });
    await repo.addEvent({ userPubkey: "U", walletPubkey: "W", kind: "pull_failed", detail: null });
    await repo.addEvent({ userPubkey: "U", walletPubkey: null, kind: "split_undone", detail: { n: 2 } });
    await repo.addEvent({ userPubkey: "V", walletPubkey: null, kind: "split_changed", detail: { n: 3 } });
    const rows = await repo.listEvents("U", ["split_changed", "split_undone"], 10);
    expect(rows.map((e) => e.kind)).toEqual(["split_undone", "split_changed"]);
    expect((await repo.listEvents("U", ["split_changed", "split_undone"], 1)).length).toBe(1);
  });
});

import type { VenueDayRow } from "@/db/types";

describe("0008: venues, carry, moves, links, terms (memory repo)", () => {
  const vd = (day: string, venue: VenueDayRow["venue"], supplyPct: number): VenueDayRow => ({
    day, venue, asset: "USDC_LEND", supplyPct, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: 1.2038,
    avg7Pct: supplyPct, daysMeasured: 1, eligible: true, verdict: null, reason: null, served: null, ok: true,
  });

  it("venue days upsert on (day, venue, asset); history is oldest first from a day on", async () => {
    const repo = new MemoryRepo();
    await repo.putVenueDay(vd("2026-10-04", "kamino_klend", 4.4));
    await repo.putVenueDay(vd("2026-10-05", "kamino_klend", 4.5));
    await repo.putVenueDay({ ...vd("2026-10-05", "kamino_klend", 4.6), verdict: "avoid", reason: "near_full" });
    await repo.putVenueDay(vd("2026-10-05", "jupiter_lend", 4.2));
    expect((await repo.listVenueDays("2026-10-05")).length).toBe(2);
    expect((await repo.listVenueHistory("kamino_klend", "USDC_LEND", "2026-10-01")).map((r) => r.supplyPct)).toEqual([4.4, 4.6]);
    expect((await repo.listVenueDays("2026-10-05")).find((r) => r.venue === "kamino_klend")!.reason).toBe("near_full");
  });

  it("found venues: newest first, limited", async () => {
    const repo = new MemoryRepo();
    await repo.putFoundVenues([{ day: "2026-10-04", poolId: "a", project: "kamino-lend", symbol: "SOL", asset: "SOL", apyBasePct: 5.6, tvlUsd: 2.5e7, note: null }]);
    await repo.putFoundVenues([{ day: "2026-10-05", poolId: "b", project: "credix", symbol: "USDC", asset: "USDC", apyBasePct: 0.07, tvlUsd: 1.3e7, note: "x" }]);
    expect((await repo.listFoundVenues("2026-10-01", 1)).map((r) => r.poolId)).toEqual(["b"]);
  });

  it("carry per user per kind: surplus of confirmed plantings minus carry of sent and confirmed ones; a failed planting gives its carry back", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: "W", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
    const base = { userPubkey: "U", walletPubkey: "W", usdcPulledCents: 203, networkFeeCents: 3, aiLine: null };
    const a = await repo.insertPlanting({ ...base, signature: "a", status: "sent" }, []);
    await repo.setPlantingStatus(a.id, "confirmed");
    await repo.setPlantingSurplus(a.id, "WSOL", 500n);
    await repo.setPlantingSurplus(a.id, "WSOL", 900n);           // written once
    expect(await repo.carryCreditRaw("U", "WSOL")).toBe(500n);
    expect(await repo.carryCreditRaw("U", "USDC")).toBe(0n);
    const b = await repo.insertPlanting({ ...base, signature: "b", status: "sent", carryIn: { WSOL: 500n } }, []);
    expect(await repo.carryCreditRaw("U", "WSOL")).toBe(0n);
    await repo.setPlantingStatus(b.id, "failed");
    expect(await repo.carryCreditRaw("U", "WSOL")).toBe(500n);
    expect(await repo.carryCreditRaw("U", "SKR")).toBe(await repo.skrCreditRaw("U"));
  });

  it("move proposals: at most one open per user; status closes it", async () => {
    const repo = new MemoryRepo();
    const p = { userPubkey: "U", asset: "USDC_LEND" as const, fromVenue: "jupiter_lend" as const, toVenue: "kamino_klend" as const, receiptRaw: 9_000_000n, valueUsd: 1000, fromAvg7Pct: 4.19, toAvg7Pct: 4.43, gain30dUsd: 0.1973, costUsd: 0.01 };
    const first = await repo.insertMoveProposal(p);
    expect(first?.status).toBe("open");
    expect(await repo.insertMoveProposal(p)).toBeNull();
    expect((await repo.openMoveProposal("U"))?.id).toBe(first!.id);
    expect(await repo.storeMoveSignatures(first!.id, { redeem: "r", deposit: "d" })).toBe(true);
    expect(await repo.transitionMoveProposal(first!.id, "open", "done")).toBe(true);
    const done = await repo.getMoveProposal(first!.id);
    expect(done).toMatchObject({ status: "done", redeemSignature: "r", depositSignature: "d" });
    expect(done!.closedAt).not.toBeNull();
    expect(await repo.openMoveProposal("U")).toBeNull();
  });

  it("move proposals: every write is a compare-and-set (C-I2): a stale status, an in-flight card, a stored signature all refuse", async () => {
    const repo = new MemoryRepo();
    const p = { userPubkey: "U", asset: "USDC_LEND" as const, fromVenue: "jupiter_lend" as const, toVenue: "kamino_klend" as const, receiptRaw: 9_000_000n, valueUsd: 1000, fromAvg7Pct: 4.19, toAvg7Pct: 4.43, gain30dUsd: 0.1973, costUsd: 0.01 };
    const card = (await repo.insertMoveProposal(p))!;
    // signatures: only onto an open card with none; never overwritten
    expect(await repo.storeMoveSignatures(card.id, { redeem: "R1", deposit: "D1" })).toBe(true);
    expect(await repo.storeMoveSignatures(card.id, { redeem: "R2", deposit: "D2" })).toBe(false);
    expect(await repo.getMoveProposal(card.id)).toMatchObject({ redeemSignature: "R1", depositSignature: "D1" });
    // in flight: no dismiss, no expiry
    expect(await repo.transitionMoveProposal(card.id, "open", "dismissed", { notInFlight: true })).toBe(false);
    expect(await repo.transitionMoveProposal(card.id, "open", "expired", { notInFlight: true })).toBe(false);
    expect((await repo.getMoveProposal(card.id))?.status).toBe("open");
    // clear only the stored redeem
    expect(await repo.clearMoveSignatures(card.id, "R2")).toBe(false);
    expect(await repo.clearMoveSignatures(card.id, "R1")).toBe(true);
    expect(await repo.getMoveProposal(card.id)).toMatchObject({ redeemSignature: null, depositSignature: null });
    // status CAS: the second writer loses and nothing changes
    expect(await repo.transitionMoveProposal(card.id, "open", "expired", { notInFlight: true })).toBe(true);
    expect(await repo.transitionMoveProposal(card.id, "open", "dismissed")).toBe(false);
    expect(await repo.storeMoveSignatures(card.id, { redeem: "R3", deposit: "D3" })).toBe(false);
    expect(await repo.getMoveProposal(card.id)).toMatchObject({ status: "expired", redeemSignature: null });
  });

  it("links and terms", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: "W", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
    expect((await repo.getWallet("W"))!.linkModel).toBe("puller");
    await repo.setWalletLink("W", { delegationPda: "D2", linkModel: "leash" });
    expect(await repo.getWallet("W")).toMatchObject({ delegationPda: "D2", linkModel: "leash" });
    await repo.setTermsAccepted("U", "2026-10-06", new Date("2026-10-06T10:00:00Z"));
    expect(await repo.getUser("U")).toMatchObject({ termsVersion: "2026-10-06" });
  });
});

describe("insertPlanting: the leg-venue guard and the half-write compensation (AMEND 10-04 s20, T3 review I3)", () => {
  const base = { userPubkey: "U", walletPubkey: "W", usdcPulledCents: 203, networkFeeCents: 3, status: "sent" as const, aiLine: null };
  const leg = (asset: Asset, venue: AutoVenue | null) => ({ asset, venue, usdcInCents: 200, amountOutRaw: 1n, staked: false, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: null });

  it("a lending leg without a venue, or a coin leg with one, throws before anything is written", async () => {
    const r = await withWallet();
    await expect(r.insertPlanting({ ...base, signature: "a", skrCarryInRaw: 300n, carryIn: { USDC: 500n } }, [leg("USDC_LEND", null)])).rejects.toThrow(/venue/);
    await expect(r.insertPlanting({ ...base, signature: "b" }, [leg("hSOL", "kamino_klend")])).rejects.toThrow(/venue/);
    expect(r.plantings.size).toBe(0);                            // the planting count is unchanged after the throw
    expect(await r.skrCreditRaw("U")).toBe(0n);
    expect(await r.carryCreditRaw("U", "USDC")).toBe(0n);
    // Positive controls: a lending leg with its venue, and a retired coin leg (JitoSOL rows stay readable) without one.
    await r.insertPlanting({ ...base, signature: "c" }, [leg("USDC_LEND", "jupiter_lend")]);
    await r.insertPlanting({ ...base, signature: "d" }, [leg("JitoSOL", null)]);
    expect(r.plantings.size).toBe(2);
  });

  it("a legs or carry insert error after the planting row exists marks the planting failed and rethrows; the carry comes back", async () => {
    for (const fault of ["legs", "carry"] as const) {
      const r = await withWallet();
      r.insertFault = fault;
      await expect(r.insertPlanting({ ...base, signature: `s-${fault}`, skrCarryInRaw: 300n, carryIn: { USDC: 500n } }, [leg("USDC_LEND", "kamino_klend")])).rejects.toThrow(/insert failed/);
      expect([...r.plantings.values()].map((p) => p.status)).toEqual(["failed"]);
      expect(await r.skrCreditRaw("U")).toBe(0n);                // a `sent` orphan would hold -300n
      expect(await r.carryCreditRaw("U", "USDC")).toBe(0n);
      expect(r.insertFault).toBeNull();                          // one-shot seam
    }
  });
});
