import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { SKR_ONLY } from "@/domain/coins";
import type { CoinDayRow } from "@/db/types";

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
      [{ asset: "SKR", usdcInCents: 100, amountOutRaw: 4_800_000n, staked: true, feeAmountRaw: 24_000n, feeCents: 0, rateAtPlanting: null }],
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

    await repo.putSplitDay({ day: "2026-10-01", stop: "balanced", split: SKR_ONLY, modelAnswer: null, why: null, fallback: "no data", callId: null });
    await repo.putSplitDay({ day: "2026-10-02", stop: "balanced", split: { ...SKR_ONLY, SKR: 90, hSOL: 10 }, modelAnswer: { SKR: 90 }, why: "w", fallback: null, callId: 7 });
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
      [{ asset: "hSOL", usdcInCents: 200, amountOutRaw: 14_000_000n, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: 1.1889 }]);
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
