import { describe, it, expect } from "vitest";
import { extractSwapLegs, bookSwap, type HeliusEnhancedTx, type BookResult } from "@/lib/book-swap";
import { MemoryRepo } from "@/db/memory";
import fixtureJson from "../fixtures/helius-swap.json";

const fixture = fixtureJson as unknown as HeliusEnhancedTx;
const roundup = (r: BookResult) => (r.booked ? r.roundupCents : -1);
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const prices = async (m: string) => (m === "So11111111111111111111111111111111111111112" ? 150 : null);
const clone = (): HeliusEnhancedTx => JSON.parse(JSON.stringify(fixture));

async function repoWithWallet() {
  const r = new MemoryRepo();
  await r.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
  await r.addWallet({ pubkey: "WALLET", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
  return r;
}

describe("extractSwapLegs", () => {
  it("reads the wallet's in and out legs", () => {
    expect(extractSwapLegs(fixture, "WALLET")).toEqual({ wallet: "WALLET", inMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", inAmount: 1.17, outMint: BONK, outAmount: 52000.5 });
  });

  // The real Helius swap event nests token amounts as rawTokenAmount; this is the 09-29 Phantom dust swap (36vBH26K…),
  // which failed to book with out_amount null because the flat tokenAmount the fixture assumed does not exist.
  it("reads rawTokenAmount from a real Helius swap event (SOL in, USDC out)", () => {
    const tx: HeliusEnhancedTx = {
      signature: "36vBH26K", timestamp: 1790630280, type: "SWAP", feePayer: "WALLET", tokenTransfers: [],
      events: { swap: {
        nativeInput: { account: "WALLET", amount: "20000000" }, nativeOutput: null, tokenInputs: [],
        tokenOutputs: [{ userAccount: "WALLET", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", rawTokenAmount: { tokenAmount: "2380122", decimals: 6 } }],
      } },
    };
    expect(extractSwapLegs(tx, "WALLET")).toEqual({
      wallet: "WALLET", inMint: "So11111111111111111111111111111111111111112", inAmount: 0.02,
      outMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outAmount: 2.380122,
    });
  });

  it("returns null for a wallet not in the transfers", () => {
    expect(extractSwapLegs(fixture, "SOMEONE")).toBeNull();
  });
});

describe("bookSwap", () => {
  // Review M14: when the Seed Vault key is also the trading wallet, a stORE planting moves USDC out of it and stORE into it,
  // so the fallback scan would book Sprouts' own planting as a swap; anything the puller paid for is skipped.
  it("never books a transaction the puller paid for", async () => {
    const repo = await repoWithWallet();
    const tx = clone();
    tx.feePayer = "PULLER";
    const r = await bookSwap({ repo, tx, priceUsd: prices, ignoreFeePayer: "PULLER" });
    expect(r.booked).toBe(false);
    expect((await repo.unplantedSwaps("WALLET")).length).toBe(0);
  });

  it("books a $1.17 memecoin swap as an 83-cent round-up", async () => {
    const repo = await repoWithWallet();
    expect(await bookSwap({ repo, tx: fixture, priceUsd: prices })).toEqual({ booked: true, walletPubkey: "WALLET", roundupCents: 83 });
    const s = (await repo.unplantedSwaps("WALLET"))[0];
    expect(s.class).toBe("memecoin");
    expect(s.usdSizeCents).toBe(117);
  });

  it("ignores an unknown wallet", async () => {
    expect(await bookSwap({ repo: new MemoryRepo(), tx: fixture, priceUsd: prices })).toEqual({ booked: false });
  });

  it("is idempotent on the signature", async () => {
    const repo = await repoWithWallet();
    await bookSwap({ repo, tx: fixture, priceUsd: prices });
    expect((await bookSwap({ repo, tx: fixture, priceUsd: prices })).booked).toBe(false);
  });

  it("unpriced swap books zero", async () => {
    const repo = await repoWithWallet();
    const tx = clone();
    tx.signature = "sig-unpriced";
    tx.tokenTransfers[0].mint = "Unknown1";
    tx.events!.swap!.tokenInputs![0].mint = "Unknown1";
    expect(await bookSwap({ repo, tx, priceUsd: prices })).toEqual({ booked: true, walletPubkey: "WALLET", roundupCents: 0 });
    expect((await repo.unplantedSwaps("WALLET"))[0].usdSizeCents).toBeNull();
  });

  it("a two-hop swap (four transfers) still reads the wallet's own legs", async () => {
    const repo = await repoWithWallet();
    const tx = clone();
    tx.signature = "sig-2hop";
    delete tx.events;
    tx.tokenTransfers = [
      tx.tokenTransfers[0],
      { fromUserAccount: "POOL", toUserAccount: "POOL2", mint: "MID", tokenAmount: 9 },
      { fromUserAccount: "POOL2", toUserAccount: "POOL", mint: "MID2", tokenAmount: 9 },
      tx.tokenTransfers[1],
    ];
    expect(roundup(await bookSwap({ repo, tx, priceUsd: prices }))).toBe(83);
  });

  it("a native SOL leg is read from events.swap", async () => {
    const repo = await repoWithWallet();
    const tx = clone();
    tx.signature = "sig-sol";
    tx.tokenTransfers = [tx.tokenTransfers[1]];
    tx.events = { swap: { nativeInput: { account: "WALLET", amount: "10000000" }, tokenOutputs: [{ userAccount: "WALLET", mint: BONK, rawTokenAmount: { tokenAmount: "5200050000", decimals: 5 } }] } };
    expect(roundup(await bookSwap({ repo, tx, priceUsd: prices }))).toBe(50);
  });

  it("uses the user's rules (round-up off)", async () => {
    const repo = await repoWithWallet();
    await repo.saveRules("U", { roundupOn: false });
    expect(roundup(await bookSwap({ repo, tx: fixture, priceUsd: prices }))).toBe(0);
  });

  it("ignores a revoked wallet and non-swap transactions", async () => {
    const repo = await repoWithWallet();
    await repo.setWalletStatus("WALLET", "revoked");
    expect((await bookSwap({ repo, tx: fixture, priceUsd: prices })).booked).toBe(false);
    const repo2 = await repoWithWallet();
    const tx = clone();
    tx.type = "TRANSFER";
    expect((await bookSwap({ repo: repo2, tx, priceUsd: prices })).booked).toBe(false);
  });
});
