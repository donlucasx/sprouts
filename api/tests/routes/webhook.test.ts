import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import type { HeliusEnhancedTx } from "@/lib/book-swap";
import fixtureJson from "../fixtures/helius-swap.json";
import { getBase58Decoder } from "@solana/kit";

// Security R207 #8, the route's wiring: the booking task the webhook schedules re-reads each swap from chain through the app's
// RPC (faked here) before booking it. `after` runs the task inline so the test can await it.
const { tasks, getTransactionMock, priceMock } = vi.hoisted(() => ({ tasks: [] as Promise<unknown>[], getTransactionMock: vi.fn(), priceMock: vi.fn<(m: string) => Promise<number | null>>() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => Promise<unknown>) => { tasks.push(fn()); } }));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({ getTransaction: () => ({ send: getTransactionMock }) }) }));
vi.mock("@/lib/jupiter", () => ({ priceUsd: (m: string) => priceMock(m) }));
vi.mock("@/lib/puller", () => ({ pullerSigner: async () => ({ address: "PULLER" }) }));

import { clearSharedReads } from "@/lib/memo";
import { POST, maxDuration } from "@/app/api/webhooks/helius/route";

const fixture = fixtureJson as unknown as HeliusEnhancedTx;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const bal = (accountIndex: number, mint: string, amount: string, decimals: number) => ({ accountIndex, mint, owner: "WALLET", uiTokenAmount: { amount, decimals } });

/** The fixture's swap as the chain has it, timed now so it is recent. */
function onChain(blockTime: number, inMint = USDC) {
  return {
    blockTime: BigInt(blockTime),
    meta: { err: null, preBalances: [1_000_000_000n], postBalances: [999_995_000n], preTokenBalances: [bal(1, inMint, "5000000", 6)], postTokenBalances: [bal(1, inMint, "3830000", 6), bal(2, BONK, "5200050000", 5)] },
    transaction: { message: { accountKeys: [{ pubkey: "WALLET", signer: true }] } },
  };
}

async function deliver(tx: HeliusEnhancedTx) {
  const res = await POST(new Request("http://x/api/webhooks/helius", { method: "POST", headers: { authorization: "Bearer hook-secret" }, body: JSON.stringify([tx]) }));
  await Promise.all(tasks.splice(0));
  return res;
}

describe("POST /api/webhooks/helius", () => {
  let repo: MemoryRepo;
  const now = Math.floor(Date.now() / 1000);
  // A well-formed 64-byte signature: the RPC helper refuses the fixture's placeholder before any call (and so books nothing).
  const tx = { ...fixture, timestamp: now, signature: getBase58Decoder().decode(new Uint8Array(64).fill(7)) };

  beforeAll(() => {
    process.env.HELIUS_WEBHOOK_SECRET = "hook-secret";
  });
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: "WALLET", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
    getTransactionMock.mockReset();
    priceMock.mockReset();
    priceMock.mockResolvedValue(null);
    clearSharedReads();
  });

  it("books a swap the chain confirms, with one getTransaction", async () => {
    getTransactionMock.mockResolvedValue(onChain(now));
    expect((await deliver(tx)).status).toBe(200);
    expect((await repo.unplantedSwaps("WALLET")).length).toBe(1);
    expect(getTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("does not book a well-formed event whose transaction the chain does not confirm (a forged event with the secret)", async () => {
    getTransactionMock.mockResolvedValue(onChain(now - 3 * 86_400));   // a real old swap re-posted with a fresh timestamp
    expect((await deliver(tx)).status).toBe(200);
    expect(getTransactionMock).toHaveBeenCalledTimes(1);
    expect((await repo.unplantedSwaps("WALLET")).length).toBe(0);
  });

  // Ops #9: a delivered swap that is not booked for a reason other than "not a swap / top-up / already booked" leaves an event.
  const refused = () => repo.events.filter((e) => e.kind === "swap_refused");

  it("a swap the chain refuses writes one swap_refused event (reason enum, 8-char signature, wallet)", async () => {
    getTransactionMock.mockResolvedValue(onChain(now - 3 * 86_400));
    await deliver(tx);
    expect(refused()).toHaveLength(1);
    expect(refused()[0]).toMatchObject({ walletPubkey: "WALLET", detail: { reason: "time_mismatch", sig: tx.signature.slice(0, 8) } });
  });

  it("an unpriced item writes one zero_roundup event and no swap row", async () => {
    getTransactionMock.mockResolvedValue(onChain(now, "Unknown1"));
    // Neither leg is a stable and the price read (mocked null) finds nothing.
    const unpriced = { ...tx, tokenTransfers: tx.tokenTransfers.map((t) => ({ ...t, mint: t.mint === USDC ? "Unknown1" : t.mint })), events: { swap: { ...tx.events!.swap, tokenInputs: tx.events!.swap!.tokenInputs!.map((t) => ({ ...t, mint: t.mint === USDC ? "Unknown1" : t.mint })) } } } as HeliusEnhancedTx;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const done = deliver(unpriced);
      await vi.advanceTimersByTimeAsync(5_000);
      await done;
    } finally {
      vi.useRealTimers();
    }
    const zero = repo.events.filter((e) => e.kind === "zero_roundup");
    expect(zero).toHaveLength(1);
    expect(zero[0]).toMatchObject({ walletPubkey: "WALLET", detail: { reason: "unpriced" } });
    expect((zero[0].detail as { sig: string }).sig).toHaveLength(8);
    expect(await repo.unplantedSwaps("WALLET")).toEqual([]);
    expect(refused()).toHaveLength(0);
  });

  const unpricedTx = () => ({ ...tx, tokenTransfers: tx.tokenTransfers.map((t) => ({ ...t, mint: t.mint === USDC ? "Unknown1" : t.mint })), events: { swap: { ...tx.events!.swap, tokenInputs: tx.events!.swap!.tokenInputs!.map((t) => ({ ...t, mint: t.mint === USDC ? "Unknown1" : t.mint })) } } }) as HeliusEnhancedTx;
  const sigOf = (i: number) => getBase58Decoder().decode(new Uint8Array(64).fill(20 + i));
  async function deliverMany(items: HeliusEnhancedTx[]) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await POST(new Request("http://x/api/webhooks/helius", { method: "POST", headers: { authorization: "Bearer hook-secret" }, body: JSON.stringify(items) }));
      const all = Promise.all(tasks.splice(0));
      await vi.advanceTimersByTimeAsync(60_000);
      await all;
    } finally {
      vi.useRealTimers();
    }
  }

  it("a price-down delivery: after 2 unpriced items in a row the rest read no price (still unbooked, zero_roundup within the cap)", async () => {
    getTransactionMock.mockResolvedValue(onChain(now, "Unknown1"));
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ ...unpricedTx(), signature: sigOf(i) }));
    await deliverMany(mk(2));
    const callsForTwo = priceMock.mock.calls.length;
    expect(callsForTwo).toBeGreaterThan(0);
    priceMock.mockClear();
    await deliverMany(mk(6));
    // 11-23: a missing price is kept 10 s (shared-reads SHARED_PRICE_MISS_TTL_MS), so the six-item delivery may read even less; the
    // rule is that reads never grow with the item count.
    expect(priceMock.mock.calls.length).toBeLessThanOrEqual(callsForTwo);
    expect(await repo.unplantedSwaps("WALLET")).toEqual([]);
    expect(repo.events.filter((e) => e.kind === "zero_roundup").length).toBeGreaterThanOrEqual(6);
  });

  const swapOf = (mint: string, i: number) => ({ ...unpricedTx(), signature: sigOf(i), tokenTransfers: tx.tokenTransfers.map((t) => ({ ...t, mint: t.mint === USDC ? mint : t.mint })), events: { swap: { ...tx.events!.swap, tokenInputs: tx.events!.swap!.tokenInputs!.map((t) => ({ ...t, mint: t.mint === USDC ? mint : t.mint })) } } }) as HeliusEnhancedTx;

  it("the breaker is per coin: two swaps of an unpriceable coin X then a swap of a priceable coin Y in one delivery books Y, and X is read at most twice (4 Jupiter calls: attempt + retry each) (security review)", async () => {
    getTransactionMock.mockResolvedValueOnce(onChain(now, "UnpriceableX")).mockResolvedValueOnce(onChain(now, "UnpriceableX")).mockResolvedValueOnce(onChain(now, "UnpriceableX")).mockResolvedValueOnce(onChain(now, "PricedY"));
    priceMock.mockImplementation(async (m) => (m === "PricedY" ? 0.00002 : null));
    await deliverMany([swapOf("UnpriceableX", 0), swapOf("UnpriceableX", 1), swapOf("UnpriceableX", 2), swapOf("PricedY", 3)]);
    const booked = await repo.unplantedSwaps("WALLET");
    expect(booked.map((b) => b.signature)).toEqual([sigOf(3)]);
    expect(priceMock.mock.calls.filter(([m]) => m === "UnpriceableX").length).toBeLessThanOrEqual(4);   // 2 reads, each an attempt plus its retry
    expect(priceMock.mock.calls.some(([m]) => m === "PricedY")).toBe(true);
    expect(repo.events.filter((e) => e.kind === "zero_roundup")).toHaveLength(3);
  });

  it("an unpriced swap, then the same signature delivered again with a price, books exactly once", async () => {
    getTransactionMock.mockResolvedValue(onChain(now, "Unknown1"));
    const u = unpricedTx();
    await deliverMany([u]);
    expect(await repo.unplantedSwaps("WALLET")).toEqual([]);
    priceMock.mockResolvedValue(0.00002);
    await deliverMany([u]);
    expect((await repo.unplantedSwaps("WALLET")).length).toBe(1);
    await deliverMany([u]);
    expect((await repo.unplantedSwaps("WALLET")).length).toBe(1);
  });

  it("zero_roundup events count toward MAX_REFUSAL_EVENTS_PER_DELIVERY", async () => {
    const { MAX_REFUSAL_EVENTS_PER_DELIVERY } = await import("@/lib/swap-refusal");
    getTransactionMock.mockResolvedValue(onChain(now, "Unknown1"));
    const unpriced = { ...tx, tokenTransfers: tx.tokenTransfers.map((t) => ({ ...t, mint: t.mint === USDC ? "Unknown1" : t.mint })), events: { swap: { ...tx.events!.swap, tokenInputs: tx.events!.swap!.tokenInputs!.map((t) => ({ ...t, mint: t.mint === USDC ? "Unknown1" : t.mint })) } } } as HeliusEnhancedTx;
    const many = Array.from({ length: MAX_REFUSAL_EVENTS_PER_DELIVERY + 3 }, (_, i) => ({ ...unpriced, signature: getBase58Decoder().decode(new Uint8Array(64).fill(10 + i)) }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await POST(new Request("http://x/api/webhooks/helius", { method: "POST", headers: { authorization: "Bearer hook-secret" }, body: JSON.stringify(many) }));
      const all = Promise.all(tasks.splice(0));
      await vi.advanceTimersByTimeAsync(60_000);
      await all;
    } finally {
      vi.useRealTimers();
    }
    expect(repo.events.filter((e) => e.kind === "zero_roundup")).toHaveLength(MAX_REFUSAL_EVENTS_PER_DELIVERY);
  });

  it("a chain read that throws is recorded as chain_read_error, with no RPC text", async () => {
    getTransactionMock.mockRejectedValue(new Error("fetch failed https://rpc?api-key=SECRET"));
    await deliver(tx);
    expect(refused()).toHaveLength(1);
    expect(JSON.stringify(refused()[0].detail)).not.toContain("SECRET");
    expect(refused()[0].detail).toMatchObject({ reason: "chain_read_error" });
  });

  it("a booking that throws is recorded as error (wallet unknown)", async () => {
    getTransactionMock.mockResolvedValue(onChain(now));
    repo.getRules = async () => { throw new Error("db down"); };
    await deliver(tx);
    expect(refused()).toHaveLength(1);
    expect(refused()[0]).toMatchObject({ walletPubkey: null, detail: { reason: "error" } });
  });

  it("routine items write nothing: a booked swap, a re-delivery, an unknown wallet, a top-up, a puller planting", async () => {
    getTransactionMock.mockResolvedValue(onChain(now));
    await deliver(tx);
    await deliver(tx);   // already booked
    await deliver({ ...tx, signature: "OTHER", tokenTransfers: tx.tokenTransfers.map((t) => ({ ...t, fromUserAccount: t.fromUserAccount === "WALLET" ? "STRANGER" : t.fromUserAccount, toUserAccount: t.toUserAccount === "WALLET" ? "STRANGER" : t.toUserAccount })), feePayer: "STRANGER", events: {} });
    await deliver({ ...tx, signature: "PULLERPAID", feePayer: "PULLER" });
    await repo.addEvent({ userPubkey: "U", walletPubkey: "WALLET", kind: "topup_sent", detail: { signature: "TOPUP" } });
    await deliver({ ...tx, signature: "TOPUP" });
    expect(refused()).toHaveLength(0);
  });

  it("at most MAX_REFUSAL_EVENTS_PER_DELIVERY events per delivery (a flood cannot fill the table)", async () => {
    const { MAX_REFUSAL_EVENTS_PER_DELIVERY } = await import("@/lib/swap-refusal");
    getTransactionMock.mockResolvedValue(onChain(now - 3 * 86_400));
    const many = Array.from({ length: MAX_REFUSAL_EVENTS_PER_DELIVERY + 5 }, (_, i) => ({ ...tx, signature: `${tx.signature.slice(0, 80)}${i}` }));
    await POST(new Request("http://x/api/webhooks/helius", { method: "POST", headers: { authorization: "Bearer hook-secret" }, body: JSON.stringify(many) }));
    await Promise.all(tasks.splice(0));
    expect(refused()).toHaveLength(MAX_REFUSAL_EVENTS_PER_DELIVERY);
  });

  it("L1: hung event writes hold one delivery at most REFUSAL_WAIT_TOTAL_MS in all, well inside the route's maxDuration", async () => {
    const { REFUSAL_WAIT_TOTAL_MS, MAX_REFUSAL_EVENTS_PER_DELIVERY } = await import("@/lib/swap-refusal");
    expect(REFUSAL_WAIT_TOTAL_MS).toBe(5_000);
    expect(maxDuration).toBe(60);
    getTransactionMock.mockResolvedValue(onChain(now - 3 * 86_400));
    const writes: unknown[] = [];
    repo.addEvent = (e) => { writes.push(e); return new Promise(() => {}); };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const many = Array.from({ length: MAX_REFUSAL_EVENTS_PER_DELIVERY }, (_, i) => ({ ...tx, signature: `${tx.signature.slice(0, 80)}${i}` }));
      await POST(new Request("http://x/api/webhooks/helius", { method: "POST", headers: { authorization: "Bearer hook-secret" }, body: JSON.stringify(many) }));
      let done = false;
      const all = Promise.all(tasks.splice(0)).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(REFUSAL_WAIT_TOTAL_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await all;
      expect(done).toBe(true);
      expect(writes).toHaveLength(MAX_REFUSAL_EVENTS_PER_DELIVERY);   // every write still started, only the waiting is capped
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers before any booking or event write (the response never waits on them)", async () => {
    getTransactionMock.mockResolvedValue(onChain(now - 3 * 86_400));
    const res = await POST(new Request("http://x/api/webhooks/helius", { method: "POST", headers: { authorization: "Bearer hook-secret" }, body: JSON.stringify([tx]) }));
    expect(res.status).toBe(200);
    expect(refused()).toHaveLength(0);
    await Promise.all(tasks.splice(0));
    expect(refused()).toHaveLength(1);
  });
});
