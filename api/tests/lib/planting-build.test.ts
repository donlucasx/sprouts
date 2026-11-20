import { describe, it, expect, vi, beforeEach } from "vitest";
import { address, generateKeyPairSigner, type Instruction, type KeyPairSigner } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

let puller: KeyPairSigner;
const sentPre: unknown[] = [];
const checks: Record<string, unknown>[] = [];
const QUOTES: Record<string, [string, string]> = {   // outputMint -> [outAmount, otherAmountThreshold] for a $2 pull
  So11111111111111111111111111111111111111112: ["16500000", "16335000"],
  he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A: ["13843000", "13705000"],
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: ["3225", "3193"],
  SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3: ["109289617", "108196721"],
};
// Task 11 (T9 review M5): the builder re-checks this second read like the first, so the mock price is published now.
const SOL_PRICE = { feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", price: 12_147_000_000n, conf: 10_000_000n, exponent: -8, publishTime: BigInt(Math.floor(Date.now() / 1000)), full: true };
// T9 finding: without the Sprouts ALT a Jupiter Lend leg does not fit (USDC 1297 B, SOL 1424 B with an empty Jupiter route, over
// 1232), so SPROUTS_ALT is set here to a table holding exactly sproutsAltAddresses(puller), served as jsonParsed the way the kit
// reads it. `altOn = false` shows the refusal without it.
const ALT_ADDR = "AL7eJQ4GqXg6fPZ9u3vFeWwz6bKwZ2PLvcxCkV9HvVdy";
let altContent: string[] = [];
let altOn = true;
// I1 (fix round 1): balances the simulation helpers read. `chainPre` = getMultipleAccounts (base64) before; `simPost` = the
// simulation's accounts after; an address missing from a map is an absent account (null).
const tokenAcct = (amount: bigint) => { const b = Buffer.alloc(165); b.writeBigUInt64LE(amount, 64); return b.toString("base64"); };
const chainPre = new Map<string, bigint>();
const simPost = new Map<string, bigint>();
/** Task 12 (measured on mainnet 10-04): an account the transaction CLOSES comes back from simulateTransaction as lamports 0, System-owned, 0 data bytes, not null. */
const simClosed = new Set<string>();
/** Task 12 review M1: a 0-byte account that still holds lamports (not a close): its lamports here. */
const simClosedLamports = new Map<string, bigint>();
const simCalls: string[][] = [];
const stakes: bigint[] = [];
// The posted SKR price (contracts 10 item 15): the buildPriceUpdate double's shape, as the real one returns it (tests/lib/pyth.test.ts).
// post_update rides the pre-txs (postIx null); the price is SKR-sized so the fixture's SKR route clears the floor.
const RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
const POSTED = address("9vSkHk7mY2ZcWg1sVQyPn5PpfwrGJmKQyHqH4u3LwZbx");
const reclaimIx: Instruction = { programAddress: address(RECEIVER), accounts: [], data: new Uint8Array([7]) };
const closeVaaIx: Instruction = { programAddress: address("HDwcJBJXjL9FpJ7UBsYBtaDjsBUhuLCUYoz3zr8SWWaQ"), accounts: [], data: new Uint8Array([8]) };
const SKR_FEED = "38846ec4d0dbe808091817f5c0d6ab8058e25422348ddf97db52b6c378a93bf9";
const SKR_PRICE = { feedId: SKR_FEED, price: 1_830_000n, conf: 1_216n, exponent: -8, publishTime: BigInt(Math.floor(Date.now() / 1000)), full: true };
const BTC_PRICE = { ...SOL_PRICE, feedId: "2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97", price: 6_200_000_000_000n, conf: 1_000_000_000n };
/** What the re-read of the posted account answers (null = the account is missing). */
let postedRead: typeof SKR_PRICE | null = SKR_PRICE;
/** Every puller-signed send in order: "pre:<n>" for a price pre-tx double, "tx" for a tx the builder signed itself (a reclaim). */
const sendLog: string[] = [];
/** Task 15: accounts getAccountInfo finds (default: none, so the fee wallet's USDC account is created idempotently). */
const presentAccounts = new Set<string>();
/** Task 15b: a present account's token amount (default 0), e.g. foreign dust in the puller's jl account (a Burn before the mint). */
const presentBalances = new Map<string, bigint>();

vi.mock("@/lib/puller", () => ({ pullerSigner: vi.fn(async () => puller) }));
vi.mock("@/lib/config", () => ({ config: () => ({ feeWallet: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6", heliusRpcUrl: "https://x", pythApiKey: "k" }) }));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1", lastValidBlockHeight: 1n } }) }),
  // Task 15: an address in `presentAccounts` exists (the fee wallet's USDC account, when a test says so); everything else is absent.
  getAccountInfo: (a: string) => ({ send: async () => ({ value: presentAccounts.has(a) ? { data: [tokenAcct(presentBalances.get(a) ?? 0n), "base64"], owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", lamports: 2_039_280n, executable: false } : null }) }),
  getMultipleAccounts: (addrs: string[], cfg?: { encoding?: string }) => ({ send: async () => ({ value: addrs.map((a) => (a === ALT_ADDR && cfg?.encoding === "jsonParsed"
    ? { data: { parsed: { info: { addresses: altContent, authority: null, deactivationSlot: "18446744073709551615", lastExtendedSlot: "0", lastExtendedSlotStartIndex: 0 }, type: "lookupTable" }, program: "address-lookup-table", space: 56n + 32n * BigInt(altContent.length) }, executable: false, lamports: 1n, owner: "AddressLookupTab1e1111111111111111111111111", space: 56n + 32n * BigInt(altContent.length) }
    : chainPre.has(a) ? { data: [tokenAcct(chainPre.get(a)!), "base64"] } : null)) }) }),
  simulateTransaction: (_tx: string, cfg: { accounts: { addresses: string[] } }) => ({ send: async () => { simCalls.push(cfg.accounts.addresses); return { value: { err: null, logs: [], unitsConsumed: 1n, accounts: cfg.accounts.addresses.map((a) => (simClosed.has(a) ? { lamports: simClosedLamports.get(a) ?? 0n, owner: "11111111111111111111111111111111", data: ["", "base64"] } : simPost.has(a) ? { data: [tokenAcct(simPost.get(a)!), "base64"] } : null)) } }; } }),
}) }));
vi.mock("@/lib/subscriptions", () => ({ buildTransferRecurringIx: vi.fn(async () => ({ programAddress: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44", accounts: [], data: new Uint8Array([5]) })) }));
vi.mock("@/lib/staking", async (orig) => {
  const real = await orig<typeof import("@/lib/staking")>();
  return { ...real, sharePrice: vi.fn(async () => 1_149_090_094n), buildStakeIx: vi.fn(async (a: Parameters<typeof real.buildStakeIx>[0]) => { stakes.push(a.amountRaw); return real.buildStakeIx(a); }) };
});
vi.mock("@/lib/jupiter", async (orig) => {
  const real = await orig<typeof import("@/lib/jupiter")>();
  return {
    ...real,
    getQuote: vi.fn(async (a: { outputMint: string; slippageBps?: number }) => ({ inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: a.outputMint, inAmount: "2000000", outAmount: QUOTES[a.outputMint][0],
      otherAmountThreshold: a.slippageBps === undefined ? QUOTES[a.outputMint][1] : String((BigInt(QUOTES[a.outputMint][0]) * BigInt(10_000 - a.slippageBps)) / 10_000n), priceImpactPct: "0", routePlan: [] })),
    getSwapInstructions: vi.fn(async () => ({ computeBudget: [], setup: [], swap: { programAddress: real.JUPITER_AGGREGATOR, accounts: [], data: new Uint8Array([229]) }, cleanup: null, lookupTables: [] })),
    checkSwapInstructions: vi.fn((_p: unknown, a: Record<string, unknown>) => { checks.push(a); }),
  };
});
/** The exact instruction list the builder signs, as the leash checker saw it (captured, then the real check runs). */
const signedIxs: Instruction[][] = [];
vi.mock("@/lib/venues/klend", async (orig) => {
  const real = await orig<typeof import("@/lib/venues/klend")>();
  return { ...real, klendRate: vi.fn(async () => ({ rn: 12_038n, rd: 10_000n, availableRaw: 10n ** 12n })), buildKlendDepositIxs: vi.fn(real.buildKlendDepositIxs) };
});
vi.mock("@/lib/venues/jlend", async (orig) => ({ ...(await orig<object>()), jlendRate: vi.fn(async () => ({ rn: 1_050_000_000_000n, rd: 1_000_000_000_000n })) }));
vi.mock("@/lib/pyth", async (orig) => ({
  ...(await orig<object>()),
  readSponsoredPrice: vi.fn(async (acct: string) => (acct === "7oqYpv5YbjJ2PEsNeVVB5ZEZ8ZE6ufkj8hAvAiaiftbe" ? BTC_PRICE : SOL_PRICE)),
  readPostedPrice: vi.fn(async (acct: string) => { if (!postedRead) throw new Error(`price account ${acct} is missing or not the receiver's`); return postedRead; }),
  sendPriceTxs: vi.fn(async (txs: unknown[]) => { sentPre.push(...txs); for (const t of txs) sendLog.push((t as { pre?: number }).pre !== undefined ? `pre:${(t as { pre: number }).pre}` : "tx"); }),
  buildPriceUpdate: vi.fn(async () => ({ preTxs: [{ pre: 1 }, { pre: 2 }], postIx: null, account: POSTED, closeIxs: [reclaimIx], rescueIxs: [closeVaaIx, reclaimIx], price: SKR_PRICE, preTxBytes: [790, 620] })),
}));
vi.mock("@/lib/leash", async (orig) => {
  const real = await orig<typeof import("@/lib/leash")>();
  return {
    ...real,
    // The real feed rule's answers: SKR posts (a key is configured), cbBTC/ORE/SOL legs read their pinned sponsored accounts.
    priceSourceFor: vi.fn(async (leg: number) => (leg === 2 || leg === 3 ? { kind: "none" } : leg === 0 ? { kind: "post", feedId: SKR_FEED } : leg === 7 ? { kind: "sponsored", account: "7oqYpv5YbjJ2PEsNeVVB5ZEZ8ZE6ufkj8hAvAiaiftbe" } : { kind: "sponsored", account: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE" })),
    checkLeashInstructions: vi.fn((ixs: Instruction[], a: Parameters<typeof real.checkLeashInstructions>[1]) => { signedIxs.push([...ixs]); return real.checkLeashInstructions(ixs, a); }),
    legRate: vi.fn(async (leg: number) => (leg === 2 ? { rn: 12_038n, rd: 10_000n } : leg === 5 || leg === 3 ? { rn: 1_050_000_000_000n, rd: 1_000_000_000_000n } : leg === 6 ? { rn: 1_189_400_000n, rd: 1_000_000_000n } : leg === 0 ? { rn: 1_149_090_094n, rd: 1_000_000_000n } : { rn: 1n, rd: 1n })),
  };
});

import { buildPlantingTx, simulatePlanting, tokenAmountOf, leashSwapSlippageBps, MEASURE_ALT } from "@/lib/planting";
import { sproutsAltAddresses } from "@/lib/alt";
import { getQuote, getSwapInstructions } from "@/lib/jupiter";
import { klendMinOut } from "@/lib/venues/klend";
import { USDC_MINT, WSOL_MINT, SKR_MINT } from "@/lib/constants";
import { KLEND, JLEND } from "@/lib/venues/addresses";

const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
const base = { delegator: address("DdpHknAJvVsG8HYTAN3ZmSLLiPh2GfXP2pMoJJFa1p9m"), user: USER, pullRaw: 2_000_000n, delegationPda: address("ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD"), carryIn: {} };
const ata = async (owner: string, mint: string) => (await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];

describe("buildPlantingTx: one v0 tx, one pull/settle pair (contracts 3.2)", () => {
  beforeEach(async () => {
    puller = await generateKeyPairSigner(); checks.length = 0; sentPre.length = 0; signedIxs.length = 0; vi.mocked(getQuote).mockClear(); vi.mocked(getSwapInstructions).mockClear();
    altContent = await sproutsAltAddresses(puller.address);
    if (altOn) process.env.SPROUTS_ALT = ALT_ADDR; else delete process.env.SPROUTS_ALT;
  });

  it("USDC lending on Kamino, leashed: no swap; deposit(pull - fee + USDC carry); the USDC float is watched", async () => {
    const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true, carryIn: { USDC: 500n } });
    expect(getQuote).not.toHaveBeenCalled();
    expect(b.leg).toBe(2);
    expect(b.feeRaw).toBe(10_000n);
    expect(b.minOutRaw).toBe(klendMinOut(1_990_500n, { rn: 12_038n, rd: 10_000n }));
    expect(b.leashMinOutRaw).toBe(b.minOutRaw);
    expect(b.leashMinOutRaw! >= b.leashFloorRaw!).toBe(true);
    expect(b.preRaw).toBe(0n);
    expect(b.deliveryAccount).toBe(await ata(USER, KLEND.USDC_LEND.collateralMint));
    expect(b.watched).toEqual([await ata(puller.address, USDC_MINT), await ata(puller.address, WSOL_MINT), await ata(puller.address, SKR_MINT)]);   // review I1: all three pooled floats on every leg
    expect(b.sizeBytes).toBeLessThanOrEqual(1232);
  });

  it("USDC lending on Jupiter Lend, leashed (the Day-1 fallback venue): leg 3, the jl account watched, the leftover recorded", async () => {
    const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "jupiter_lend", leashed: true, jlLeftover: 1n });
    expect(b.leg).toBe(3);
    expect(b.jlLeftover).toBe(1n);
    expect(b.watched).toEqual([await ata(puller.address, USDC_MINT), await ata(puller.address, WSOL_MINT), await ata(puller.address, SKR_MINT), await ata(puller.address, JLEND.USDC_LEND.fTokenMint)]);
  });

  it("SOL lending on Jupiter Lend, leashed: the swap asks for NO platform fee and passes NO fee account (R266, Review Focus 1)", async () => {
    const b = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "jupiter_lend", leashed: true });
    const q = vi.mocked(getQuote).mock.calls[0][0] as Record<string, unknown>;
    expect(q).not.toHaveProperty("platformFeeBps");
    expect(q.outputMint).toBe(WSOL_MINT);
    expect(vi.mocked(getSwapInstructions).mock.calls[0][0]).not.toHaveProperty("feeAccount");
    expect(checks[0]).not.toHaveProperty("feeAccount");
    expect(checks[0].destination).toBe(await ata(puller.address, WSOL_MINT));
    expect(b.minOutRaw).toBe(15_554_030n);   // shares - 1 for 16_335_000 lamports at 1.05; the floor is 15_458_437
    const pullerJl = await ata(puller.address, JLEND.SOL_LEND.fTokenMint);
    expect(b.pullerJl).toBe(pullerJl);
    expect(b.watched).toEqual([await ata(puller.address, USDC_MINT), await ata(puller.address, WSOL_MINT), await ata(puller.address, SKR_MINT), pullerJl]);
    expect(b.deliveryAccount).toBe(await ata(USER, JLEND.SOL_LEND.fTokenMint));
  });

  it("hSOL, leashed: the coin leg pays 50 bps; ruling A (corrected): room above 100 bps keeps the 100 bps quote; 100 bps under the floor tightens; a route under the floor skips", async () => {
    const b = await buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: true });
    expect(vi.mocked(getQuote).mock.calls[0][0]).toMatchObject({ platformFeeBps: 50 });
    expect(checks[0]).toHaveProperty("feeAccount");
    expect(b.leashFloorRaw).toBe(13_646_678n);
    // roomBps = (13_843_000 - 13_646_678 - 1) x 10_000 / 13_843_000 = 141 > 100: capped at 100, so the first quote stands (no re-quote)
    // and Jupiter's minimum stays expected x 0.99 = 13_704_570 (the fixture's 13_705_000), never loosened toward the floor.
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(b.leashMinOutRaw).toBe(13_705_000n);
    expect(b.minOutRaw).toBe(13_705_000n);
    // A route at 13_700_000: 100 bps (13_563_000) would be under the floor, so it re-quotes at roomBps 38 -> 13_700_000 x 9_962 / 10_000 = 13_647_940.
    QUOTES.he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A = ["13700000", "13563000"];
    vi.mocked(getQuote).mockClear();
    const tight = await buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: true });
    expect(vi.mocked(getQuote).mock.calls[1][0]).toMatchObject({ slippageBps: 38, platformFeeBps: 50 });
    expect(tight.leashMinOutRaw).toBe(13_647_940n);
    // The route itself under the floor: skip, no second quote.
    QUOTES.he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A = ["13646000", "13510000"];
    vi.mocked(getQuote).mockClear();
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: true })).rejects.toThrow(/hSOL: route under floor \(route 13646000 < floor 13646678\)/);
    expect(getQuote).toHaveBeenCalledTimes(1);
    QUOTES.he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A = ["13843000", "13705000"];
  });

  it("ruling A, cbBTC-like: expected 1_162 vs floor 1_150 builds with a minimum >= 1_150; expected 1_148 skips 'route under floor'", async () => {
    QUOTES.cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij = ["3225", "3193"];
    const floor = (await buildPlantingTx({ ...base, asset: "cbBTC", venue: null, leashed: true })).leashFloorRaw as bigint;
    expect(floor).toBe(3_178n);
    // Scale the route around the real floor: +12 raw (the 1_162 vs 1_150 case) and -2 raw (the 1_148 vs 1_150 case).
    QUOTES.cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij = [String(floor + 12n), String(floor - 20n)];
    const ok = await buildPlantingTx({ ...base, asset: "cbBTC", venue: null, leashed: true });
    expect(ok.leashMinOutRaw as bigint).toBeGreaterThanOrEqual(floor);
    expect(ok.leashMinOutRaw as bigint).toBeLessThanOrEqual(floor + 12n);
    QUOTES.cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij = [String(floor - 2n), String(floor - 34n)];
    await expect(buildPlantingTx({ ...base, asset: "cbBTC", venue: null, leashed: true })).rejects.toThrow(/route under floor/);
    QUOTES.cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij = ["3225", "3193"];
  });

  it("ruling A: a re-quote whose minimum still lands under the floor (the route moved) skips; an unleashed coin leg keeps one quote at 100 bps", async () => {
    vi.mocked(getQuote).mockImplementationOnce(async (a) => ({ inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: a.outputMint, inAmount: "2000000", outAmount: "13700000", otherAmountThreshold: "13563000", priceImpactPct: "0", routePlan: [] }) as never)
      .mockImplementationOnce(async (a) => ({ inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: a.outputMint, inAmount: "2000000", outAmount: "13700000", otherAmountThreshold: "13506000", priceImpactPct: "0", routePlan: [] }) as never);
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: true })).rejects.toThrow(/route under floor \(minimum 13506000 < floor 13646678 after re-quote at 38 bps\)/);
    vi.mocked(getQuote).mockClear();
    const u = await buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: false });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getQuote).mock.calls[0][0]).not.toHaveProperty("slippageBps");
    expect(u.minOutRaw).toBe(13_705_000n);
    expect(u.leashFloorRaw).toBeNull();
  });

  it("Task 15b: an ample SOL lending route keeps the 100 bps quote (one quote, no slippageBps) even leashed", async () => {
    await buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "jupiter_lend", leashed: true });
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getQuote).mock.calls[0][0]).not.toHaveProperty("slippageBps");
  });

  it("cbBTC, leashed: its pinned sponsored account prices it; nothing is posted, nothing to clean up", async () => {
    const b = await buildPlantingTx({ ...base, asset: "cbBTC", venue: null, leashed: true });
    expect(sentPre).toEqual([]);
    expect(b.cleanup).toEqual([]);
    expect(b.priceTxBytes).toEqual([]);
    expect(b.leashFloorRaw).toBe(3_178n);
    expect(b.leashMinOutRaw).toBe(3_193n);   // ruling A (corrected): roomBps 142 > 100, so the 100 bps minimum stands (3_225 x 0.99)
  });

  it("SKR, leashed: the delivery check stays on the puller's SKR float; leash min_out is shares", async () => {
    const b = await buildPlantingTx({ ...base, asset: "SKR", venue: null, leashed: true, carryIn: { SKR: 1234n } });
    expect(b.deliveryAccount).toBe(await ata(puller.address, SKR_MINT));
    // The floor from the posted price: net 1_970_000 (2 USDC less 50 + 100 bps) x 1e9 x 1e6 x 1e2 / (1_149_090_094 x (1_830_000 - 1_216)),
    // ceil = 93_745_350 shares. Ruling A (corrected): in SKR that is ceil((93_745_350 + 1) x 1.149090094) = 107_721_855, under the
    // 100 bps minimum 108_196_721: roomBps = (109_289_617 - 107_721_855 - 1) x 10_000 / 109_289_617 = 143 > 100, so one quote stands.
    expect(b.leashFloorRaw).toBe(93_745_350n);
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(b.leashMinOutRaw).toBe(94_158_604n);   // 108_196_721 x 1e9 / 1_149_090_094 - 1
    expect(b.leashMinOutRaw).toBe((b.minOutRaw * 1_000_000_000n) / 1_149_090_094n - 1n);
  });

  it("unleashed (today's links): transferRecurring in the pull slot, no leash instruction, no leg", async () => {
    const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: false });
    expect(b.leg).toBeNull();
    expect(b.preRaw).toBeNull();
    expect(b.leashMinOutRaw).toBeNull();
  });

  it("refuses a venue on a coin leg and a lending leg without one", async () => {
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: "kamino_klend", leashed: false })).rejects.toThrow(/venue/);
    await expect(buildPlantingTx({ ...base, asset: "USDC_LEND", venue: null, leashed: false })).rejects.toThrow(/venue/);
  });
});

describe("tokenAmountOf", () => {
  it("decodes a token account's amount and refuses a short buffer", () => {
    const t = Buffer.alloc(165); t.writeBigUInt64LE(123n, 64);
    expect(tokenAmountOf(new Uint8Array(t))).toBe(123n);
    expect(tokenAmountOf(null)).toBe(0n);
    expect(() => tokenAmountOf(new Uint8Array(10))).toThrow(/not a token account/);
  });
});

describe("T9 carry-ins at the composition", () => {
  const A_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const LEASH = "GyBmDLN72kg6xwAnZfj9c7fjeaJ3GvhkHNhFns83f8f7";
  const KLEND_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
  beforeEach(async () => {
    puller = await generateKeyPairSigner(); checks.length = 0; sentPre.length = 0; signedIxs.length = 0; vi.mocked(getQuote).mockClear();
    altContent = await sproutsAltAddresses(puller.address);
    process.env.SPROUTS_ALT = ALT_ADDR;
    // The brief's legRate mock has no leg 4 (K-Lend SOL); give it the K-Lend mock's rate so the floor reads the same reserve.
    const { legRate } = await import("@/lib/leash");
    const base4 = vi.mocked(legRate).getMockImplementation()!;
    if (!(base4 as { leg4?: boolean }).leg4) {
      const withLeg4 = Object.assign(async (leg: number) => (leg === 4 ? { rn: 12_038n, rd: 10_000n } : base4(leg as never)), { leg4: true });
      vi.mocked(legRate).mockImplementation(withLeg4 as never);
    }
  });
  const depositOf = (ixs: Instruction[]) => {
    const d = ixs.filter((ix) => ix.programAddress === KLEND_ID).map((ix) => Buffer.from(ix.data!)).find((x) => x.length === 16);
    return d!.readBigUInt64LE(8);
  };

  it("BIND THE K-LEND DEPOSIT: the signed deposit is exactly the pull less the fee plus THIS user's carry (USDC), the swap minimum plus carry (SOL)", async () => {
    await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true, carryIn: { USDC: 500n, WSOL: 7n } });
    expect(depositOf(signedIxs[0])).toBe(1_990_500n);   // Task 15: the pull less the 0.5% fee (10_000), plus the carry
    await buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "kamino_klend", leashed: true, carryIn: { WSOL: 9n, USDC: 500n } });
    expect(depositOf(signedIxs[1])).toBe(16_335_009n);
  });

  it("BIND THE K-LEND DEPOSIT: a deposit over the leg's amount (drawing other users' pooled float) is refused before signing", async () => {
    const { buildKlendDepositIxs } = await import("@/lib/venues/klend");
    const real = (await vi.importActual<typeof import("@/lib/venues/klend")>("@/lib/venues/klend")).buildKlendDepositIxs;
    vi.mocked(buildKlendDepositIxs).mockImplementationOnce(async (a) => real({ ...a, amountRaw: a.amountRaw + 1_000_000n }));
    await expect(buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true, carryIn: {} })).rejects.toThrow(/deposit of 2990000, not the leg's 1990000/);
  });

  it("the user's receipt ATA is created in the same tx BEFORE the pull (the program's pre then reads it like readReceipt's 0)", async () => {
    const cases = [
      { asset: "USDC_LEND", venue: "kamino_klend", mint: KLEND.USDC_LEND.collateralMint },
      { asset: "USDC_LEND", venue: "jupiter_lend", mint: JLEND.USDC_LEND.fTokenMint },
      { asset: "SOL_LEND", venue: "kamino_klend", mint: KLEND.SOL_LEND.collateralMint },
      { asset: "SOL_LEND", venue: "jupiter_lend", mint: JLEND.SOL_LEND.fTokenMint },
      { asset: "hSOL", venue: null, mint: "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A" },
      { asset: "cbBTC", venue: null, mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij" },
    ] as const;
    for (const [i, c] of cases.entries()) {
      const b = await buildPlantingTx({ ...base, asset: c.asset, venue: c.venue, leashed: true });
      const ixs = signedIxs[i];
      const receipt = await ata(USER, c.mint);
      const create = ixs.findIndex((ix) => ix.programAddress === A_TOKEN && ix.accounts?.[1]?.address === receipt);
      const pull = ixs.findIndex((ix) => ix.programAddress === LEASH && ix.data?.[0] === 0);
      expect(create, `${c.asset}/${c.venue}`).toBeGreaterThanOrEqual(0);
      expect(create, `${c.asset}/${c.venue}`).toBeLessThan(pull);
      expect(b.preRaw).toBe(0n);
      expect(b.leashMinOutRaw! > 0n).toBe(true);
    }
  });

  it("min_out > 0 always: a zero swap minimum is refused before signing", async () => {
    QUOTES.he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A = ["13843000", "0"];
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: false })).rejects.toThrow(/min_out 0 is not positive/);
    QUOTES.he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A = ["13843000", "13705000"];
  });

  it("Step 0 kept: USDC lending never quotes; every swap check carries a pinned destination; SOL lending swaps only into the puller's WSOL", async () => {
    await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: false });
    await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "jupiter_lend", leashed: false });
    expect(getQuote).not.toHaveBeenCalled();
    expect(checks).toEqual([]);
    for (const venue of ["kamino_klend", "jupiter_lend"] as const) await buildPlantingTx({ ...base, asset: "SOL_LEND", venue, leashed: false });
    QUOTES.storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR = ["300000000000", "297000000000"];   // stORE: not in the brief's quote table
    for (const asset of ["SKR", "stORE", "hSOL", "cbBTC"] as const) await buildPlantingTx({ ...base, asset, venue: null, leashed: false });
    expect(checks.length).toBe(6);
    expect(checks[0].destination).toBe(await ata(puller.address, WSOL_MINT));
    expect(checks[1].destination).toBe(await ata(puller.address, WSOL_MINT));
    for (const c of checks) expect(typeof c.destination === "string" && (c.destination as string).length > 0).toBe(true);
  });

  it("the run's price options reach priceSourceFor (on-chain conf cap and max age, no second wait)", async () => {
    const { priceSourceFor } = await import("@/lib/leash");
    vi.mocked(priceSourceFor).mockClear();
    await buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: true, priceOpts: { waitS: 0, confCapBps: 150, maxAgeS: 90 } });
    expect(vi.mocked(priceSourceFor).mock.calls[0]).toEqual([6, undefined, 0, { confCapBps: 150, maxAgeS: 90 }]);
  });

  it("without SPROUTS_ALT a Jupiter Lend leg does not fit in 1232 bytes and is refused (the ALT is required for it)", async () => {
    delete process.env.SPROUTS_ALT;
    await expect(buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "jupiter_lend", leashed: true })).rejects.toThrow(/over 1232/);
    process.env.SPROUTS_ALT = ALT_ADDR;
  });
});

// I1 (T9 review, fix round 1): the R207 #2 / #4 tests the brief's rewrite dropped, restored on today's live unleashed path.
describe("buildPlantingTx, unleashed SKR and wallet coins (R207 #2, #4; restored)", () => {
  beforeEach(async () => {
    puller = await generateKeyPairSigner(); checks.length = 0; stakes.length = 0;
    altContent = await sproutsAltAddresses(puller.address);
    process.env.SPROUTS_ALT = ALT_ADDR;
  });
  it("stakes the quote's minimum plus the carried remainder, and checks delivery into the puller's own SKR account", async () => {
    const b = await buildPlantingTx({ ...base, asset: "SKR", venue: null, leashed: false, carryIn: { SKR: 1234n } });
    expect(stakes).toEqual([108_196_721n + 1234n]);
    expect(b.minOutRaw).toBe(108_196_721n);
    expect(checks[0]).toMatchObject({ puller: puller.address, destination: await ata(puller.address, SKR_MINT), wsolAccount: await ata(puller.address, WSOL_MINT) });
    expect(checks[0].destinationOwner).toBeUndefined();
  });
  it("without a carry stakes the minimum alone; another kind's carry does not leak into the stake", async () => {
    await buildPlantingTx({ ...base, asset: "SKR", venue: null, leashed: false, carryIn: {} });
    await buildPlantingTx({ ...base, asset: "SKR", venue: null, leashed: false, carryIn: { USDC: 99n, WSOL: 5n } });
    expect(stakes).toEqual([108_196_721n, 108_196_721n]);
  });
  it("a wallet coin is checked for delivery into the user's token account, whose owner may get an account created; nothing is staked", async () => {
    await buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: false, carryIn: { SKR: 1234n } });
    expect(stakes).toEqual([]);
    expect(checks[0]).toMatchObject({ destination: await ata(USER, "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A"), destinationOwner: USER });
  });
  it("M3: a negative carry is refused before anything is built", async () => {
    await expect(buildPlantingTx({ ...base, asset: "SKR", venue: null, leashed: false, carryIn: { SKR: -1n } })).rejects.toThrow(/carry SKR -1 is negative/);
    await expect(buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: false, carryIn: { USDC: -5n } })).rejects.toThrow(/negative/);
    expect(stakes).toEqual([]);
  });
  it("M1: the fee account every coin leg's swap carries is in the Sprouts ALT", async () => {
    await buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: false, carryIn: {} });
    expect(altContent).toContain(checks[0].feeAccount);
  });
});

describe("simulatePlanting: the delivery account and every watched account, before and after (restored + watched)", () => {
  beforeEach(async () => {
    puller = await generateKeyPairSigner(); simCalls.length = 0; chainPre.clear(); simPost.clear(); simClosed.clear(); simClosedLamports.clear();
    altContent = await sproutsAltAddresses(puller.address);
    process.env.SPROUTS_ALT = ALT_ADDR;
  });
  it("SKR: reads the puller's SKR account (the delivery) before and as the simulation leaves it; the USDC and WSOL floats are watched (review I1)", async () => {
    const b = await buildPlantingTx({ ...base, asset: "SKR", venue: null, leashed: false, carryIn: {} });
    const usdc = await ata(puller.address, USDC_MINT);
    const wsol = await ata(puller.address, WSOL_MINT);
    chainPre.set(b.deliveryAccount, 5_000n); simPost.set(b.deliveryAccount, 5_200n); chainPre.set(usdc, 70n); simPost.set(usdc, 70n); chainPre.set(wsol, 3n); simPost.set(wsol, 3n);
    const s = await simulatePlanting(b);
    expect([b.usdcFloat, b.wsolFloat, b.skrFloat]).toEqual([usdc, wsol, null]);
    expect(b.deliveryAccount).toBe(await ata(puller.address, SKR_MINT));
    expect(simCalls[0]).toEqual([b.deliveryAccount, usdc, wsol]);
    expect(s.delivery).toEqual({ pre: 5_000n, post: 5_200n });
    expect(s.watched).toEqual({ [usdc]: { pre: 70n, post: 70n }, [wsol]: { pre: 3n, post: 3n } });
  });
  it("a wallet coin's account created in the transaction starts at zero", async () => {
    const b = await buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: false, carryIn: {} });
    simPost.set(b.deliveryAccount, 13_843_000n);
    expect((await simulatePlanting(b)).delivery).toEqual({ pre: 0n, post: 13_843_000n });
  });
  it("SOL on Jupiter Lend: each watched account keeps its own pre/post; the closed puller jl account reads post null", async () => {
    const b = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "jupiter_lend", leashed: false, carryIn: {} });
    const [usdc, wsol, skr, jl] = b.watched;
    expect(b.watched).toEqual([await ata(puller.address, USDC_MINT), await ata(puller.address, WSOL_MINT), await ata(puller.address, SKR_MINT), await ata(puller.address, JLEND.SOL_LEND.fTokenMint)]);
    expect([b.usdcFloat, b.wsolFloat, b.skrFloat]).toEqual([usdc, wsol, skr]);
    chainPre.set(usdc, 9n); chainPre.set(wsol, 4_000n); chainPre.set(jl, 7n);   // the user's jl account is absent before (created in the tx)
    simPost.set(b.deliveryAccount, 15_554_030n); simPost.set(usdc, 9n); simPost.set(wsol, 4_003n);   // jl absent after: closed
    const s = await simulatePlanting(b);
    expect(simCalls[0]).toEqual([b.deliveryAccount, usdc, wsol, skr, jl]);
    // T7 carry: the user's jl account (the delivery account, created by this tx) reads 0 before, not "missing".
    expect(s.delivery).toEqual({ pre: 0n, post: 15_554_030n });
    expect(s.watched).toEqual({ [usdc]: { pre: 9n, post: 9n }, [wsol]: { pre: 4_000n, post: 4_003n }, [skr]: { pre: null, post: null }, [jl]: { pre: 7n, post: null } });
  });
  it("Task 12 measureAlt: the in-memory ALT sizes a planting exactly as the same addresses on chain at SPROUTS_ALT do, and never reads SPROUTS_ALT", async () => {
    const onChain = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "jupiter_lend", leashed: true, carryIn: {} });
    delete process.env.SPROUTS_ALT;
    await expect(buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "jupiter_lend", leashed: true, carryIn: {} })).rejects.toThrow(/over 1232/);   // without any ALT
    const measured = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "jupiter_lend", leashed: true, carryIn: {}, measureAlt: altContent as never });
    expect(measured.sizeBytes).toBe(onChain.sizeBytes);
    expect(measured.lookupTables).toEqual([MEASURE_ALT]);
    process.env.SPROUTS_ALT = ALT_ADDR;
    const ignoresEnv = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "jupiter_lend", leashed: true, carryIn: {}, measureAlt: altContent as never });
    expect(ignoresEnv.lookupTables).toEqual([MEASURE_ALT]);
  });
  it("Task 12: a jl account the transaction closes comes back as a 0-byte System account (mainnet RPC) and reads post null, not a throw", async () => {
    const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "jupiter_lend", leashed: false, carryIn: {} });
    const [usdc, , , jl] = b.watched;
    chainPre.set(usdc, 9n); simPost.set(usdc, 9n); chainPre.set(jl, 0n); simClosed.add(jl); simPost.set(b.deliveryAccount, 830_000n);
    const s = await simulatePlanting(b);
    expect(s.watched?.[jl]).toEqual({ pre: 0n, post: null });
    expect(s.delivery).toEqual({ pre: 0n, post: 830_000n });
  });
  it("Task 12 review M1: a 0-byte account reads closed ONLY at the puller's jl account with lamports 0; anywhere else, or with lamports, it throws", async () => {
    const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "jupiter_lend", leashed: false, carryIn: {} });
    const [usdc, , , jl] = b.watched;
    expect(jl).toBe(b.pullerJl);
    // The USDC float comes back 0-byte: a misreported read must not pass the float guard as "absent".
    chainPre.set(usdc, 9n); simClosed.add(usdc); chainPre.set(jl, 0n); simClosed.add(jl); simPost.set(b.deliveryAccount, 830_000n);
    await expect(simulatePlanting(b)).rejects.toThrow();
    // The jl account 0-byte but still holding lamports: not a close either.
    simClosed.delete(usdc); simPost.set(usdc, 9n); simClosedLamports.set(jl, 2_039_280n);
    await expect(simulatePlanting(b)).rejects.toThrow();
    // Positive control: lamports 0 at the jl account is the close.
    simClosedLamports.delete(jl);
    expect((await simulatePlanting(b)).watched?.[jl]).toEqual({ pre: 0n, post: null });
  });
  it("a watched account absent before and present after reads pre null, post its amount", async () => {
    const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "jupiter_lend", leashed: false, carryIn: {} });
    const [usdc, wsol, skr, jl] = b.watched;
    chainPre.set(usdc, 9n); simPost.set(usdc, 9n); simPost.set(jl, 1n);
    const s = await simulatePlanting(b);
    expect(s.watched).toEqual({ [usdc]: { pre: 9n, post: 9n }, [wsol]: { pre: null, post: null }, [skr]: { pre: null, post: null }, [jl]: { pre: null, post: 1n } });
  });
});

import { getTransferInstruction, getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token";
import { readSponsoredPrice } from "@/lib/pyth";
import { checkPlantingInstructions } from "@/lib/planting";
import { AccountRole } from "@solana/kit";

describe("Task 11 carry-ins at the builder: the second price read, the whole-transaction allowlist", () => {
  beforeEach(async () => {
    puller = await generateKeyPairSigner(); checks.length = 0; sentPre.length = 0; signedIxs.length = 0; vi.mocked(getQuote).mockClear(); vi.mocked(getSwapInstructions).mockClear();
    altContent = await sproutsAltAddresses(puller.address);
    process.env.SPROUTS_ALT = ALT_ADDR;
  });
  const swapWith = async (setup: Instruction[]) => {
    const { JUPITER_AGGREGATOR } = await vi.importActual<typeof import("@/lib/jupiter")>("@/lib/jupiter");
    vi.mocked(getSwapInstructions).mockResolvedValueOnce({ computeBudget: [], setup, swap: { programAddress: JUPITER_AGGREGATOR as never, accounts: [], data: new Uint8Array([229]) }, cleanup: null, lookupTables: [] } as never);
  };

  // 5. T9 review M5.
  it("M5: the second sponsored read (the floor's) is refused when stale, not Full, another feed, or over the on-chain conf cap", async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const hsol = { ...base, asset: "hSOL" as const, venue: null, leashed: true };
    vi.mocked(readSponsoredPrice).mockResolvedValueOnce({ ...SOL_PRICE, publishTime: now - 45n });
    await expect(buildPlantingTx(hsol)).rejects.toThrow(/sponsored price read for the floor is 45 s old \(usable under 40 s\)/);
    vi.mocked(readSponsoredPrice).mockResolvedValueOnce({ ...SOL_PRICE, full: false });
    await expect(buildPlantingTx(hsol)).rejects.toThrow(/not Full/);
    vi.mocked(readSponsoredPrice).mockResolvedValueOnce({ ...SOL_PRICE, feedId: "2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97" });
    await expect(buildPlantingTx(hsol)).rejects.toThrow(/not the pinned SOL feed/);
    await expect(buildPlantingTx({ ...hsol, priceOpts: { waitS: 0, confCapBps: 5, maxAgeS: 60 } })).rejects.toThrow(/confidence .* is over 5 bps/);
    // Positive control: the same leg with the on-chain max age of 90 takes a 45 s old price.
    vi.mocked(readSponsoredPrice).mockResolvedValueOnce({ ...SOL_PRICE, publishTime: now - 45n });
    await expect(buildPlantingTx({ ...hsol, priceOpts: { waitS: 0, confCapBps: 100, maxAgeS: 90 } })).resolves.toMatchObject({ leg: 6 });
  });

  // 8. Task 7 carry: the whole-transaction allowlist.
  it("allowlist: a Token Transfer out of the puller's USDC float anywhere in the transaction is refused", async () => {
    const usdc = await ata(puller.address, USDC_MINT);
    await swapWith([getTransferInstruction({ source: usdc, destination: await ata(base.delegator, USDC_MINT), authority: puller, amount: 1n }) as Instruction]);
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: false })).rejects.toThrow(/Planting refused: Token instruction 3 on .* is not allowed/);
  });

  it("allowlist: an ATA create for a third party, or for this user's account of another mint, is refused", async () => {
    await swapWith([getCreateAssociatedTokenIdempotentInstruction({ payer: puller, ata: await ata(base.delegator, SKR_MINT), owner: base.delegator, mint: SKR_MINT }) as Instruction]);
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: false })).rejects.toThrow(/account creation for .* neither the puller nor this user/);
    await swapWith([getCreateAssociatedTokenIdempotentInstruction({ payer: puller, ata: await ata(USER, SKR_MINT), owner: USER, mint: SKR_MINT }) as Instruction]);
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: false })).rejects.toThrow(/this user's SKR.*not this leg's coin or receipt/);
    // Positive control: the puller's own account of any mint (a route's intermediate) and this user's hSOL account pass.
    await swapWith([getCreateAssociatedTokenIdempotentInstruction({ payer: puller, ata: await ata(puller.address, SKR_MINT), owner: puller.address, mint: SKR_MINT }) as Instruction,
      getCreateAssociatedTokenIdempotentInstruction({ payer: puller, ata: await ata(USER, "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A"), owner: USER, mint: address("he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A") }) as Instruction]);
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: false })).resolves.toBeTruthy();
  });

  it("allowlist: a program the leg does not use is refused, and so is a second call of one it does", async () => {
    await swapWith([{ programAddress: address("11111111111111111111111111111111"), accounts: [{ address: puller.address, role: AccountRole.WRITABLE_SIGNER }], data: new Uint8Array([2, 0, 0, 0]) }]);
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: false })).rejects.toThrow(/program 11111111111111111111111111111111 is not allowed in a hSOL planting/);
    const stake = { programAddress: address("SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ"), accounts: [], data: new Uint8Array([1]) };
    const pull = { programAddress: address("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44"), accounts: [], data: new Uint8Array([5]) };
    const swap = { programAddress: address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"), accounts: [], data: new Uint8Array([229]) };
    const a = { puller: puller.address, user: USER, asset: "SKR" as const, venue: null, leashed: false, pullerWsol: await ata(puller.address, WSOL_MINT), pullerJl: null, userMints: [], posted: false, fee: null };
    expect(() => checkPlantingInstructions([pull, swap, stake], a)).not.toThrow();
    expect(() => checkPlantingInstructions([pull, swap, stake, stake], a)).toThrow(/2 instructions of SKRskrmt.*expected 1/);
    expect(() => checkPlantingInstructions([swap, stake], a)).toThrow(/0 instructions of De1eg.*expected 1/);
  });

  it("allowlist: a venue builder that adds a Token Transfer on another account than the puller's jl account is refused (K-Lend)", async () => {
    const { buildKlendDepositIxs } = await import("@/lib/venues/klend");
    const real = (await vi.importActual<typeof import("@/lib/venues/klend")>("@/lib/venues/klend")).buildKlendDepositIxs;
    const usdc = await ata(puller.address, USDC_MINT);
    vi.mocked(buildKlendDepositIxs).mockImplementationOnce(async (x) => [...(await real(x)), getTransferInstruction({ source: usdc, destination: await ata(USER, USDC_MINT), authority: puller, amount: 5n }) as Instruction]);
    await expect(buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true })).rejects.toThrow(/Planting refused: Token instruction 3/);
  });
});

import { getCloseAccountInstruction } from "@solana-program/token";
import { LEG_SPEC, legAccounts } from "@/lib/leash";

describe("Task 11 fix round 1 at the builder (review I1; leash e823503 feed pins)", () => {
  beforeEach(async () => {
    puller = await generateKeyPairSigner(); checks.length = 0; sentPre.length = 0; signedIxs.length = 0; vi.mocked(getQuote).mockClear(); vi.mocked(getSwapInstructions).mockClear();
    altContent = await sproutsAltAddresses(puller.address);
    process.env.SPROUTS_ALT = ALT_ADDR;
  });
  const swapWith = async (setup: Instruction[], cleanup: Instruction | null = null) => {
    const { JUPITER_AGGREGATOR } = await vi.importActual<typeof import("@/lib/jupiter")>("@/lib/jupiter");
    vi.mocked(getSwapInstructions).mockResolvedValueOnce({ computeBudget: [], setup, swap: { programAddress: JUPITER_AGGREGATOR as never, accounts: [], data: new Uint8Array([229]) }, cleanup, lookupTables: [] } as never);
  };

  it("I1: a CloseAccount of the pooled wSOL account is refused by the whole-transaction allowlist on every leg, even paid to the puller", async () => {
    const wsol = await ata(puller.address, WSOL_MINT);
    const close = getCloseAccountInstruction({ account: wsol, destination: puller.address, owner: puller }) as Instruction;
    for (const asset of ["SKR", "hSOL"] as const) {
      await swapWith([], close);
      await expect(buildPlantingTx({ ...base, asset, venue: null, leashed: false })).rejects.toThrow(/Planting refused: Token instruction 9 on .* is not allowed/);
    }
  });

  it("I1: every swap's checker is told the source must be the puller's USDC account", async () => {
    QUOTES.storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR = ["300000000000", "297000000000"];
    for (const asset of ["SKR", "stORE", "hSOL", "cbBTC"] as const) await buildPlantingTx({ ...base, asset, venue: null, leashed: false });
    await buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "kamino_klend", leashed: false });
    expect(checks.length).toBe(5);
    for (const c of checks) expect(c.source).toBe(await ata(puller.address, USDC_MINT));
  });

  it("feed pins (leash e823503): legs 1, 4-7 pin the sponsored account; 0, 2, 3 none; any other price account is refused before signing", async () => {
    const ORE = "GYYQ8gbX4Tndc4WMJ9jSjZTePTvbmgRRxByt54ZQYqvZ", SOL = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE", BTC = "7oqYpv5YbjJ2PEsNeVVB5ZEZ8ZE6ufkj8hAvAiaiftbe";
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((l) => LEG_SPEC[l as 0].feedAccount)).toEqual([null, ORE, null, null, SOL, SOL, SOL, BTC]);
    await expect(legAccounts({ leg: 6, user: USER, priceAccount: address(BTC) })).rejects.toThrow(/is not the pinned 7UVim/);
    await expect(legAccounts({ leg: 6, user: USER, priceAccount: address(SOL) })).resolves.toMatchObject({ price: SOL });
    const { priceSourceFor } = await import("@/lib/leash");
    vi.mocked(priceSourceFor).mockResolvedValueOnce({ kind: "sponsored", account: address(BTC) });   // a sponsored source on the wrong account
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: true })).rejects.toThrow(/not the pinned/);
  });
});

describe("leashSwapSlippageBps (ruling A, Task 12)", () => {
  const minAt = (out: bigint, bps: number) => (out * BigInt(10_000 - bps)) / 10_000n;
  it("room above 100 bps: capped at 100, so the minimum is expected x 0.99 (never loosened toward the floor)", () => {
    expect(leashSwapSlippageBps(10_000n, 9_000n)).toBe(100);   // roomBps 999
    expect(minAt(10_000n, 100)).toBe(9_900n);
    expect(leashSwapSlippageBps(13_843_000n, 13_646_678n)).toBe(100);   // roomBps 141
  });
  it("never more than 100 bps, for any expected >= floor", () => {
    for (let out = 1n; out <= 5_000n; out += 3n) for (let f = 0n; f <= out; f += out / 37n + 1n) expect(leashSwapSlippageBps(out, f) as number).toBeLessThanOrEqual(100);
    expect(leashSwapSlippageBps(10n ** 18n, 1n)).toBe(100);
  });
  it("expected 1_162 vs floor 1_150: a slippage whose minimum is >= 1_150 and <= 1_162", () => {
    const bps = leashSwapSlippageBps(1_162n, 1_150n) as number;
    expect(bps).toBe(94);   // (1_162 - 1_151) x 10_000 / 1_162 = 94.6
    expect(minAt(1_162n, bps)).toBe(1_151n);   // 1_162 x 9_906 / 10_000 = 1_151.07: the floor plus the one-unit margin
    expect(minAt(1_162n, bps + 1)).toBeGreaterThanOrEqual(1_150n);   // the one-unit margin
  });
  it("expected under the floor: null (route under floor)", () => {
    expect(leashSwapSlippageBps(1_148n, 1_150n)).toBeNull();
    expect(leashSwapSlippageBps(0n, 0n)).toBeNull();
  });
  it("expected at or one above the floor: 0 bps (the minimum is the route itself)", () => {
    expect(leashSwapSlippageBps(1_150n, 1_150n)).toBe(0);
    expect(leashSwapSlippageBps(1_151n, 1_150n)).toBe(0);
  });
  it("the minimum is never under the floor nor under expected less 100 bps, across a sweep", () => {
    for (let out = 1_000n; out <= 3_000n; out += 7n) for (const f of [out / 2n, (out * 985n) / 1000n, out - 2n, out]) {
      const bps = leashSwapSlippageBps(out, f) as number;
      expect(minAt(out, bps)).toBeGreaterThanOrEqual(f);
      expect(minAt(out, bps)).toBeGreaterThanOrEqual(minAt(out, 100));
      expect(minAt(out, bps)).toBeLessThanOrEqual(out);
    }
  });
});

import { buildPriceUpdate, readPostedPrice, sendPriceTxs } from "@/lib/pyth";
import { LEASH_PROGRAM } from "@/lib/constants";

describe("the posted price (SKR, leg 0; contracts 3.2 row 2b, 10 item 15): pre-txs, re-read, pull/settle, reclaim", () => {
  const skr = { ...base, asset: "SKR" as const, venue: null, leashed: true };
  beforeEach(async () => {
    puller = await generateKeyPairSigner(); checks.length = 0; sentPre.length = 0; signedIxs.length = 0; sendLog.length = 0; postedRead = { ...SKR_PRICE, publishTime: BigInt(Math.floor(Date.now() / 1000)) };
    vi.mocked(getQuote).mockClear(); vi.mocked(sendPriceTxs).mockClear(); vi.mocked(readPostedPrice).mockClear(); vi.mocked(buildPriceUpdate).mockClear();
    altContent = await sproutsAltAddresses(puller.address);
    process.env.SPROUTS_ALT = ALT_ADDR;
  });

  it("the pre-txs land first, then the posted account is re-read (the floor's price), then the swap is quoted; pull and settle name that account", async () => {
    const b = await buildPlantingTx(skr);
    expect(vi.mocked(buildPriceUpdate)).toHaveBeenCalledWith(expect.objectContaining({ puller, feedId: SKR_FEED, maxAgeS: 60, confCapBps: 100 }));
    expect(sendLog).toEqual(["pre:1", "pre:2"]);   // in order; nothing else sent (the reclaim waits for the planting)
    const order = (f: { mock: { invocationCallOrder: number[] } }) => f.mock.invocationCallOrder[0];
    expect(order(vi.mocked(sendPriceTxs))).toBeLessThan(order(vi.mocked(readPostedPrice)));
    expect(order(vi.mocked(readPostedPrice))).toBeLessThan(order(vi.mocked(getQuote)));
    expect(vi.mocked(readPostedPrice)).toHaveBeenCalledWith(POSTED);
    // The planting: one pull and one settle, both reading the posted account; no receiver instruction (post_update rode the pre-txs).
    const ixs = signedIxs[signedIxs.length - 1];
    const leash = ixs.filter((ix) => ix.programAddress === LEASH_PROGRAM);
    expect(leash).toHaveLength(2);
    for (const ix of leash) expect(ix.accounts!.map((x) => x.address)).toContain(POSTED);
    expect(ixs.some((ix) => ix.programAddress === RECEIVER)).toBe(false);
    expect(b.leashFloorRaw).toBe(93_745_350n);   // from the re-read (SKR_PRICE), the derivation in the SKR test above
    expect(b.cleanup).toEqual([reclaimIx]);
    expect(b.priceTxBytes).toEqual([790, 620]);
    expect(b.postedPrice).toEqual(postedRead);
    expect(b.sizeBytes).toBeLessThanOrEqual(1232);
  });

  it("the run's on-chain conf cap and max age reach the post (judged on Hermes's answer before anything is sent)", async () => {
    await buildPlantingTx({ ...skr, priceOpts: { waitS: 0, confCapBps: 80, maxAgeS: 50 } });
    expect(vi.mocked(buildPriceUpdate)).toHaveBeenCalledWith(expect.objectContaining({ feedId: SKR_FEED, maxAgeS: 50, confCapBps: 80 }));
  });

  it("the re-read is judged as the program will (missing, not Full, another feed, stale, over the cap): the leg skips and the price account is reclaimed", async () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const cases: [typeof postedRead, RegExp][] = [
      [null, /missing or not the receiver's/],
      [{ ...SKR_PRICE, full: false }, /posted price is not Full/],
      [{ ...SKR_PRICE, feedId: BTC_PRICE.feedId }, /posted price holds feed 2817d7bf, not the pinned SKR feed/],
      [{ ...SKR_PRICE, publishTime: now - 41n }, /posted price is 41 s old \(usable under 40 s\)/],
      [{ ...SKR_PRICE, publishTime: now, conf: SKR_PRICE.price / 50n }, /posted price .*confidence .* is over 100 bps/],
    ];
    for (const [read, why] of cases) {
      postedRead = read; sendLog.length = 0;
      await expect(buildPlantingTx(skr)).rejects.toThrow(why);
      expect(sendLog).toEqual(["pre:1", "pre:2", "tx"]);   // the pre-txs, then ONE reclaim tx (best effort)
    }
    expect(getQuote).not.toHaveBeenCalled();
  });

  it("any refusal AFTER the post (here: the route under the floor) reclaims the price account before throwing", async () => {
    QUOTES.SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3 = ["100000000", "99000000"];
    await expect(buildPlantingTx(skr)).rejects.toThrow(/route under floor/);
    QUOTES.SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3 = ["109289617", "108196721"];
    expect(sendLog).toEqual(["pre:1", "pre:2", "tx"]);
  });

  it("a pre-tx that fails midway: the VAA close and the reclaim go out one per tx (either may not exist), then the leg skips", async () => {
    vi.mocked(sendPriceTxs).mockImplementationOnce(async () => { sendLog.push("pre:1"); throw new Error("blockhash not found"); });
    await expect(buildPlantingTx(skr)).rejects.toThrow(/SKR: posting the price failed: blockhash not found/);
    expect(sendLog).toEqual(["pre:1", "tx", "tx"]);
    expect(readPostedPrice).not.toHaveBeenCalled();
  });

  it("a failed reclaim never hides the reason the leg skipped", async () => {
    postedRead = null;
    vi.mocked(sendPriceTxs).mockImplementationOnce(async (txs) => { sendLog.push(...txs.map(() => "pre")); }).mockImplementationOnce(async () => { throw new Error("reclaim down"); });
    await expect(buildPlantingTx(skr)).rejects.toThrow(/missing or not the receiver's/);
  });

  it("dryPost (the gate's --size-only) and measureAlt: the post is BUILT and sized, nothing is sent, Hermes's price stands in, nothing to reclaim", async () => {
    for (const extra of [{ dryPost: true }, { measureAlt: altContent.map((x) => address(x)) }]) {
      sendLog.length = 0; vi.mocked(readPostedPrice).mockClear();
      const b = await buildPlantingTx({ ...skr, ...extra });
      expect(sendLog).toEqual([]);
      expect(readPostedPrice).not.toHaveBeenCalled();
      expect(b.cleanup).toEqual([]);
      expect(b.priceTxBytes).toEqual([790, 620]);
      expect(b.leashFloorRaw).toBe(93_745_350n);
      expect(signedIxs[signedIxs.length - 1].filter((ix) => ix.programAddress === LEASH_PROGRAM).every((ix) => ix.accounts!.some((x) => x.address === POSTED))).toBe(true);
    }
  });

  it("unleashed SKR (today's links) never posts", async () => {
    const b = await buildPlantingTx({ ...skr, leashed: false });
    expect(buildPriceUpdate).not.toHaveBeenCalled();
    expect(sendLog).toEqual([]);
    expect(b.priceTxBytes).toEqual([]);
    expect(b.postedPrice).toBeNull();
  });
});

import { getTransferCheckedInstruction } from "@solana-program/token";
import { lendFeeRaw, LEND_FEE_BPS } from "@/lib/planting";
import { floorRaw } from "@/lib/leash";
import { JLEND_PROGRAM } from "@/lib/constants";
import * as jlendMath from "@/lib/venues/jlend";

/** Task 15 (Review Focus 3 and 4): the USDC lending fee, one pinned transfer to the fee wallet's USDC account, before the deposit. */
describe("Task 15: the 0.5% USDC lending fee", () => {
  const FEE_WALLET = address("8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6");
  const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const A_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const KLEND_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
  const isLeashPull = (ix: Instruction) => ix.programAddress === LEASH_PROGRAM && ix.data?.[0] === 0;
  const tokenIxs = (ixs: Instruction[]) => ixs.filter((ix) => ix.programAddress === TOKEN);
  const amountOf = (ix: Instruction) => Buffer.from(ix.data!).readBigUInt64LE(1);
  beforeEach(async () => {
    puller = await generateKeyPairSigner(); checks.length = 0; sentPre.length = 0; signedIxs.length = 0; vi.mocked(getQuote).mockClear(); vi.mocked(getSwapInstructions).mockClear();
    altContent = await sproutsAltAddresses(puller.address);
    process.env.SPROUTS_ALT = ALT_ADDR;
    presentAccounts.clear();
  });

  it("lendFeeRaw is floor(pull x 50 / 10_000)", () => {
    expect(LEND_FEE_BPS).toBe(50n);
    expect(lendFeeRaw(2_000_000n)).toBe(10_000n);
    expect(lendFeeRaw(1_000_001n)).toBe(5_000n);
    expect(lendFeeRaw(200n)).toBe(1n);
    expect(lendFeeRaw(199n)).toBe(0n);
  });

  it("USDC lending on Kamino, leashed, fee 50: one Token Transfer of 10_000 from the puller's USDC to the fee wallet's USDC, after the pull and before the deposit", async () => {
    const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true, carryIn: { USDC: 500n } });
    const ixs = signedIxs[0];
    const feeAta = await ata(FEE_WALLET, USDC_MINT);
    expect(b.feeRaw).toBe(10_000n);
    const t = tokenIxs(ixs);
    expect(t.length).toBe(1);
    expect(t[0].data![0]).toBe(3);
    expect(t[0].accounts![0].address).toBe(await ata(puller.address, USDC_MINT));
    expect(t[0].accounts![1].address).toBe(feeAta);
    expect(t[0].accounts![2].address).toBe(puller.address);
    expect(amountOf(t[0])).toBe(10_000n);
    const at = ixs.indexOf(t[0]);
    expect(at).toBeGreaterThan(ixs.findIndex(isLeashPull));
    expect(at).toBeLessThan(ixs.findIndex((ix) => ix.programAddress === KLEND_ID));
    expect(b.minOutRaw).toBe(klendMinOut(1_990_500n, { rn: 12_038n, rd: 10_000n }));
    expect(b.leashMinOutRaw! >= b.leashFloorRaw!).toBe(true);
    expect(b.sizeBytes).toBeLessThanOrEqual(1232);
    if (process.env.PRINT_PLANTING_SIZES) console.log(`[Task 15 size] USDC_LEND kamino_klend leashed, with the fee account create: ${b.sizeBytes} B`);
    presentAccounts.add(feeAta);
    const noCreate = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true, carryIn: { USDC: 500n } });
    expect(noCreate.sizeBytes).toBeLessThanOrEqual(1232);
    if (process.env.PRINT_PLANTING_SIZES) console.log(`[Task 15 size] USDC_LEND kamino_klend leashed, fee account present: ${noCreate.sizeBytes} B`);
  });

  it("the same on Jupiter Lend (leg 3), with and without the fee account create, each within 1232 bytes", async () => {
    const feeAta = await ata(FEE_WALLET, USDC_MINT);
    for (const present of [false, true]) {
      if (present) presentAccounts.add(feeAta);
      signedIxs.length = 0;
      const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "jupiter_lend", leashed: true, carryIn: { USDC: 500n } });
      const ixs = signedIxs[0];
      expect(b.leg).toBe(3);
      expect(b.feeRaw).toBe(10_000n);
      const fee = tokenIxs(ixs).filter((ix) => ix.data![0] === 3 && ix.accounts![1].address === feeAta);
      expect(fee.length).toBe(1);
      expect(amountOf(fee[0])).toBe(10_000n);
      expect(ixs.indexOf(fee[0])).toBeGreaterThan(ixs.findIndex(isLeashPull));
      expect(ixs.indexOf(fee[0])).toBeLessThan(ixs.findIndex((ix) => ix.programAddress === JLEND_PROGRAM));
      const creates = ixs.filter((ix) => ix.programAddress === A_TOKEN && ix.accounts?.[2]?.address === FEE_WALLET);
      expect(creates.length).toBe(present ? 0 : 1);
      expect(b.leashMinOutRaw! >= b.leashFloorRaw!).toBe(true);
      expect(b.sizeBytes).toBeLessThanOrEqual(1232);
      if (process.env.PRINT_PLANTING_SIZES) console.log(`[Task 15 size] USDC_LEND jupiter_lend leashed, ${present ? "fee account present" : "with the fee account create"}: ${b.sizeBytes} B`);
    }
  });

  it("unleashed (an old link) pays the same fee: deposit pull - fee", async () => {
    const { buildKlendDepositIxs } = await import("@/lib/venues/klend");
    vi.mocked(buildKlendDepositIxs).mockClear();
    const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: false });
    expect(b.feeRaw).toBe(10_000n);
    expect(b.leg).toBeNull();
    expect(vi.mocked(buildKlendDepositIxs).mock.calls[0][0].amountRaw).toBe(1_990_000n);
    expect(b.minOutRaw).toBe(klendMinOut(1_990_000n, { rn: 12_038n, rd: 10_000n }));
  });

  it("rounding: a pull of 1_000_001 pays 5_000; a pull of 199 pays 0 and carries no Token transfer and no fee account create; deposit = 199 + carry", async () => {
    const big = await buildPlantingTx({ ...base, pullRaw: 1_000_001n, asset: "USDC_LEND", venue: "kamino_klend", leashed: true });
    expect(big.feeRaw).toBe(5_000n);
    expect(amountOf(tokenIxs(signedIxs[0])[0])).toBe(5_000n);
    signedIxs.length = 0;
    const small = await buildPlantingTx({ ...base, pullRaw: 199n, asset: "USDC_LEND", venue: "kamino_klend", leashed: true, carryIn: { USDC: 500n } });
    expect(small.feeRaw).toBe(0n);
    const ixs = signedIxs[0];
    expect(tokenIxs(ixs)).toEqual([]);
    expect(ixs.filter((ix) => ix.programAddress === A_TOKEN && ix.accounts?.[2]?.address === FEE_WALLET)).toEqual([]);
    const d = ixs.filter((ix) => ix.programAddress === KLEND_ID).map((ix) => Buffer.from(ix.data!)).find((x) => x.length === 16)!;
    expect(d.readBigUInt64LE(8)).toBe(699n);
    expect(small.minOutRaw).toBe(klendMinOut(699n, { rn: 12_038n, rd: 10_000n }));
  });

  it("the fee account: absent -> one idempotent create for (fee wallet, USDC) paid by the puller in the ATA slot (before the pull); present -> no create", async () => {
    const feeAta = await ata(FEE_WALLET, USDC_MINT);
    await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true });
    const ixs = signedIxs[0];
    const creates = ixs.filter((ix) => ix.programAddress === A_TOKEN && ix.accounts?.[2]?.address === FEE_WALLET);
    expect(creates.length).toBe(1);
    expect(creates[0].data).toEqual(new Uint8Array([1]));   // CreateIdempotent
    expect(creates[0].accounts!.map((x) => x.address).slice(0, 4)).toEqual([puller.address, feeAta, FEE_WALLET, USDC_MINT]);
    expect(ixs.indexOf(creates[0])).toBeLessThan(ixs.findIndex(isLeashPull));
    presentAccounts.add(feeAta);
    signedIxs.length = 0;
    await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true });
    expect(signedIxs[0].filter((ix) => ix.programAddress === A_TOKEN && ix.accounts?.[2]?.address === FEE_WALLET)).toEqual([]);
  });

  it("floor sweep: the K-Lend minimum of pull - fee clears the leash floor at fee 50, tol 10 (pulls 0.50..5.00 USDC, rates 1.0, 1.2038, 1.5)", () => {
    for (let pull = 500_000n; pull <= 5_000_000n; pull += 250_000n) {
      for (const r of [{ rn: 10_000n, rd: 10_000n }, { rn: 12_038n, rd: 10_000n }, { rn: 15_000n, rd: 10_000n }]) {
        const floor = floorRaw({ leg: 2, amountRaw: pull, rn: r.rn, rd: r.rd, priceLow: null, exponent: null, feeBps: 50, tolBps: 10, underlyingDecimals: 6 });
        expect(klendMinOut(pull - lendFeeRaw(pull), r) >= floor, `pull ${pull} rate ${r.rn}/${r.rd}`).toBe(true);
      }
    }
  });

  it("J-Lend floor sweep (review): shares - 1 of pull - fee clears the leash floor at fee 50, tol 10 for every whole-cent pull up to $5; the sub-cent fail-closed zone ends where it did at fee 0", () => {
    const { jlendShares } = jlendMath;
    const SCALE = 1_000_000_000_000n;
    const jPasses = (pull: bigint, rn: bigint, feeBps: 0 | 50) => {
      const dep = pull - (feeBps ? lendFeeRaw(pull) : 0n);
      const floor = floorRaw({ leg: 3, amountRaw: pull, rn, rd: SCALE, priceLow: null, exponent: null, feeBps, tolBps: 10, underlyingDecimals: 6 });
      return floor > 0n && jlendShares(dep, rn) - 1n >= floor;
    };
    const kPasses = (pull: bigint, rn: bigint, rd: bigint) => {
      const floor = floorRaw({ leg: 2, amountRaw: pull, rn, rd, priceLow: null, exponent: null, feeBps: 50, tolBps: 10, underlyingDecimals: 6 });
      return floor > 0n && klendMinOut(pull - lendFeeRaw(pull), { rn, rd }) >= floor;
    };
    for (const x of [10_000n, 10_500n, 12_038n, 15_000n]) {
      const rn = x * 100_000_000n;   // the same rate in J-Lend's 1e12 scale
      // Every pull the run can make (whole cents, 1 cent .. $5) passes on both venues.
      for (let pull = 10_000n; pull <= 5_000_000n; pull += 10_000n) {
        expect(jPasses(pull, rn, 50), `J-Lend pull ${pull} rate ${x}`).toBe(true);
        expect(kPasses(pull, x, 10_000n), `K-Lend pull ${pull} rate ${x}`).toBe(true);
      }
      // Sub-cent pulls (never made: pulls are whole cents): J-Lend fails closed up to ~3_000 raw (its 1-share and 2 bps haircut),
      // K-Lend up to ~2_000 raw. Both zones pre-date the fee: at fee 0 they end at the same bounds (rounding inside them may flip
      // single sub-cent pulls either way, e.g. 2_007 raw at rate 1.05 passes at fee 0 and fails at fee 50; such a pull fails closed).
      let jLast = 0n, jLast0 = 0n, kLast = 0n;
      for (let pull = 1n; pull < 10_000n; pull++) {
        if (!jPasses(pull, rn, 50)) jLast = pull;
        if (!jPasses(pull, rn, 0)) jLast0 = pull;
        if (!kPasses(pull, x, 10_000n)) kLast = pull;
      }
      expect(jLast, `rate ${x}`).toBeLessThanOrEqual(3_000n);
      expect(jLast0, `rate ${x} at fee 0`).toBeLessThanOrEqual(3_000n);
      expect(kLast, `rate ${x}`).toBeLessThanOrEqual(2_000n);
    }
  });

  it("the K-Lend injection test still refuses with the fee on, and so does an injected second fee transfer", async () => {
    const { buildKlendDepositIxs } = await import("@/lib/venues/klend");
    const real = (await vi.importActual<typeof import("@/lib/venues/klend")>("@/lib/venues/klend")).buildKlendDepositIxs;
    const usdc = await ata(puller.address, USDC_MINT);
    vi.mocked(buildKlendDepositIxs).mockImplementationOnce(async (x) => [...(await real(x)), getTransferInstruction({ source: usdc, destination: await ata(USER, USDC_MINT), authority: puller, amount: 5n }) as Instruction]);
    await expect(buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true })).rejects.toThrow(/Planting refused: Token instruction 3/);
    const feeAta = await ata(FEE_WALLET, USDC_MINT);
    vi.mocked(buildKlendDepositIxs).mockImplementationOnce(async (x) => [...(await real(x)), getTransferInstruction({ source: usdc, destination: feeAta, authority: puller, amount: 10_000n }) as Instruction]);
    await expect(buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true })).rejects.toThrow(/Planting refused: a second fee transfer/);
  });

  describe("checkPlantingInstructions with a fee (unit)", () => {
    const pull: Instruction = { programAddress: LEASH_PROGRAM, accounts: [], data: new Uint8Array([0]) };
    const settle: Instruction = { programAddress: LEASH_PROGRAM, accounts: [], data: new Uint8Array([1]) };
    const k1: Instruction = { programAddress: address(KLEND_ID), accounts: [], data: new Uint8Array([9]) };
    const k2: Instruction = { programAddress: address(KLEND_ID), accounts: [], data: new Uint8Array([10]) };
    const setup = async () => {
      const pullerUsdc = await ata(puller.address, USDC_MINT);
      const feeAta = await ata(FEE_WALLET, USDC_MINT);
      const fee = { source: pullerUsdc, destination: feeAta, owner: FEE_WALLET, amountRaw: 10_000n };
      const a = { puller: puller.address, user: USER, asset: "USDC_LEND" as const, venue: "kamino_klend" as const, leashed: true, pullerWsol: await ata(puller.address, WSOL_MINT), pullerJl: null,
        userMints: [KLEND.USDC_LEND.collateralMint], posted: false, fee };
      const xfer = (o: { source?: string; destination?: string; amount?: bigint } = {}) => getTransferInstruction({ source: address(o.source ?? pullerUsdc), destination: address(o.destination ?? feeAta), authority: puller, amount: o.amount ?? 10_000n }) as Instruction;
      const tx = (...mid: Instruction[]) => [pull, ...mid, k1, k2, settle];
      return { pullerUsdc, feeAta, fee, a, xfer, tx };
    };

    it("the exact Transfer (tag 3) passes; the exact TransferChecked (tag 12, USDC, 6 decimals) passes", async () => {
      const { a, xfer, tx, pullerUsdc, feeAta } = await setup();
      expect(() => checkPlantingInstructions(tx(xfer()), a)).not.toThrow();
      const checked = getTransferCheckedInstruction({ source: pullerUsdc, mint: USDC_MINT, destination: feeAta, authority: puller, amount: 10_000n, decimals: 6 }) as Instruction;
      expect(() => checkPlantingInstructions(tx(checked), a)).not.toThrow();
      const wrongDecimals = getTransferCheckedInstruction({ source: pullerUsdc, mint: USDC_MINT, destination: feeAta, authority: puller, amount: 10_000n, decimals: 9 }) as Instruction;
      expect(() => checkPlantingInstructions(tx(wrongDecimals), a)).toThrow(/Planting refused/);
      const wrongMint = getTransferCheckedInstruction({ source: pullerUsdc, mint: SKR_MINT, destination: feeAta, authority: puller, amount: 10_000n, decimals: 6 }) as Instruction;
      expect(() => checkPlantingInstructions(tx(wrongMint), a)).toThrow(/Planting refused/);
    });

    it("refused: amount 10_001, the user's USDC account, any other account, another source, Token-2022, another authority", async () => {
      const { a, xfer, tx } = await setup();
      const userUsdc = await ata(USER, USDC_MINT), feeSkr = await ata(FEE_WALLET, SKR_MINT), pullerSkr = await ata(puller.address, SKR_MINT);
      expect(() => checkPlantingInstructions(tx(xfer({ amount: 10_001n })), a)).toThrow(/Planting refused/);
      expect(() => checkPlantingInstructions(tx(xfer({ destination: userUsdc })), a)).toThrow(/Planting refused/);
      expect(() => checkPlantingInstructions(tx(xfer({ destination: feeSkr })), a)).toThrow(/Planting refused/);
      expect(() => checkPlantingInstructions(tx(xfer({ destination: pullerSkr })), a)).toThrow(/Planting refused/);
      expect(() => checkPlantingInstructions(tx(xfer({ source: userUsdc })), a)).toThrow(/Planting refused/);
      expect(() => checkPlantingInstructions(tx({ ...xfer(), programAddress: TOKEN_2022 }), a)).toThrow(/Planting refused/);
      const other = await generateKeyPairSigner();
      const byOther = getTransferInstruction({ source: a.fee.source, destination: a.fee.destination, authority: other, amount: 10_000n }) as Instruction;
      expect(() => checkPlantingInstructions(tx(byOther), a)).toThrow(/Planting refused/);
    });

    it("refused: two fee transfers; a fee due with no transfer; a transfer when the fee is 0; any fee transfer on a leg with fee null (hSOL)", async () => {
      const { a, xfer, tx, fee } = await setup();
      expect(() => checkPlantingInstructions(tx(xfer(), xfer()), a)).toThrow(/a second fee transfer/);
      expect(() => checkPlantingInstructions(tx(), a)).toThrow(/the fee transfer is missing/);
      expect(() => checkPlantingInstructions(tx(), { ...a, fee: { ...fee, amountRaw: 0n } })).not.toThrow();
      expect(() => checkPlantingInstructions(tx(xfer({ amount: 0n })), { ...a, fee: { ...fee, amountRaw: 0n } })).toThrow(/Planting refused/);
      const swap: Instruction = { programAddress: address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"), accounts: [], data: new Uint8Array([229]) };
      const hsol = { ...a, asset: "hSOL" as const, venue: null, userMints: [address("he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A")], fee: null };
      expect(() => checkPlantingInstructions([pull, swap, settle], hsol)).not.toThrow();
      expect(() => checkPlantingInstructions([pull, xfer(), swap, settle], hsol)).toThrow(/Planting refused: Token instruction 3/);
    });

    it("the fee wallet's account create: only (USDC, the fee account) passes; its SKR account, or a USDC account at another address, is refused", async () => {
      const { a, xfer, tx, feeAta } = await setup();
      const create = (ataAddr: string, mint: string) => getCreateAssociatedTokenIdempotentInstruction({ payer: puller, ata: address(ataAddr), owner: FEE_WALLET, mint: address(mint) }) as Instruction;
      expect(() => checkPlantingInstructions([create(feeAta, USDC_MINT), ...tx(xfer())], a)).not.toThrow();
      // review: a 0 fee carries no create either; the fee wallet is then a third party, as on any other leg
      expect(() => checkPlantingInstructions([create(feeAta, USDC_MINT), ...tx()], { ...a, fee: { ...a.fee, amountRaw: 0n } })).toThrow(/neither the puller nor this user/);
      const feeSkr = await ata(FEE_WALLET, SKR_MINT), userUsdc = await ata(USER, USDC_MINT);
      expect(() => checkPlantingInstructions([create(feeSkr, SKR_MINT), ...tx(xfer())], a)).toThrow(/Planting refused/);
      expect(() => checkPlantingInstructions([create(userUsdc, USDC_MINT), ...tx(xfer())], a)).toThrow(/Planting refused/);
      // fee null (any other leg): the fee wallet is a third party, as today
      const swap: Instruction = { programAddress: address("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"), accounts: [], data: new Uint8Array([229]) };
      const hsol = { ...a, asset: "hSOL" as const, venue: null, userMints: [], fee: null };
      expect(() => checkPlantingInstructions([create(feeAta, USDC_MINT), pull, swap, settle], hsol)).toThrow(/neither the puller nor this user/);
    });
  });
});

import { solLendSwapFloor } from "@/lib/planting";
import { klendRate } from "@/lib/venues/klend";
import { legRate } from "@/lib/leash";

/** Task 15b: SOL lending pays the same 0.5% as one pinned USDC transfer before the swap; the swap's slippage adapts to the leg floor. */
describe("Task 15b: the 0.5% SOL lending fee and the adaptive swap", () => {
  const FEE_WALLET = address("8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6");
  const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN_2022 = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  const A_TOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const KLEND_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
  const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
  const WSOL_Q = "So11111111111111111111111111111111111111112";
  const isLeashPull = (ix: Instruction) => ix.programAddress === LEASH_PROGRAM && ix.data?.[0] === 0;
  const amountOf = (ix: Instruction) => Buffer.from(ix.data!).readBigUInt64LE(1);
  const VENUES = ["kamino_klend", "jupiter_lend"] as const;
  const RATE = { kamino_klend: { rn: 12_038n, rd: 10_000n }, jupiter_lend: { rn: 1_050_000_000_000n, rd: 1_000_000_000_000n } } as const;
  const LEG = { kamino_klend: 4, jupiter_lend: 5 } as const;
  const SOL_LOW = 12_147_000_000n - 10_000_000n;   // the sponsored SOL price less its conf
  const floorFor = (venue: (typeof VENUES)[number], pull = 2_000_000n) =>
    floorRaw({ leg: LEG[venue], amountRaw: pull, rn: RATE[venue].rn, rd: RATE[venue].rd, priceLow: SOL_LOW, exponent: -8, feeBps: 50, tolBps: 100, underlyingDecimals: 9 });
  const quoteCall = (i = 0) => vi.mocked(getQuote).mock.calls[i][0] as Record<string, unknown>;
  const setRoute = (out: string, min: string) => { QUOTES[WSOL_Q] = [out, min]; };
  beforeEach(async () => {
    puller = await generateKeyPairSigner(); checks.length = 0; sentPre.length = 0; signedIxs.length = 0; vi.mocked(getQuote).mockClear(); vi.mocked(getSwapInstructions).mockClear();
    vi.mocked(klendRate).mockClear();
    const { jlendRate } = await import("@/lib/venues/jlend");
    vi.mocked(jlendRate).mockClear(); vi.mocked(legRate).mockClear();
    altContent = await sproutsAltAddresses(puller.address);
    process.env.SPROUTS_ALT = ALT_ADDR;
    presentAccounts.clear(); presentBalances.clear();
    setRoute("16500000", "16335000");
  });

  it("leashed, both venues, pull 2_000_000: feeRaw 10_000; one tag-3 transfer to the fee wallet's USDC after the pull and before the Jupiter swap; the quote asks for 1_990_000 with no fee params", async () => {
    const feeAta = await ata(FEE_WALLET, USDC_MINT);
    const pullerUsdc = await ata(puller.address, USDC_MINT);
    for (const [i, venue] of VENUES.entries()) {
      const b = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue, leashed: true });
      const ixs = signedIxs[i];
      expect(b.leg).toBe(LEG[venue]);
      expect(b.feeRaw).toBe(10_000n);
      const fee = ixs.filter((ix) => ix.programAddress === TOKEN && ix.data![0] === 3 && ix.accounts![1].address === feeAta);
      expect(fee.length, venue).toBe(1);
      expect(amountOf(fee[0])).toBe(10_000n);
      expect(fee[0].accounts!.map((x) => x.address)).toEqual([pullerUsdc, feeAta, puller.address]);
      const at = ixs.indexOf(fee[0]);
      expect(at).toBeGreaterThan(ixs.findIndex(isLeashPull));
      expect(at).toBeLessThan(ixs.findIndex((ix) => ix.programAddress === JUP));
      const q = quoteCall(vi.mocked(getQuote).mock.calls.length - 1);
      expect(q.amountRaw).toBe(1_990_000n);
      expect(q).not.toHaveProperty("platformFeeBps");
      expect(vi.mocked(getSwapInstructions).mock.calls.at(-1)![0]).not.toHaveProperty("feeAccount");
      expect(checks.at(-1)).not.toHaveProperty("feeAccount");
      // the floor at fee 50 / tol 100 from the venue rate read once (13_483_435 kTokens; 15_458_437 shares)
      expect(b.leashFloorRaw).toBe(floorFor(venue));
      expect(b.leashFloorRaw).toBe(venue === "kamino_klend" ? 13_483_435n : 15_458_437n);
      expect(b.leashMinOutRaw! >= b.leashFloorRaw!).toBe(true);
      expect(b.sizeBytes).toBeLessThanOrEqual(1232);
    }
    // the venue rate is read once per build (before the swap, reused for the deposit); legRate is not asked for legs 4/5
    expect(vi.mocked(klendRate)).toHaveBeenCalledTimes(1);
    const { jlendRate } = await import("@/lib/venues/jlend");
    expect(vi.mocked(jlendRate)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(legRate).mock.calls.map((c) => c[0])).not.toContain(4);
    expect(vi.mocked(legRate).mock.calls.map((c) => c[0])).not.toContain(5);
  });

  it("floats: the USDC float change is 0 (+pull -fee -swap input); the WSOL float falls by at most the carry (deposit = swap minimum + WSOL carry)", async () => {
    for (const [i, venue] of VENUES.entries()) {
      const b = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue, leashed: true, carryIn: { WSOL: 9n, USDC: 500n } });
      expect((quoteCall(i).amountRaw as bigint) + b.feeRaw! - base.pullRaw).toBe(0n);
      const ixs = signedIxs[i];
      const deposit = venue === "kamino_klend"
        ? ixs.filter((ix) => ix.programAddress === KLEND_ID).map((ix) => Buffer.from(ix.data!)).find((x) => x.length === 16)!.readBigUInt64LE(8)
        : Buffer.from(ixs.find((ix) => ix.programAddress === JLEND_PROGRAM)!.data!).readBigUInt64LE(16);   // max_assets
      expect(deposit).toBe(16_335_000n + 9n);   // the swap minimum plus this user's WSOL carry; the USDC carry is not touched
    }
  });

  it("adaptive slippage: an ample route keeps 100; a route where 100 bps lands under the swap floor re-quotes at the computed bps (threshold >= swap floor); a route under the swap floor throws 'route under floor'", async () => {
    for (const venue of VENUES) {
      const swapFloor = solLendSwapFloor(venue, floorFor(venue), RATE[venue]);
      expect(swapFloor).toBe(16_234_607n);
      vi.mocked(getQuote).mockClear();
      setRoute("16500000", "16335000");   // roomBps 160 -> capped at 100: one quote
      const ample = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue, leashed: true });
      expect(getQuote).toHaveBeenCalledTimes(1);
      expect(quoteCall(0)).not.toHaveProperty("slippageBps");
      expect(ample.leashMinOutRaw! >= ample.leashFloorRaw!).toBe(true);
      // 16_300_000 x 0.99 = 16_137_000 < 16_234_607: roomBps = (16_300_000 - 16_234_607 - 1) x 10_000 / 16_300_000 = 40
      vi.mocked(getQuote).mockClear();
      setRoute("16300000", "16137000");
      const tight = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue, leashed: true });
      expect(getQuote).toHaveBeenCalledTimes(2);
      expect(quoteCall(1)).toMatchObject({ slippageBps: 40, amountRaw: 1_990_000n });
      expect(quoteCall(1)).not.toHaveProperty("platformFeeBps");
      const threshold = (16_300_000n * 9_960n) / 10_000n;   // 16_234_800
      expect(threshold >= swapFloor).toBe(true);
      expect(tight.leashMinOutRaw! >= tight.leashFloorRaw!).toBe(true);
      expect(tight.leashMinOutRaw).toBe(venue === "kamino_klend" ? klendMinOut(threshold, RATE.kamino_klend) : jlendMath.jlendShares(threshold, RATE.jupiter_lend.rn) - 1n);
      // the route itself under the swap floor: skip, no second quote, nothing signed
      vi.mocked(getQuote).mockClear();
      setRoute("16200000", "16038000");
      await expect(buildPlantingTx({ ...base, asset: "SOL_LEND", venue, leashed: true })).rejects.toThrow(/SOL_LEND: route under floor \(route 16200000 < floor 16234607\)/);
      expect(getQuote).toHaveBeenCalledTimes(1);
    }
  });

  it("unleashed (an old link) pays the same fee and swaps pull - fee at today's 100 bps; a pull of 199 pays 0: no transfer, no fee account create, the quote is the whole pull", async () => {
    const feeAta = await ata(FEE_WALLET, USDC_MINT);
    const b = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "kamino_klend", leashed: false });
    expect(b.feeRaw).toBe(10_000n);
    expect(b.leashFloorRaw).toBeNull();
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(quoteCall(0)).toMatchObject({ amountRaw: 1_990_000n });
    expect(quoteCall(0)).not.toHaveProperty("slippageBps");
    signedIxs.length = 0;
    const small = await buildPlantingTx({ ...base, pullRaw: 199n, asset: "SOL_LEND", venue: "kamino_klend", leashed: true });
    expect(small.feeRaw).toBe(0n);
    expect(quoteCall(1)).toMatchObject({ amountRaw: 199n });
    const ixs = signedIxs[0];
    expect(ixs.filter((ix) => ix.programAddress === TOKEN && ix.accounts![1]?.address === feeAta)).toEqual([]);
    expect(ixs.filter((ix) => ix.programAddress === A_TOKEN && ix.accounts?.[2]?.address === FEE_WALLET)).toEqual([]);
  });

  it("refused at the build: a quote carrying a platform fee, a swap naming the fee wallet's USDC account, and a second fee transfer from the route", async () => {
    const feeAta = await ata(FEE_WALLET, USDC_MINT);
    const usdc = await ata(puller.address, USDC_MINT);
    vi.mocked(getQuote).mockImplementationOnce(async (a) => ({ inputMint: USDC_MINT, outputMint: a.outputMint, inAmount: "1990000", outAmount: "16500000", otherAmountThreshold: "16335000", priceImpactPct: "0", routePlan: [], platformFee: { amount: "82500", feeBps: 50 } }) as never);
    await expect(buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "kamino_klend", leashed: true })).rejects.toThrow(/Planting refused: .*platform fee/);
    const withAccounts = (accounts: string[], setup: Instruction[] = []) => vi.mocked(getSwapInstructions).mockResolvedValueOnce({ computeBudget: [], setup, swap: { programAddress: address(JUP), accounts: accounts.map((x) => ({ address: address(x), role: AccountRole.WRITABLE })), data: new Uint8Array([229]) }, cleanup: null, lookupTables: [] } as never);
    withAccounts([feeAta]);
    await expect(buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "jupiter_lend", leashed: true })).rejects.toThrow(/Planting refused: .*fee wallet's USDC account/);
    // the route's own setup paying the fee wallet is caught by the same rule (it names the fee account)
    withAccounts([], [getTransferInstruction({ source: usdc, destination: feeAta, authority: puller, amount: 10_000n }) as Instruction]);
    await expect(buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "kamino_klend", leashed: true })).rejects.toThrow(/Planting refused: .*fee wallet's USDC account/);
    // a second exact fee transfer anywhere else in the tx (here: added by the venue builder) is refused by the allowlist
    const { buildKlendDepositIxs } = await import("@/lib/venues/klend");
    const real = (await vi.importActual<typeof import("@/lib/venues/klend")>("@/lib/venues/klend")).buildKlendDepositIxs;
    vi.mocked(buildKlendDepositIxs).mockImplementationOnce(async (x) => [...(await real(x)), getTransferInstruction({ source: usdc, destination: feeAta, authority: puller, amount: 10_000n }) as Instruction]);
    await expect(buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "kamino_klend", leashed: true })).rejects.toThrow(/Planting refused: a second fee transfer/);
    // positive control: the same build without the injections signs
    await expect(buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "kamino_klend", leashed: true })).resolves.toMatchObject({ feeRaw: 10_000n });
  });

  describe("checkPlantingInstructions on SOL lending (unit): Task 15's fee rule", () => {
    const pull: Instruction = { programAddress: LEASH_PROGRAM, accounts: [], data: new Uint8Array([0]) };
    const settle: Instruction = { programAddress: LEASH_PROGRAM, accounts: [], data: new Uint8Array([1]) };
    const swap: Instruction = { programAddress: address(JUP), accounts: [], data: new Uint8Array([229]) };
    const k1: Instruction = { programAddress: address(KLEND_ID), accounts: [], data: new Uint8Array([9]) };
    const k2: Instruction = { programAddress: address(KLEND_ID), accounts: [], data: new Uint8Array([10]) };
    const setup = async () => {
      const pullerUsdc = await ata(puller.address, USDC_MINT);
      const feeAta = await ata(FEE_WALLET, USDC_MINT);
      const fee = { source: pullerUsdc, destination: feeAta, owner: FEE_WALLET, amountRaw: 10_000n };
      const a = { puller: puller.address, user: USER, asset: "SOL_LEND" as const, venue: "kamino_klend" as const, leashed: true, pullerWsol: await ata(puller.address, WSOL_MINT), pullerJl: null,
        userMints: [KLEND.SOL_LEND.collateralMint], posted: false, fee };
      const xfer = (o: { source?: string; destination?: string; amount?: bigint } = {}) => getTransferInstruction({ source: address(o.source ?? pullerUsdc), destination: address(o.destination ?? feeAta), authority: puller, amount: o.amount ?? 10_000n }) as Instruction;
      const tx = (...mid: Instruction[]) => [pull, ...mid, swap, k1, k2, settle];
      return { a, xfer, tx, fee };
    };
    it("the exact transfer passes; refused: amount fee + 1, another destination, another source, Token-2022, two transfers, none when a fee is due", async () => {
      const { a, xfer, tx } = await setup();
      expect(() => checkPlantingInstructions(tx(xfer()), a)).not.toThrow();
      const userUsdc = await ata(USER, USDC_MINT), pullerWsol = await ata(puller.address, WSOL_MINT);
      expect(() => checkPlantingInstructions(tx(xfer({ amount: 10_001n })), a)).toThrow(/Planting refused/);
      expect(() => checkPlantingInstructions(tx(xfer({ destination: userUsdc })), a)).toThrow(/Planting refused/);
      expect(() => checkPlantingInstructions(tx(xfer({ source: pullerWsol })), a)).toThrow(/Planting refused/);
      expect(() => checkPlantingInstructions(tx({ ...xfer(), programAddress: TOKEN_2022 }), a)).toThrow(/Planting refused/);
      expect(() => checkPlantingInstructions(tx(xfer(), xfer()), a)).toThrow(/a second fee transfer/);
      expect(() => checkPlantingInstructions(tx(), a)).toThrow(/the fee transfer is missing/);
    });
    it("a fee transfer on hSOL (fee null) is refused", async () => {
      const { a, xfer } = await setup();
      const hsol = { ...a, asset: "hSOL" as const, venue: null, userMints: [address("he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A")], fee: null };
      expect(() => checkPlantingInstructions([pull, swap, settle], hsol)).not.toThrow();
      expect(() => checkPlantingInstructions([pull, xfer(), swap, settle], hsol)).toThrow(/Planting refused: Token instruction 3/);
    });
  });

  it("size (Kimi gate 3): the worst SOL lending tx on both venues, with the fee transfer and the fee account create, stays within 1232 bytes", async () => {
    const feeAta = await ata(FEE_WALLET, USDC_MINT);
    const pullerJl = await ata(puller.address, JLEND.SOL_LEND.fTokenMint);
    const sizes: string[] = [];
    for (const venue of VENUES) for (const present of [false, true]) for (const leftover of venue === "jupiter_lend" ? [0n, 1n] as const : [undefined]) for (const dust of venue === "jupiter_lend" ? [false, true] : [false]) {
      presentAccounts.clear(); presentBalances.clear();
      if (present) presentAccounts.add(feeAta);
      if (dust) { presentAccounts.add(pullerJl); presentBalances.set(pullerJl, 3n); }
      signedIxs.length = 0;
      const b = await buildPlantingTx({ ...base, asset: "SOL_LEND", venue, leashed: true, carryIn: { WSOL: 9n }, ...(leftover !== undefined ? { jlLeftover: leftover } : {}) });
      const creates = signedIxs[0].filter((ix) => ix.programAddress === A_TOKEN && ix.accounts?.[2]?.address === FEE_WALLET);
      expect(creates.length).toBe(present ? 0 : 1);
      expect(b.sizeBytes, `${venue} create ${!present} leftover ${leftover} dust ${dust}`).toBeLessThanOrEqual(1232);
      sizes.push(`${venue}${present ? " fee account present" : " with the fee account create"}${leftover !== undefined ? ` leftover ${leftover}` : ""}${dust ? " + dust burn" : ""}: ${b.sizeBytes} B`);
    }
    if (process.env.PRINT_PLANTING_SIZES) for (const l of sizes) console.log(`[Task 15b size] SOL_LEND ${l}`);
  });
});
