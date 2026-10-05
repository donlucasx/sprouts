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
const SOL_PRICE = { feedId: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", price: 12_147_000_000n, conf: 10_000_000n, exponent: -8, publishTime: 0n, full: true };
// T9 finding: without the Sprouts ALT a Jupiter Lend leg does not fit (USDC 1297 B, SOL 1424 B with an empty Jupiter route, over
// 1232), so SPROUTS_ALT is set here to a table holding exactly sproutsAltAddresses(puller), served as jsonParsed the way the kit
// reads it. `altOn = false` shows the refusal without it.
const ALT_ADDR = "AL7eJQ4GqXg6fPZ9u3vFeWwz6bKwZ2PLvcxCkV9HvVdy";
let altContent: string[] = [];
let altOn = true;
const postIx: Instruction = { programAddress: address("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"), accounts: [], data: new Uint8Array([7]) };

vi.mock("@/lib/puller", () => ({ pullerSigner: vi.fn(async () => puller) }));
vi.mock("@/lib/config", () => ({ config: () => ({ feeWallet: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6", heliusRpcUrl: "https://x", pythApiKey: "k" }) }));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1", lastValidBlockHeight: 1n } }) }),
  getAccountInfo: () => ({ send: async () => ({ value: null }) }),
  getMultipleAccounts: (addrs: string[], cfg?: { encoding?: string }) => ({ send: async () => ({ value: addrs.map((a) => (a === ALT_ADDR && cfg?.encoding === "jsonParsed"
    ? { data: { parsed: { info: { addresses: altContent, authority: null, deactivationSlot: "18446744073709551615", lastExtendedSlot: "0", lastExtendedSlotStartIndex: 0 }, type: "lookupTable" }, program: "address-lookup-table", space: 56n + 32n * BigInt(altContent.length) }, executable: false, lamports: 1n, owner: "AddressLookupTab1e1111111111111111111111111", space: 56n + 32n * BigInt(altContent.length) }
    : null)) }) }),
}) }));
vi.mock("@/lib/subscriptions", () => ({ buildTransferRecurringIx: vi.fn(async () => ({ programAddress: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44", accounts: [], data: new Uint8Array([5]) })) }));
vi.mock("@/lib/staking", async (orig) => ({ ...(await orig<object>()), sharePrice: vi.fn(async () => 1_149_090_094n) }));
vi.mock("@/lib/jupiter", async (orig) => {
  const real = await orig<typeof import("@/lib/jupiter")>();
  return {
    ...real,
    getQuote: vi.fn(async (a: { outputMint: string }) => ({ inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: a.outputMint, inAmount: "2000000", outAmount: QUOTES[a.outputMint][0], otherAmountThreshold: QUOTES[a.outputMint][1], priceImpactPct: "0", routePlan: [] })),
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
  readSponsoredPrice: vi.fn(async () => SOL_PRICE),
  sendPriceTxs: vi.fn(async (txs: unknown[]) => { sentPre.push(...txs); }),
  buildPriceUpdate: vi.fn(async () => ({ preTxs: [{ pre: 1 }], postIx, account: address("7oqYpv5YbjJ2PEsNeVVB5ZEZ8ZE6ufkj8hAvAiaiftbe"), closeIxs: [postIx], price: { ...SOL_PRICE, feedId: "2817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a97", price: 6_200_000_000_000n, conf: 1_000_000_000n } })),
}));
vi.mock("@/lib/leash", async (orig) => {
  const real = await orig<typeof import("@/lib/leash")>();
  return {
    ...real,
    priceSourceFor: vi.fn(async (leg: number) => (leg === 2 || leg === 3 ? { kind: "none" } : leg === 7 || leg === 0 ? { kind: "post", feedId: "x" } : { kind: "sponsored", account: "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE" })),
    checkLeashInstructions: vi.fn((ixs: Instruction[], a: Parameters<typeof real.checkLeashInstructions>[1]) => { signedIxs.push([...ixs]); return real.checkLeashInstructions(ixs, a); }),
    legRate: vi.fn(async (leg: number) => (leg === 2 ? { rn: 12_038n, rd: 10_000n } : leg === 5 || leg === 3 ? { rn: 1_050_000_000_000n, rd: 1_000_000_000_000n } : leg === 6 ? { rn: 1_189_400_000n, rd: 1_000_000_000n } : leg === 0 ? { rn: 1_149_090_094n, rd: 1_000_000_000n } : { rn: 1n, rd: 1n })),
  };
});

import { buildPlantingTx, tokenAmountOf } from "@/lib/planting";
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

  it("USDC lending on Kamino, leashed: no swap; deposit(pull + USDC carry); the USDC float is watched", async () => {
    const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true, carryIn: { USDC: 500n } });
    expect(getQuote).not.toHaveBeenCalled();
    expect(b.leg).toBe(2);
    expect(b.minOutRaw).toBe(klendMinOut(2_000_500n, { rn: 12_038n, rd: 10_000n }));
    expect(b.minOutRaw).toBe(1_661_487n);   // the floor at these numbers is 1_659_745
    expect(b.leashMinOutRaw).toBe(1_661_487n);
    expect(b.preRaw).toBe(0n);
    expect(b.deliveryAccount).toBe(await ata(USER, KLEND.USDC_LEND.collateralMint));
    expect(b.watched).toEqual([await ata(puller.address, USDC_MINT)]);
    expect(b.sizeBytes).toBeLessThanOrEqual(1232);
  });

  it("USDC lending on Jupiter Lend, leashed (the Day-1 fallback venue): leg 3, the jl account watched, the leftover recorded", async () => {
    const b = await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "jupiter_lend", leashed: true, jlLeftover: 1n });
    expect(b.leg).toBe(3);
    expect(b.jlLeftover).toBe(1n);
    expect(b.watched).toEqual([await ata(puller.address, USDC_MINT), await ata(puller.address, JLEND.USDC_LEND.fTokenMint)]);
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
    expect(b.watched).toEqual([await ata(puller.address, WSOL_MINT), pullerJl]);
    expect(b.deliveryAccount).toBe(await ata(USER, JLEND.SOL_LEND.fTokenMint));
  });

  it("hSOL, leashed: the coin leg pays 50 bps; leash min_out = the quote minimum; refused under the leash floor", async () => {
    const b = await buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: true });
    expect(vi.mocked(getQuote).mock.calls[0][0]).toMatchObject({ platformFeeBps: 50 });
    expect(checks[0]).toHaveProperty("feeAccount");
    expect(b.leashMinOutRaw).toBe(13_705_000n);   // the floor at these numbers is 13_646_678
    QUOTES.he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A = ["13843000", "13600000"];
    await expect(buildPlantingTx({ ...base, asset: "hSOL", venue: null, leashed: true })).rejects.toThrow(/leash floor/);
    QUOTES.he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A = ["13843000", "13705000"];
  });

  it("cbBTC, leashed, posted price: the pre-txs go out first and the rent cleanup is returned", async () => {
    const b = await buildPlantingTx({ ...base, asset: "cbBTC", venue: null, leashed: true });
    expect(sentPre).toEqual([{ pre: 1 }]);
    expect(b.cleanup).toEqual([postIx]);
    expect(b.leashMinOutRaw).toBe(3_193n);   // the floor is 3_178
  });

  it("SKR, leashed: the delivery check stays on the puller's SKR float; leash min_out is shares", async () => {
    const b = await buildPlantingTx({ ...base, asset: "SKR", venue: null, leashed: true, carryIn: { SKR: 1234n } });
    expect(b.deliveryAccount).toBe(await ata(puller.address, SKR_MINT));
    expect(b.leashMinOutRaw).toBe(94_158_604n);   // 108_196_721 x 1e9 / 1_149_090_094 - 1
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

  it("BIND THE K-LEND DEPOSIT: the signed deposit is exactly the pull plus THIS user's carry (USDC), the swap minimum plus carry (SOL)", async () => {
    await buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true, carryIn: { USDC: 500n, WSOL: 7n } });
    expect(depositOf(signedIxs[0])).toBe(2_000_500n);
    await buildPlantingTx({ ...base, asset: "SOL_LEND", venue: "kamino_klend", leashed: true, carryIn: { WSOL: 9n, USDC: 500n } });
    expect(depositOf(signedIxs[1])).toBe(16_335_009n);
  });

  it("BIND THE K-LEND DEPOSIT: a deposit over the leg's amount (drawing other users' pooled float) is refused before signing", async () => {
    const { buildKlendDepositIxs } = await import("@/lib/venues/klend");
    const real = (await vi.importActual<typeof import("@/lib/venues/klend")>("@/lib/venues/klend")).buildKlendDepositIxs;
    vi.mocked(buildKlendDepositIxs).mockImplementationOnce(async (a) => real({ ...a, amountRaw: a.amountRaw + 1_000_000n }));
    await expect(buildPlantingTx({ ...base, asset: "USDC_LEND", venue: "kamino_klend", leashed: true, carryIn: {} })).rejects.toThrow(/deposit of 3000000, not the leg's 2000000/);
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
