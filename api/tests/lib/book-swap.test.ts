import { describe, it, expect } from "vitest";
import { extractSwapLegs, bookSwap, type HeliusEnhancedTx, type BookResult } from "@/lib/book-swap";
import { MemoryRepo } from "@/db/memory";
import fixtureJson from "../fixtures/helius-swap.json";
import orderEngineJson from "../fixtures/helius-order-engine-swap.json";

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

  it("ignores a revoked wallet and a one-sided transfer; Helius's label alone decides nothing (09-30)", async () => {
    const repo = await repoWithWallet();
    await repo.setWalletStatus("WALLET", "revoked");
    expect((await bookSwap({ repo, tx: fixture, priceUsd: prices })).booked).toBe(false);
    const repo2 = await repoWithWallet();
    const sent: HeliusEnhancedTx = { signature: "sent", timestamp: fixture.timestamp, type: "TRANSFER", feePayer: "WALLET",
      tokenTransfers: [{ fromUserAccount: "WALLET", toUserAccount: "FRIEND", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tokenAmount: 5 }] };
    expect((await bookSwap({ repo: repo2, tx: sent, priceUsd: prices })).booked).toBe(false);
    const relabelled = clone();
    relabelled.type = "TRANSFER"; // the same swap under another label still has two legs
    expect((await bookSwap({ repo: repo2, tx: relabelled, priceUsd: prices })).booked).toBe(true);
  });
});

// 09-30: Phantom routed two swaps through Jupiter's Order Engine (61DFfe…). Helius parses them as INITIALIZE_ACCOUNT with the
// transfers listed plainly and no swap event, so nothing booked and the round-ups were lost. The fixture is the real 10:44 swap:
// 0.1 SOL out as a native transfer, 11.899598 USDC in as a token transfer.
describe("a swap Helius did not label SWAP", () => {
  const WSOL = "So11111111111111111111111111111111111111112";
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const PHANTOM = "887dEPR85vfSZ45zFrxttJ6cLomwvnYbh5HnyGbTAXVu";
  const orderEngine = orderEngineJson as unknown as HeliusEnhancedTx;
  const priced = async (m: string) => (m === WSOL ? 119 : m === USDC ? 1 : null);
  async function repoWithPhantom() {
    const r = new MemoryRepo();
    await r.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await r.addWallet({ pubkey: PHANTOM, userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
    return r;
  }

  it("reads the wallet's legs from its native and token transfers when there is no swap event", () => {
    expect(extractSwapLegs(orderEngine, PHANTOM)).toEqual({ wallet: PHANTOM, inMint: WSOL, inAmount: 0.1, outMint: USDC, outAmount: 11.899598 });
  });

  it("books it: $11.90 of SOL into USDC rounds up 10 cents", async () => {
    const repo = await repoWithPhantom();
    const r = await bookSwap({ repo, tx: orderEngine, priceUsd: priced });
    expect(roundup(r)).toBe(10);
    const [row] = await repo.unplantedSwaps(PHANTOM);
    expect(row.usdSizeCents).toBe(1190);
    expect([row.inMint, row.outMint]).toEqual([WSOL, USDC]);
  });

  it("never books a plain transfer: one side only is not a swap", async () => {
    const repo = await repoWithPhantom();
    const sent: HeliusEnhancedTx = { signature: "t1", timestamp: 1790800000, type: "TRANSFER", feePayer: PHANTOM, tokenTransfers: [],
      nativeTransfers: [{ fromUserAccount: PHANTOM, toUserAccount: "FRIEND", amount: 50_000_000 }] };
    const received: HeliusEnhancedTx = { signature: "t2", timestamp: 1790800000, type: "TRANSFER", feePayer: "FRIEND",
      tokenTransfers: [{ fromUserAccount: "FRIEND", toUserAccount: PHANTOM, mint: USDC, tokenAmount: 5 }] };
    const wrap: HeliusEnhancedTx = { signature: "t3", timestamp: 1790800000, type: "UNKNOWN", feePayer: PHANTOM,
      tokenTransfers: [{ fromUserAccount: "", toUserAccount: PHANTOM, mint: WSOL, tokenAmount: 0.1 }],
      nativeTransfers: [{ fromUserAccount: PHANTOM, toUserAccount: "", amount: 100_000_000 }] };
    for (const tx of [sent, received, wrap]) expect((await bookSwap({ repo, tx, priceUsd: priced })).booked).toBe(false);
    expect((await repo.unplantedSwaps(PHANTOM)).length).toBe(0);
  });
});

// 10-06 (2xYqKn37…, the Seeker's Seed Vault wallet): the wallet app took its fee in the swap, so USDC left the wallet in TWO
// transfers, 0.01215 (the fee, first) and 1.48785 (the swap). Reading only the first booked a $1.50 swap as 1 cent (99-cent
// round-up). A leg is every transfer of that coin out of (or into) the wallet, added up.
describe("a swap whose wallet app takes a fee in the same coin", () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const WSOL_MINT = "So11111111111111111111111111111111111111112";
  const SEED = "SEEDVAULT";

  it("adds up every USDC transfer out of the wallet (no swap event)", () => {
    const tx: HeliusEnhancedTx = {
      signature: "2xYqKn37", timestamp: 1791323206, type: "UNKNOWN", feePayer: SEED,
      tokenTransfers: [
        { fromUserAccount: SEED, toUserAccount: "FEE", mint: USDC, tokenAmount: 0.01215 },
        { fromUserAccount: SEED, toUserAccount: "POOL", mint: USDC, tokenAmount: 1.48785 },
      ],
      nativeTransfers: [{ fromUserAccount: "POOL", toUserAccount: SEED, amount: 12_277_022 }],
    };
    const legs = extractSwapLegs(tx, SEED)!;
    expect(legs.inMint).toBe(USDC);
    expect(legs.inAmount).toBeCloseTo(1.5, 9);
    expect(legs.outMint).toBe(WSOL_MINT);
    expect(legs.outAmount).toBeCloseTo(0.012277022, 9);
  });

  it("adds up every token input of the wallet in the swap event", () => {
    const leg = (amount: string) => ({ userAccount: SEED, mint: USDC, rawTokenAmount: { tokenAmount: amount, decimals: 6 } });
    const tx: HeliusEnhancedTx = {
      signature: "2xYqKn37", timestamp: 1791323206, type: "SWAP", feePayer: SEED, tokenTransfers: [],
      events: { swap: { nativeInput: null, nativeOutput: { account: SEED, amount: "12277022" }, tokenInputs: [leg("12150"), leg("1487850")], tokenOutputs: [] } },
    };
    const legs = extractSwapLegs(tx, SEED)!;
    expect(legs.inMint).toBe(USDC);
    expect(legs.inAmount).toBeCloseTo(1.5, 9);
  });

  it("books it as a $1.50 swap: a 50-cent round-up, not 99", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: SEED, userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
    const tx: HeliusEnhancedTx = {
      signature: "2xYqKn37", timestamp: 1791323206, type: "UNKNOWN", feePayer: SEED,
      tokenTransfers: [
        { fromUserAccount: SEED, toUserAccount: "FEE", mint: USDC, tokenAmount: 0.01215 },
        { fromUserAccount: SEED, toUserAccount: "POOL", mint: USDC, tokenAmount: 1.48785 },
      ],
      nativeTransfers: [{ fromUserAccount: "POOL", toUserAccount: SEED, amount: 12_277_022 }],
    };
    expect(roundup(await bookSwap({ repo, tx, priceUsd: prices }))).toBe(50);
  });
});
