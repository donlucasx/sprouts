import { describe, it, expect, vi } from "vitest";
import { checkSwapOnChain, onChainVerifier, MAX_AGE_S, type ChainTx } from "@/lib/verify-swap";
import { bookSwap, type HeliusEnhancedTx } from "@/lib/book-swap";
import { MemoryRepo } from "@/db/memory";
import fixtureJson from "../fixtures/helius-swap.json";

// Security R207 #8: the webhook's swap is re-read from chain before it is booked. The chain transaction here is the fixture's
// swap as getTransaction (jsonParsed) would return it: WALLET signs, spends 1.17 USDC, receives 52,000.5 BONK.
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WSOL = "So11111111111111111111111111111111111111112";
const fixture = fixtureJson as unknown as HeliusEnhancedTx;
const T = fixture.timestamp;
const legs = { wallet: "WALLET", inMint: USDC, inAmount: 1.17, outMint: BONK, outAmount: 52000.5 };
const bal = (accountIndex: number, mint: string, owner: string, amount: string, decimals: number) => ({ accountIndex, mint, owner, uiTokenAmount: { amount, decimals } });

function chainTx(over: Partial<ChainTx> = {}): ChainTx {
  return {
    blockTime: BigInt(T),
    meta: {
      err: null,
      preBalances: [1_000_000_000n, 0n],
      postBalances: [999_995_000n, 0n],
      preTokenBalances: [bal(2, USDC, "WALLET", "5000000", 6)],
      postTokenBalances: [bal(2, USDC, "WALLET", "3830000", 6), bal(3, BONK, "WALLET", "5200050000", 5)],
    },
    transaction: { message: { accountKeys: [{ pubkey: "WALLET", signer: true }, { pubkey: "POOL", signer: false }] } },
    ...over,
  };
}
const check = (chain: ChainTx | null, o: Partial<{ legs: typeof legs; timestamp: number; nowS: number }> = {}) =>
  checkSwapOnChain(chain, { wallet: "WALLET", legs: o.legs ?? legs, timestamp: o.timestamp ?? T, nowS: o.nowS ?? T + 30 });

describe("checkSwapOnChain", () => {
  it("passes the swap the chain shows", () => {
    expect(check(chainTx())).toBeNull();
  });

  it("refuses a signature the chain does not have (a made-up swap)", () => {
    expect(check(null)).toBe("not found on chain");
  });

  it("refuses a transaction that failed", () => {
    expect(check(chainTx({ meta: { ...chainTx().meta!, err: { InstructionError: [0, "Custom"] } } }))).toBe("failed on chain");
  });

  it("refuses a transaction the linked wallet did not sign (it only received a transfer)", () => {
    expect(check(chainTx({ transaction: { message: { accountKeys: [{ pubkey: "WALLET", signer: false }, { pubkey: "POOL", signer: true }] } } }))).toBe("the wallet did not sign it");
  });

  it("refuses an event whose timestamp is not the block's (an old timestamp would force a planting)", () => {
    expect(check(chainTx(), { timestamp: T - 3 * 86_400 })).toMatch(/is not the block's/);
  });

  it("refuses a real but old swap replayed", () => {
    expect(check(chainTx(), { nowS: T + MAX_AGE_S + 1 })).toMatch(/not recent/);
    expect(check(chainTx(), { nowS: T + MAX_AGE_S - 1 })).toBeNull();
  });

  it("refuses an in-leg larger than what the wallet spent (the 1% rule has no ceiling)", () => {
    expect(check(chainTx(), { legs: { ...legs, inAmount: 1_170 } })).toMatch(/in-leg 1170 is more than the wallet spent/);
  });

  it("refuses an out-leg larger than what the wallet received", () => {
    expect(check(chainTx(), { legs: { ...legs, outAmount: 5_200_050 } })).toMatch(/out-leg .* more than the wallet received/);
  });

  it("refuses legs in a mint the wallet's balances never moved", () => {
    expect(check(chainTx(), { legs: { ...legs, outMint: WSOL, outAmount: 5 } })).toMatch(/out-leg/);
  });

  it("a native SOL in-leg passes with the fee and rent on top of the lamport change", () => {
    const sol = chainTx({
      meta: {
        err: null, preBalances: [100_000_000n, 0n], postBalances: [77_955_000n, 0n],   // 0.02 SOL + 0.002 rent + fee
        preTokenBalances: [], postTokenBalances: [bal(2, USDC, "WALLET", "2380122", 6)],
      },
    });
    expect(check(sol, { legs: { wallet: "WALLET", inMint: WSOL, inAmount: 0.02, outMint: USDC, outAmount: 2.380122 } })).toBeNull();
  });

  it("a native SOL out-leg passes when the fee comes off what arrived, and an inflated one does not", () => {
    const sol = chainTx({
      meta: {
        err: null, preBalances: [10_000_000n, 0n], postBalances: [509_995_000n, 0n],   // +0.5 SOL less the fee
        preTokenBalances: [bal(2, USDC, "WALLET", "80000000", 6)], postTokenBalances: [bal(2, USDC, "WALLET", "0", 6)],
      },
    });
    const solLegs = { wallet: "WALLET", inMint: USDC, inAmount: 80, outMint: WSOL, outAmount: 0.5 };
    expect(check(sol, { legs: solLegs })).toBeNull();
    expect(check(sol, { legs: { ...solLegs, outAmount: 5 } })).toMatch(/out-leg/);
  });
});

describe("onChainVerifier", () => {
  const args = { signature: "S", wallet: "WALLET", legs, timestamp: T };
  const now = () => T + 30;

  it("one getTransaction per check when the chain has it", async () => {
    const fetchTx = vi.fn(async () => chainTx());
    expect(await onChainVerifier(fetchTx, { now })(args)).toBeNull();
    expect(fetchTx).toHaveBeenCalledTimes(1);
  });

  it("asks once more when the node has not seen it yet, then refuses if it still has not", async () => {
    const late = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(chainTx());
    expect(await onChainVerifier(late, { now, retryMs: 0 })(args)).toBeNull();
    const never = vi.fn(async () => null);
    expect(await onChainVerifier(never, { now, retryMs: 0 })(args)).toBe("not found on chain");
    expect(never).toHaveBeenCalledTimes(2);
  });

  it("a fetch that throws is a refusal, not a pass", async () => {
    expect(await onChainVerifier(async () => { throw new Error("429"); }, { now })(args)).toMatch(/could not be read: 429/);
  });
});

describe("bookSwap with the on-chain check", () => {
  async function repoWithWallet() {
    const r = new MemoryRepo();
    await r.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await r.addWallet({ pubkey: "WALLET", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
    return r;
  }
  const prices = async () => null;

  it("books when the chain agrees", async () => {
    const repo = await repoWithWallet();
    const fetchTx = vi.fn(async () => chainTx());
    const r = await bookSwap({ repo, tx: fixture, priceUsd: prices, verify: onChainVerifier(fetchTx, { now: () => T + 5 }) });
    expect(r.booked).toBe(true);
    expect(fetchTx).toHaveBeenCalledWith(fixture.signature);
  });

  it("does not book a swap the chain refuses, and says why", async () => {
    const repo = await repoWithWallet();
    const r = await bookSwap({ repo, tx: fixture, priceUsd: prices, verify: onChainVerifier(async () => null, { now: () => T + 5, retryMs: 0 }) });
    expect(r).toEqual({ booked: false, refused: "not found on chain" });
    expect((await repo.unplantedSwaps("WALLET")).length).toBe(0);
  });

  it("an event for no linked wallet, or the puller's own planting, costs no RPC call", async () => {
    const fetchTx = vi.fn(async () => chainTx());
    const verify = onChainVerifier(fetchTx, { now: () => T + 5 });
    expect((await bookSwap({ repo: new MemoryRepo(), tx: fixture, priceUsd: prices, verify })).booked).toBe(false);
    const repo = await repoWithWallet();
    expect((await bookSwap({ repo, tx: { ...fixture, feePayer: "PULLER" }, priceUsd: prices, ignoreFeePayer: "PULLER", verify })).booked).toBe(false);
    expect(fetchTx).not.toHaveBeenCalled();
  });
});
