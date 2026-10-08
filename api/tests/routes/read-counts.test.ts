import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { addDays, dayOf } from "@/domain/day";
import type { LiveAsset } from "@/domain/coins";

// Perf (10-08): /api/activity and /api/me read the ledger in batches and the shared reads once per TTL. These tests count the calls.
const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/staking", () => ({ readPosition: vi.fn(async () => ({ shares: 0n, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: null })), sharePrice: vi.fn(async () => 1_146_000_000n) }));
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));
vi.mock("@/lib/store", () => ({ storeBalanceRaw: vi.fn(async () => 1n), storeRedeemRate: vi.fn(async () => 1_048_350_000n) }));
vi.mock("@/lib/holdings", async (orig) => ({ ...(await orig<object>()), readHoldings: vi.fn(async () => ({})), readLendingPositions: vi.fn(async () => []) }));
vi.mock("@/lib/subscriptions", () => ({ readDelegation: vi.fn(async () => ({ exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n })) }));
vi.mock("@/lib/leash", async (orig) => ({ ...(await orig<object>()), readLeashConfig: vi.fn(async () => { throw new Error("not deployed"); }) }));

import { GET as me } from "@/app/api/me/route";
import { GET as activity } from "@/app/api/activity/route";
import { readPosition, sharePrice } from "@/lib/staking";
import { priceUsd } from "@/lib/jupiter";
import { storeBalanceRaw, storeRedeemRate } from "@/lib/store";
import { readHoldings, readLendingPositions } from "@/lib/holdings";
import { readDelegation } from "@/lib/subscriptions";

/** Counts every repo method call (the MemoryRepo stands in for Supabase: one call is one round trip there). */
function counting(repo: MemoryRepo) {
  const calls: Record<string, number> = {};
  const proxy = new Proxy(repo, { get(t, k, r) { const v = Reflect.get(t, k, r); if (typeof v !== "function") return v; return (...a: unknown[]) => { calls[String(k)] = (calls[String(k)] ?? 0) + 1; return v.apply(t, a); }; } });
  return { proxy, calls, total: () => Object.values(calls).reduce((s, n) => s + n, 0), reset: () => { for (const k of Object.keys(calls)) delete calls[k]; } };
}
const chainCalls = () => [readPosition, sharePrice, storeBalanceRaw, storeRedeemRate, readHoldings, readLendingPositions, readDelegation].reduce((s, f) => s + vi.mocked(f).mock.calls.length, 0)
  + 2 * vi.mocked(readPosition).mock.calls.length - vi.mocked(readPosition).mock.calls.length; // readPosition is two RPC reads

describe("read counts per request (perf 10-08)", () => {
  let c: ReturnType<typeof counting>;
  const auth = async () => ({ headers: { authorization: `Bearer ${await issueSession(U, "M")}` } });
  beforeEach(async () => {
    process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
    vi.clearAllMocks();
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: "W", userPubkey: U, delegationPda: "D", dailyCapCents: 500 });
    await repo.addWallet({ pubkey: "W2", userPubkey: U, delegationPda: "D2", dailyCapCents: 500 });
    // 20 confirmed plantings over 5 days, alternating hSOL and cbBTC legs: 10 distinct (day, coin) prices.
    const today = dayOf(new Date());
    for (let i = 0; i < 20; i++) {
      const day = addDays(today, -(i % 5));
      const asset: LiveAsset = i % 2 ? "hSOL" : "cbBTC";
      await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", signature: `s${i}`, usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed", aiLine: null, ts: new Date(`${day}T12:00:00Z`) },
        [{ asset, venue: null, usdcInCents: 200, amountOutRaw: 1_000n + BigInt(i), staked: false, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: null }]);
    }
    c = counting(repo);
    setRepoForTests(c.proxy as unknown as MemoryRepo);
  });

  it("/api/activity: legs and day prices in one read each, whatever the number of plantings", async () => {
    const res = await activity(new Request("http://x/api/activity", await auth()));
    expect(res.status).toBe(200);
    expect((await res.json()).plantings).toHaveLength(20);
    console.log(`/api/activity repo calls: ${c.total()} ${JSON.stringify(c.calls)}`);
    expect(c.calls.plantingLegs ?? 0).toBe(0);
    expect(c.calls.plantingLegsFor).toBe(1);
    expect(c.calls.getCoinDay ?? 0).toBe(0);
    expect(c.calls.getCoinDaysFor).toBe(1);
    expect(c.calls.listEvents).toBe(2);
  });

  it("/api/me: legs in one read; the shared reads (share price, prices, snapshot rows) once per TTL, the user's chain reads every call", async () => {
    expect((await me(new Request("http://x/api/me", await auth()))).status).toBe(200);
    const first = { repo: c.total(), chain: chainCalls(), jupiter: vi.mocked(priceUsd).mock.calls.length };
    console.log(`/api/me 1st call: repo ${first.repo} ${JSON.stringify(c.calls)}, chain RPC ${first.chain}, Jupiter ${first.jupiter}`);
    expect(c.calls.plantingLegs ?? 0).toBe(0);
    expect(c.calls.plantingLegsFor).toBe(1);
    c.reset(); vi.clearAllMocks();
    expect((await me(new Request("http://x/api/me", await auth()))).status).toBe(200);
    console.log(`/api/me 2nd call (memo warm): repo ${c.total()} ${JSON.stringify(c.calls)}, chain RPC ${chainCalls()}, Jupiter ${vi.mocked(priceUsd).mock.calls.length}`);
    expect(vi.mocked(sharePrice)).not.toHaveBeenCalled();
    expect(vi.mocked(priceUsd)).not.toHaveBeenCalled();
    expect(vi.mocked(storeRedeemRate)).not.toHaveBeenCalled();
    expect(c.calls.listCoinDays ?? 0).toBe(0);
    expect(c.calls.listVenueHistory ?? 0).toBe(0);
    // per-user chain reads stay fresh
    expect(vi.mocked(readPosition)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readHoldings)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(readLendingPositions)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(storeBalanceRaw)).toHaveBeenCalledTimes(1);
  });

  it("the memo never keeps a failed read or a null price", async () => {
    const { cached } = await import("@/lib/memo");
    let n = 0;
    await expect(cached("t-fail", async () => { n++; throw new Error("x"); })).rejects.toThrow();
    await expect(cached("t-fail", async () => { n++; return 1; })).resolves.toBe(1);
    await cached("t-null", async () => { n++; return null; }, (v) => v !== null);
    await cached("t-null", async () => { n++; return null; }, (v) => v !== null);
    expect(await cached("t-fail", async () => { n++; return 2; })).toBe(1);
    expect(n).toBe(4);
  });
});
