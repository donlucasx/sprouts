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
  const get = async () => (await me(new Request("http://x/api/me", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }))).json();

  it("positions, the aggregated holding, the two-line sign, terms and picks", async () => {
    const body = await get();
    expect(body.positions).toEqual([expect.objectContaining({ asset: "USDC_LEND", venue: "kamino_klend", receiptMint: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D", receiptRaw: "1661072", underlyingRaw: "2001591", ratePct: 4.43, avg7Pct: 4.4, putInCents: 200, poolFull: false })]);
    expect(body.holdings.find((h: { asset: string }) => h.asset === "USDC_LEND")).toMatchObject({ heldRaw: "2001591", putInCents: 200 });
    expect(body.lendSigns).toEqual({ USDC_LEND: { line1: "USDC", line2: "Kamino 4.4%", venue: "kamino_klend", ratePct: 4.43 }, SOL_LEND: null });
    expect(body.terms).toEqual({ currentVersion: "2026-10-06", acceptedVersion: null });
    expect(body.manager).toMatchObject({ picks: { USDC_LEND: "kamino_klend", SOL_LEND: null }, legsEnabled: null });
    expect(body.wallets).toEqual([{ pubkey: "W", status: "active", dailyCapCents: 500, linkModel: "puller" }]);
    expect(body.moveProposal).toBeNull();
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
  it("legsEnabled: the leash config's enabled legs once a wallet is leashed; [] when the config cannot be read", async () => {
    await repo.setWalletLink("W", { delegationPda: "D5", linkModel: "leash" });
    expect((await get()).manager.legsEnabled).toEqual([]);
    const legs = LEG_BYTES.map((b) => ({ enabled: b === 0 || b === 2 || b === 3, reader: 0, feeBps: 0, tolBps: 0 })) as unknown as LeashConfig["legs"];
    vi.mocked(readLeashConfig).mockResolvedValueOnce({ legs } as LeashConfig);
    expect((await get()).manager.legsEnabled).toEqual(["SKR", "USDC_LEND"]);
  });
  it("the open move proposal, as contracts 5.4", async () => {
    await repo.insertMoveProposal({ userPubkey: U, asset: "USDC_LEND", fromVenue: "kamino_klend", toVenue: "jupiter_lend", receiptRaw: 1_661_072n, valueUsd: 2, fromAvg7Pct: 4, toAvg7Pct: 9, gain30dUsd: 0.5, costUsd: 0.01 });
    const { moveProposal } = await get();
    expect(Object.keys(moveProposal).sort()).toEqual(["asset", "costUsd", "from", "fromAvg7Pct", "gain30dUsd", "id", "receiptRaw", "to", "toAvg7Pct", "ts", "valueUsd"].sort());
    expect(moveProposal).toMatchObject({ asset: "USDC_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: "1661072", valueUsd: 2 });
  });
});
