import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { dayOf } from "@/domain/day";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/staking", () => ({ readPosition: vi.fn(async () => ({ shares: 0n, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: null })), sharePrice: vi.fn(async () => 1_146_000_000n) }));
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));
vi.mock("@/lib/store", () => ({ storeBalanceRaw: vi.fn(async () => 0n), storeRedeemRate: vi.fn(async () => 1_048_350_000n) }));
vi.mock("@/lib/holdings", async (orig) => ({ ...(await orig<object>()), readHoldings: vi.fn(async () => ({})), readLendingPositions: vi.fn(async () => [{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 1_661_072n }]) }));
vi.mock("@/lib/subscriptions", () => ({ readDelegation: vi.fn(async () => ({ exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n })) }));
vi.mock("@/lib/leash", async (orig) => ({ ...(await orig<object>()), readLeashConfig: vi.fn(async () => { throw new Error("not deployed"); }) }));

import { GET as me } from "@/app/api/me/route";
import { clearSharedReads } from "@/lib/memo";
import { readLeashConfig, LEG_BYTES, type LeashConfig } from "@/lib/leash";
import { readHoldings, readLendingPositions } from "@/lib/holdings";

describe("GET /api/me, lending (contracts 5.2)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
    repo = new MemoryRepo();
    setRepoForTests(repo);
    const day = dayOf(new Date());
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: "W", userPubkey: U, delegationPda: "D", dailyCapCents: 500 });
    await repo.saveRules(U, { managed: true, stop: "balanced" });
    await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", signature: "s1", usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed", aiLine: null },
      [{ asset: "USDC_LEND", venue: "kamino_klend", usdcInCents: 200, amountOutRaw: 1_661_072n, staked: false, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: 1.2038 }]);
    await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", signature: "s0", usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed", aiLine: null, ts: new Date("2026-09-01T00:00:00Z") },
      [{ asset: "JitoSOL", venue: null, usdcInCents: 200, amountOutRaw: 1n, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: null }]);
    await repo.putVenueDay({ day, venue: "kamino_klend", asset: "USDC_LEND", supplyPct: 4.43, rewardsPct: 0, utilizationPct: 91, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: 1.205, avg7Pct: 4.4, daysMeasured: 2, eligible: true, verdict: "ok", reason: null, served: null, ok: true });
    await repo.putCoinDay({ day, asset: "USDC_LEND", rate: null, ratePrev: null, ratePrevDays: null, priceUsd: 1, liquidityUsd: null, priceChange24h: null, tradeable: true, lastUpdateEpoch: null, ok: true });
    await repo.putSplitDay({ day, stop: "balanced", split: { SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 }, modelAnswer: null, why: "w", fallback: null, callId: null, venuePick: { USDC_LEND: "kamino_klend", SOL_LEND: null } });
  });
  // These tests change venue rows and the leash config between calls: each call reads past the shared-read memo's TTL.
  const get = async () => { clearSharedReads(); return (await me(new Request("http://x/api/me", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }))).json() };

  it("positions, the aggregated holding, the two-line sign, terms and picks", async () => {
    const body = await get();
    expect(body.positions).toEqual([expect.objectContaining({ asset: "USDC_LEND", venue: "kamino_klend", receiptMint: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D", receiptRaw: "1661072", underlyingRaw: "2001591", ratePct: 4.43, avg7Pct: 4.4, putInCents: 200, poolFull: false })]);
    expect(body.holdings.find((h: { asset: string }) => h.asset === "USDC_LEND")).toMatchObject({ heldRaw: "2001591", putInCents: 200 });
    expect(body.lendSigns).toEqual({ USDC_LEND: { line1: "USDC", line2: "Kamino 4.4%", venue: "kamino_klend", ratePct: 4.43 }, SOL_LEND: null });
    expect(body.terms).toEqual({ currentVersion: "2026-10-07", acceptedVersion: null });
    expect(body.manager).toMatchObject({ picks: { USDC_LEND: "kamino_klend", SOL_LEND: null }, legsEnabled: null });
    expect(body.wallets).toEqual([{ pubkey: "W", status: "active", dailyCapCents: 500, linkModel: "puller" }]);
    expect(body.moveProposal).toBeNull();
  });
  it("K-I5: a user over the 60% venue cap is shown where the money really goes: picks, the routing sentence and the sign", async () => {
    const day = dayOf(new Date());
    await repo.putVenueDay({ day, venue: "jupiter_lend", asset: "USDC_LEND", supplyPct: 4.19, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: 1.06, avg7Pct: 4.2, daysMeasured: 2, eligible: true, verdict: "ok", reason: null, served: null, ok: true });
    // $120 at Kamino (100% of this user's lending, over $20): the run's pickVenue sends the next USDC to Jupiter.
    vi.mocked(readLendingPositions).mockResolvedValueOnce([{ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: 99_585_062n }]);
    const body = await get();
    expect(body.manager.picks).toEqual({ USDC_LEND: "jupiter_lend", SOL_LEND: null });
    expect(body.manager.why).toBe("Your USDC goes to Jupiter at 4.2%: Kamino already holds 60% of your lending. No lending venue passed today's checks; your SOL share goes to the next leg.");
    expect(body.lendSigns.USDC_LEND).toMatchObject({ venue: "jupiter_lend", line2: "Jupiter 4.2%" });
    // Under the cap ($2 at Kamino): the stop's pick and its stored sentence stand.
    const small = await get();
    expect(small.manager).toMatchObject({ picks: { USDC_LEND: "kamino_klend", SOL_LEND: null }, why: "w" });
  });

  it("a position carries exactly the contracts 5.2 LendingPosition keys (no earnedUnderlyingRaw), bigints as strings", async () => {
    const [p] = (await get()).positions;
    expect(Object.keys(p).sort()).toEqual(["asset", "avg7Pct", "earnedUsd", "poolFull", "putInCents", "ratePct", "receiptMint", "receiptRaw", "underlyingRaw", "valueUsd", "venue", "withdrawableUsd"].sort());
    expect(typeof p.receiptRaw).toBe("string");
    expect(typeof p.underlyingRaw).toBe("string");
  });
  it("planting rows name the venue and give receipt and underlying units; retired legs are omitted (R281)", async () => {
    const body = await get();
    expect(body.history.plantings).toEqual([expect.objectContaining({ asset: "USDC_LEND", venue: "kamino_klend", amountOutRaw: "1661072", receiptOutRaw: "1661072", underlyingOutRaw: "1999598" })]);   // 1_661_072 x 1.2038
    expect(body.lastReceipt).toMatchObject({ asset: "USDC_LEND", venue: "kamino_klend", underlyingOutRaw: "1999598" });
  });
  it("a retired coin's balance never reaches holdings (R281, R321)", async () => {
    vi.mocked(readHoldings).mockResolvedValueOnce({ JitoSOL: 5_000_000_000n, hSOL: 1_000_000_000n });
    const body = await get();
    expect(body.holdings.map((h: { asset: string }) => h.asset)).toEqual(["USDC_LEND", "hSOL"]);
  });
  it("a failed receipt read is no positions, never a 500", async () => {
    vi.mocked(readLendingPositions).mockRejectedValueOnce(new Error("rpc down"));
    const body = await get();
    expect(body.positions).toEqual([]);
    expect(body.holdings.find((h: { asset: string }) => h.asset === "USDC_LEND")).toBeUndefined();
    // R360: the app must not read this empty list as a zero (the garden would drop the plant for good)
    expect(body.positionsRead).toBe("failed");
    expect((await get()).positionsRead).toBe("ok");
  });
  it("relink.needed only once LEASH_LIVE=1, listing this user's puller wallets and how each re-links", async () => {
    expect((await get()).relink).toEqual({ needed: false, wallets: [{ pubkey: "W", via: "link_page" }] });
    process.env.LEASH_LIVE = "1";
    try { expect((await get()).relink.needed).toBe(true); } finally { delete process.env.LEASH_LIVE; }
  });
  it("relink: the Seed Vault wallet re-links in the app; a leashed or revoked wallet is never listed; none left, not needed", async () => {
    await repo.addWallet({ pubkey: U, userPubkey: U, delegationPda: "D2", dailyCapCents: 500 });
    await repo.addWallet({ pubkey: "L", userPubkey: U, delegationPda: "D3", dailyCapCents: 500, linkModel: "leash" });
    await repo.addWallet({ pubkey: "R", userPubkey: U, delegationPda: "D4", dailyCapCents: 500 });
    await repo.setWalletStatus("R", "revoked");
    process.env.LEASH_LIVE = "1";
    try {
      const body = await get();
      expect(body.relink.needed).toBe(true);
      expect([...body.relink.wallets].sort((a: { pubkey: string }, b: { pubkey: string }) => a.pubkey.localeCompare(b.pubkey))).toEqual([{ pubkey: U, via: "app" }, { pubkey: "W", via: "link_page" }].sort((a, b) => a.pubkey.localeCompare(b.pubkey)));
      expect(body.wallets.find((w: { pubkey: string }) => w.pubkey === "L").linkModel).toBe("leash");
      await repo.setWalletLink("W", { delegationPda: "D5", linkModel: "leash" });
      await repo.setWalletLink(U, { delegationPda: "D6", linkModel: "leash" });
      expect((await get()).relink).toEqual({ needed: false, wallets: [] });
    } finally { delete process.env.LEASH_LIVE; }
  });
  it("residual O2: a leashed user is shown a venue the leash allows (the run's allowed set), and the sentence says why", async () => {
    const day = dayOf(new Date());
    await repo.putVenueDay({ day, venue: "jupiter_lend", asset: "USDC_LEND", supplyPct: 4.19, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: 1.06, avg7Pct: 4.2, daysMeasured: 2, eligible: true, verdict: "ok", reason: null, served: null, ok: true });
    await repo.setWalletLink("W", { delegationPda: "D5", linkModel: "leash" });
    // Day 1 without K-Lend: SKR (0) and USDC on Jupiter Lend (3) only. The stop picked Kamino; the leash run plants on Jupiter.
    const legs = LEG_BYTES.map((b) => ({ enabled: b === 0 || b === 3, reader: 0, feeBps: 0, tolBps: 0 })) as unknown as LeashConfig["legs"];
    vi.mocked(readLeashConfig).mockResolvedValueOnce({ legs } as LeashConfig);
    const body = await get();
    expect(body.manager.picks).toEqual({ USDC_LEND: "jupiter_lend", SOL_LEND: null });
    // R344: the leash adds no sentence of its own; the plain one an unleashed wallet gets when its pick is simply the venue it plants to.
    expect(body.manager.why).toBe("Your USDC goes to Jupiter at 4.2%. No lending venue passed today's checks; your SOL share goes to the next leg.");
    expect(body.manager.why).not.toMatch(/leash/i);
    expect(body.lendSigns.USDC_LEND).toMatchObject({ venue: "jupiter_lend" });
    // Kamino's leash leg enabled: the stop's pick and its stored sentence stand.
    const both = LEG_BYTES.map((b) => ({ enabled: b === 0 || b === 2 || b === 3, reader: 0, feeBps: 0, tolBps: 0 })) as unknown as LeashConfig["legs"];
    vi.mocked(readLeashConfig).mockResolvedValueOnce({ legs: both } as LeashConfig);
    expect((await get()).manager).toMatchObject({ picks: { USDC_LEND: "kamino_klend", SOL_LEND: null }, why: "w" });
    // R344: no allowed venue qualifies for USDC: no lending sentence at all (never the leash words, never a stale name of the disallowed pick).
    await repo.putVenueDay({ day, venue: "jupiter_lend", asset: "USDC_LEND", supplyPct: 4.19, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: 1.06, avg7Pct: 4.2, daysMeasured: 2, eligible: false, verdict: "avoid", reason: "near_full", served: null, ok: true });
    vi.mocked(readLeashConfig).mockResolvedValueOnce({ legs } as LeashConfig);
    const none = (await get()).manager;
    expect(none.picks.USDC_LEND).toBeNull();
    // (the SOL sentence is the unchanged non-leash one: SOL's own pick is null in the stop's row.)
    expect(none.why ?? "").not.toMatch(/leash|Kamino|Jupiter|USDC/i);
  });
  it("R344: for a leashed wallet, a leg the leash did not move compares only against venues the leash allows (no \"vs Kamino\" for SOL when its leg is off)", async () => {
    const day = dayOf(new Date());
    const row = (venue: "jupiter_lend" | "kamino_klend", avg7Pct: number) => ({ day, venue, asset: "SOL_LEND" as const, supplyPct: avg7Pct, rewardsPct: 0, utilizationPct: 80, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: 1.06, avg7Pct, daysMeasured: 2, eligible: true, verdict: "ok" as const, reason: null, served: null, ok: true });
    await repo.putVenueDay(row("jupiter_lend", 5)); await repo.putVenueDay(row("kamino_klend", 4));
    await repo.putVenueDay({ day, venue: "jupiter_lend", asset: "USDC_LEND", supplyPct: 4.19, rewardsPct: 0, utilizationPct: 90, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: 1.06, avg7Pct: 4.2, daysMeasured: 2, eligible: true, verdict: "ok", reason: null, served: null, ok: true });
    await repo.putSplitDay({ day, stop: "balanced", split: { SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 }, modelAnswer: null, why: "w", fallback: null, callId: null, venuePick: { USDC_LEND: "kamino_klend", SOL_LEND: "jupiter_lend" } });
    await repo.setWalletLink("W", { delegationPda: "D5", linkModel: "leash" });
    // Legs 0, 3 (USDC on Jupiter Lend) and 5 (SOL on Jupiter Lend): USDC moves Kamino -> Jupiter; SOL stays on Jupiter and Kamino SOL (leg 4) is not allowed.
    const legs = LEG_BYTES.map((b) => ({ enabled: b === 0 || b === 3 || b === 5, reader: 0, feeBps: 0, tolBps: 0 })) as unknown as LeashConfig["legs"];
    vi.mocked(readLeashConfig).mockResolvedValueOnce({ legs } as LeashConfig);
    const why = (await get()).manager.why as string;
    expect(why).toBe("Your USDC goes to Jupiter at 4.2%. Your SOL goes to Jupiter at 5.0%.");
    expect(why).not.toMatch(/Kamino|vs/);
  });
  it("legsEnabled: the leash config's enabled legs once a wallet is leashed; [] when the config cannot be read", async () => {
    await repo.setWalletLink("W", { delegationPda: "D5", linkModel: "leash" });
    expect((await get()).manager.legsEnabled).toEqual([]);
    const legs = LEG_BYTES.map((b) => ({ enabled: b === 0 || b === 2 || b === 3, reader: 0, feeBps: 0, tolBps: 0 })) as unknown as LeashConfig["legs"];
    vi.mocked(readLeashConfig).mockResolvedValueOnce({ legs } as LeashConfig);
    expect((await get()).manager.legsEnabled).toEqual(["SKR", "USDC_LEND"]);
  });
  it("a done move keeps the position's basis and earned so far at the new venue (legs are matched by (asset, venue))", async () => {
    const before = (await get()).positions[0];
    expect(before.earnedUsd).toBeGreaterThan(0);
    await repo.putVenueDay({ day: dayOf(new Date()), venue: "jupiter_lend", asset: "USDC_LEND", supplyPct: 4.6, rewardsPct: 0, utilizationPct: 91, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: 1.1, avg7Pct: 4.6, daysMeasured: 2, eligible: true, verdict: "ok", reason: null, served: null, ok: true });
    const m = (await repo.insertMoveProposal({ userPubkey: U, asset: "USDC_LEND", fromVenue: "kamino_klend", toVenue: "jupiter_lend", receiptRaw: 1_661_072n, valueUsd: 2, fromAvg7Pct: 4, toAvg7Pct: 9, gain30dUsd: 0.5, costUsd: 0.01 }))!;
    await repo.storeMoveSignatures(m.id, { redeem: "R", deposit: "D" }); await repo.transitionMoveProposal(m.id, "open", "done");
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "move_built", detail: { id: m.id, asset: "USDC_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: "1661072", sourceReceiptRaw: "1661072", depositRaw: "1999589", toReceiptRaw: "1817808", fromRate: 1.205, toRate: 1.1 } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "move_done", detail: { id: m.id, asset: "USDC_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: "1661072", status: "done" } });
    vi.mocked(readLendingPositions).mockResolvedValueOnce([{ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: 1_817_808n }]);
    const after = (await get()).positions[0];
    expect(after).toMatchObject({ venue: "jupiter_lend", putInCents: before.putInCents });
    expect(after.earnedUsd).toBeCloseTo(before.earnedUsd, 9);
  });
  it("the open move proposal, as contracts 5.4, plus inFlight (C-I2 4): true once its redeem signature is stored", async () => {
    const m = (await repo.insertMoveProposal({ userPubkey: U, asset: "USDC_LEND", fromVenue: "kamino_klend", toVenue: "jupiter_lend", receiptRaw: 1_661_072n, valueUsd: 2, fromAvg7Pct: 4, toAvg7Pct: 9, gain30dUsd: 0.5, costUsd: 0.01 }))!;
    const { moveProposal } = await get();
    expect(Object.keys(moveProposal).sort()).toEqual(["asset", "costUsd", "from", "fromAvg7Pct", "gain30dUsd", "id", "inFlight", "receiptRaw", "to", "toAvg7Pct", "ts", "valueUsd"].sort());
    expect(moveProposal).toMatchObject({ asset: "USDC_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: "1661072", valueUsd: 2, inFlight: false });
    await repo.storeMoveSignatures(m.id, { redeem: "R", deposit: "D" });
    expect((await get()).moveProposal).toMatchObject({ id: m.id, inFlight: true });
  });
});
