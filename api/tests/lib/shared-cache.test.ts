import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 11-28 (Kimi Jupiter re-assessment fix 4): the cross-instance cache (table shared_cache, migration 0015) for the shared prices and
// the top-up's per-mint probe and token info. Hit, miss, expiry, bad entries and a failing database (fail open).
const jupPrice = vi.fn<(m: string) => Promise<number | null>>();
const quote = vi.fn();
vi.mock("@/lib/jupiter", async (orig) => ({ ...(await orig<object>()), priceUsd: (m: string) => jupPrice(m), getQuote: (...a: unknown[]) => quote(...a) }));

import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { crossCached, crossCachedWithAge, setSharedCacheForTests, settleSharedCacheWrites, PRICE_CACHE_TTL_MS, CROSS_READ_TIMEOUT_MS } from "@/lib/shared-cache";
import { sharedPriceUsd } from "@/lib/shared-reads";
import { clearSharedReads } from "@/lib/memo";
import { decodeProbedRoute, decodeTopUpToken, probeTopUpRoute } from "@/lib/topup";
import { JupiterRateLimited } from "@/lib/jupiter";
import { address } from "@solana/kit";

let repo: MemoryRepo;
beforeEach(() => { repo = new MemoryRepo(); setRepoForTests(repo); setSharedCacheForTests(true); jupPrice.mockReset(); });
afterEach(() => { setSharedCacheForTests(false); setRepoForTests(null); vi.useRealTimers(); });

describe("crossCached", () => {
  it("miss: reads, writes the entry with its life; hit: answers from the table, no read", async () => {
    const read = vi.fn(async () => 42);
    expect(await crossCachedWithAge("k", read, { ttlMs: 30_000 })).toMatchObject({ value: 42, from: "read" });
    await settleSharedCacheWrites();
    const row = await repo.getSharedCache("k");
    expect(row?.value).toEqual({ v: 42 });
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(29_000);
    const r2 = await crossCachedWithAge("k", read, { ttlMs: 30_000 });
    expect(r2).toMatchObject({ value: 42, from: "cache" });
    expect(r2.ttlLeftMs).toBeLessThanOrEqual(30_000);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("TTL: an expired entry is read again and replaced", async () => {
    await repo.putSharedCache("k", { v: 1 }, new Date(Date.now() - 1));
    expect(await crossCached("k", async () => 2, { ttlMs: 30_000 })).toBe(2);
    await settleSharedCacheWrites();
    expect((await repo.getSharedCache("k"))?.value).toEqual({ v: 2 });
  });
  it("an entry the decoder refuses is a miss; `keep` false is never written", async () => {
    await repo.putSharedCache("k", { v: "junk" }, new Date(Date.now() + 60_000));
    expect(await crossCached("k", async () => 3, { ttlMs: 30_000, decode: (x) => (typeof x === "number" ? x : undefined) })).toBe(3);
    expect(await crossCached("n", async () => null, { ttlMs: 30_000, keep: (v) => v !== null })).toBeNull();
    await settleSharedCacheWrites();
    expect(await repo.getSharedCache("n")).toBeNull();
  });
  it("fail open: a failing or slow table read, or a failing write, is a miss and the read answers", async () => {
    repo.getSharedCache = async () => { throw new Error("relation shared_cache does not exist"); };
    repo.putSharedCache = async () => { throw new Error("relation shared_cache does not exist"); };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await crossCached("k", async () => 7, { ttlMs: 30_000 })).toBe(7);
    await settleSharedCacheWrites();
    repo.getSharedCache = () => new Promise(() => {});   // hangs
    const t0 = Date.now();
    expect(await crossCached("k", async () => 8, { ttlMs: 30_000 })).toBe(8);
    expect(Date.now() - t0).toBeLessThan(CROSS_READ_TIMEOUT_MS + 200);
    err.mockRestore();
  });
});

describe("sharedPriceUsd across instances", () => {
  it("instance B answers from instance A's entry (no Jupiter call); a price lives PRICE_CACHE_TTL_MS; a null is never shared", async () => {
    expect(PRICE_CACHE_TTL_MS).toBe(45_000);
    jupPrice.mockResolvedValueOnce(0.0183);
    expect(await sharedPriceUsd("MINT1")).toBe(0.0183);
    await settleSharedCacheWrites();
    clearSharedReads();   // "another instance": an empty memo, the same table
    expect(await sharedPriceUsd("MINT1")).toBe(0.0183);
    expect(jupPrice).toHaveBeenCalledTimes(1);
    jupPrice.mockResolvedValueOnce(null);
    expect(await sharedPriceUsd("MINT2")).toBeNull();
    await settleSharedCacheWrites();
    expect(await repo.getSharedCache("price:MINT2")).toBeNull();
  });
  it("after the entry expires the next instance reads again", async () => {
    jupPrice.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await sharedPriceUsd("MINT3")).toBe(1);
    await settleSharedCacheWrites();
    const row = await repo.getSharedCache("price:MINT3");
    await repo.putSharedCache("price:MINT3", row!.value, new Date(Date.now() - 1));
    clearSharedReads();
    expect(await sharedPriceUsd("MINT3")).toBe(2);
  });
});

describe("the top-up probe and token entries", () => {
  it("a probe answer goes to JSON and back (the max as a string); a bad entry is a miss; null is 'no route'", () => {
    expect(decodeProbedRoute(JSON.parse(JSON.stringify({ max: "5012345", v47: true })))).toEqual({ max: 5_012_345n, v47: true });
    expect(decodeProbedRoute(null)).toBeNull();
    expect(decodeProbedRoute({ max: 5, v47: true })).toBeUndefined();
    expect(decodeProbedRoute({ max: "-1", v47: false })).toBeUndefined();
    expect(decodeProbedRoute({ max: "1" })).toBeUndefined();
    expect(decodeTopUpToken({ symbol: "JUP", decimals: 6, verified: true, tokenProgram: "Tokenkeg" })).toEqual({ symbol: "JUP", decimals: 6, verified: true, tokenProgram: "Tokenkeg" });
    expect(decodeTopUpToken(null)).toBeNull();
    expect(decodeTopUpToken({ symbol: "JUP" })).toBeUndefined();
  });
  it("a probe that met Jupiter's rate limit is not an answer: it rejects (kept nowhere), while a real refusal is 'no route' (null)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const mint = address("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");
    quote.mockRejectedValueOnce(new JupiterRateLimited("Jupiter quote failed: 429 x"));
    await expect(probeTopUpRoute(mint)).rejects.toBeInstanceOf(JupiterRateLimited);
    quote.mockRejectedValueOnce(new Error("Jupiter quote failed: 400 no route"));
    expect(await probeTopUpRoute(mint)).toBeNull();
    err.mockRestore();
  });
});
