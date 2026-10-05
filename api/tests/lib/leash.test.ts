import { describe, it, expect, vi } from "vitest";
import { address, generateKeyPairSigner, getProgramDerivedAddress, getAddressEncoder, type Address, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { findEventAuthorityPda } from "@solana/subscriptions";

const accounts = new Map<string, { data: Buffer; owner: string } | null>();
vi.mock("@/lib/rpc", () => ({ rpc: () => ({ getAccountInfo: (a: string) => ({ send: async () => { const v = accounts.get(a) ?? null; return { value: v ? { data: [v.data.toString("base64"), "base64"], owner: v.owner } : null }; } }) }) }));

import { LEASH_LEG, leashLegOf, leashPda, leashConfigPda, legAccounts, buildPullIx, buildSettleIx, checkLeashInstructions, encodeConfig, decodeConfig, floorRaw, readReceipt, LEG_SPEC, LEASH_ERRORS, encodeHeader, encodeLeg, initConfigData, setHeaderData, setLegData, LEASH_IX, CONFIG_HEADER_LEN, CONFIG_BODY_LEN, type LeashConfig, type LeashLegByte } from "@/lib/leash";
import { LEASH_PROGRAM, USDC_MINT } from "@/lib/constants";
import { KLEND, PYTH_ACCOUNT, PYTH_FEED } from "@/lib/venues/addresses";
import { userStakePda } from "@/lib/staking";

const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
const WALLET = address("DdpHknAJvVsG8HYTAN3ZmSLLiPh2GfXP2pMoJJFa1p9m");
const DELEGATION = address("ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD");

describe("leg bytes (contracts 2.4)", () => {
  it("one byte per asset and venue; retired legs have none", () => {
    expect(LEASH_LEG).toEqual({ SKR: 0, stORE: 1, "USDC_LEND:kamino_klend": 2, "USDC_LEND:jupiter_lend": 3, "SOL_LEND:kamino_klend": 4, "SOL_LEND:jupiter_lend": 5, hSOL: 6, cbBTC: 7 });
    expect(leashLegOf("USDC_LEND", "kamino_klend")).toBe(2);
    expect(leashLegOf("cbBTC", null)).toBe(7);
    expect(() => leashLegOf("SOL_LEND", null)).toThrow(/venue/);
    expect(() => leashLegOf("hSOL", "kamino_klend")).toThrow(/venue/);
  });
  it("tolerances 100/150/10 with fee + tol <= 150; fees only on coin legs; the pinned feed per leg", () => {
    const legs = [0, 1, 2, 3, 4, 5, 6, 7] as LeashLegByte[];
    expect(legs.map((l) => LEG_SPEC[l].tolBps)).toEqual([100, 100, 10, 10, 150, 150, 100, 100]);
    expect(legs.map((l) => LEG_SPEC[l].feeBps)).toEqual([50, 50, 0, 0, 0, 0, 50, 50]);
    expect(legs.every((l) => LEG_SPEC[l].feeBps + LEG_SPEC[l].tolBps <= 150)).toBe(true);
    expect(legs.map((l) => LEG_SPEC[l].feed)).toEqual(["SKR", "ORE", null, null, "SOL", "SOL", "SOL", "CBBTC"]);
    expect(legs.map((l) => LEG_SPEC[l].decimals)).toEqual([6, 11, 6, 6, 9, 9, 9, 8]);
  });
});

describe("PDAs (contracts 2.2: the leash PDA is seeded by delegator AND user)", () => {
  it("derives ['leash', delegator, user] and ['config'] under the leash program; order matters", async () => {
    const enc = getAddressEncoder();
    const [expected] = await getProgramDerivedAddress({ programAddress: LEASH_PROGRAM, seeds: ["leash", enc.encode(WALLET), enc.encode(USER)] });
    expect(await leashPda(WALLET, USER)).toBe(expected);
    expect(await leashPda(USER, WALLET)).not.toBe(expected);
    const [config] = await getProgramDerivedAddress({ programAddress: LEASH_PROGRAM, seeds: ["config"] });
    expect(await leashConfigPda()).toBe(config);
  });
  it("the Subscriptions event authority is the one research 28 computed", async () => {
    const [ea] = await findEventAuthorityPda();
    expect(ea).toBe("3Hnj4BYoDgtpBuqXfiy7Y8cNa3jXaNd4oqgSXBzkMcH7");
  });
});

describe("pull and settle (contracts 2.5)", () => {
  it("pull: data [0][leg][amount u64][min_out u64], accounts in the contract's order", async () => {
    const puller = await generateKeyPairSigner();
    const la = await legAccounts({ leg: 2, user: USER });
    const ix = await buildPullIx({ puller, delegator: WALLET, user: USER, leg: 2, amountRaw: 2_000_000n, minOutRaw: 1_661_072n, delegationPda: DELEGATION, legAccounts: la });
    expect(Array.from(ix.data!)).toEqual([0, 2, 128, 132, 30, 0, 0, 0, 0, 0, 144, 88, 25, 0, 0, 0, 0, 0]);
    const [userKusdc] = await findAssociatedTokenPda({ owner: USER, mint: KLEND.USDC_LEND.collateralMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [pullerUsdc] = await findAssociatedTokenPda({ owner: puller.address, mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const addrs = ix.accounts!.map((a) => a.address);
    expect(addrs.length).toBe(17);
    expect(addrs[0]).toBe(puller.address);
    expect(addrs[1]).toBe(await leashConfigPda());
    expect(addrs[2]).toBe(WALLET);
    expect(addrs[3]).toBe(USER);
    expect(addrs[4]).toBe(await leashPda(WALLET, USER));
    expect(addrs[5]).toBe(DELEGATION);
    expect(addrs[8]).toBe(pullerUsdc);
    expect(addrs[9]).toBe(USDC_MINT);
    expect(addrs[12]).toBe("De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44");
    expect(addrs[13]).toBe("Sysvar1nstructions1111111111111111111111111");
    expect(addrs[14]).toBe(userKusdc);
    expect(addrs[15]).toBe("11111111111111111111111111111111");   // no price for USDC lending (2.6)
    expect(addrs[16]).toBe(KLEND.USDC_LEND.reserve);
  });
  it("settle: data [1][leg][pre u128][min_out u64][amount u64], accounts [user, config, receipt, price, readers]", async () => {
    const la = await legAccounts({ leg: 6, user: USER, priceAccount: PYTH_ACCOUNT.SOL });
    const ix = await buildSettleIx({ user: USER, leg: 6, preRaw: 123_456_789n, minOutRaw: 1_661_072n, amountRaw: 2_000_000n, legAccounts: la });
    expect(Array.from(ix.data!)).toEqual([1, 6, 21, 205, 91, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 144, 88, 25, 0, 0, 0, 0, 0, 128, 132, 30, 0, 0, 0, 0, 0]);
    expect(ix.accounts!.map((a) => a.address)).toEqual([USER, await leashConfigPda(), la.receipt, PYTH_ACCOUNT.SOL, "3wK2g8ZdzAH8FJ7PKr2RcvGh7V9VYson5hrVsJM5Lmws"]);
  });
  it("a priced leg without a price account is refused; SKR's receipt is the UserStake PDA", async () => {
    await expect(legAccounts({ leg: 7, user: USER })).rejects.toThrow(/price/);
    expect((await legAccounts({ leg: 0, user: USER, priceAccount: PYTH_ACCOUNT.SOL })).receipt).toBe(await userStakePda(USER));
  });
});

describe("checkLeashInstructions: exactly one pull and one later settle, matching (contracts 3.1)", () => {
  async function pair(over: { settleMin?: bigint; settleUser?: Address; swapReceipt?: boolean } = {}) {
    const puller = await generateKeyPairSigner();
    const la = await legAccounts({ leg: 2, user: USER });
    const pull = await buildPullIx({ puller, delegator: WALLET, user: USER, leg: 2, amountRaw: 2_000_000n, minOutRaw: 1_661_072n, delegationPda: DELEGATION, legAccounts: la });
    const other = over.swapReceipt ? { ...la, receipt: (await findAssociatedTokenPda({ owner: WALLET, mint: KLEND.USDC_LEND.collateralMint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0] } : la;
    const settle = await buildSettleIx({ user: over.settleUser ?? USER, leg: 2, preRaw: 0n, minOutRaw: over.settleMin ?? 1_661_072n, amountRaw: 2_000_000n, legAccounts: other });
    const noop: Instruction = { programAddress: address("ComputeBudget111111111111111111111111111111"), accounts: [], data: new Uint8Array([2, 0, 0, 0, 0]) };
    return { pull, settle, noop };
  }
  const want = { user: USER, leg: 2 as const, amountRaw: 2_000_000n, minOutRaw: 1_661_072n };

  it("passes pull ... settle", async () => {
    const { pull, settle, noop } = await pair();
    expect(() => checkLeashInstructions([noop, pull, noop, settle], want)).not.toThrow();
  });
  it("refuses: no settle, two pulls, settle first, a different min_out, another user, an aliased receipt, another amount", async () => {
    const { pull, settle, noop } = await pair();
    expect(() => checkLeashInstructions([noop, pull], want)).toThrow(/settle/);
    expect(() => checkLeashInstructions([pull, pull, settle], want)).toThrow(/exactly/);
    expect(() => checkLeashInstructions([settle, pull], want)).toThrow(/order/);
    const low = await pair({ settleMin: 1n });
    expect(() => checkLeashInstructions([low.pull, low.settle], want)).toThrow(/min_out/);
    const other = await pair({ settleUser: WALLET });
    expect(() => checkLeashInstructions([other.pull, other.settle], want)).toThrow(/accounts/);
    const alias = await pair({ swapReceipt: true });
    expect(() => checkLeashInstructions([alias.pull, alias.settle], want)).toThrow(/accounts/);
    expect(() => checkLeashInstructions([pull, settle], { ...want, amountRaw: 1n })).toThrow(/amount/);
    // Fix round 1 (I1): a pair built consistently for USER, checked as if for WALLET: only the pa[3] binding catches it.
    expect(() => checkLeashInstructions([pull, settle], { ...want, user: WALLET })).toThrow(/another user/);
    // Fix round 1 (minor 3): GUARD:MIN_OUT_ZERO mirrored.
    expect(() => checkLeashInstructions([pull, settle], { ...want, minOutRaw: 0n })).toThrow(/min_out is 0/);
  });
});

describe("config bytes (contracts 2.3)", () => {
  const cfg = (): LeashConfig => ({
    puller: USER, pullerUsdc: WALLET, maxPullRaw: 5_000_000n,
    legs: ([0, 1, 2, 3, 4, 5, 6, 7] as LeashLegByte[]).map((l) => ({
      enabled: l === 2 || l === 6 || l === 7, reader: LEG_SPEC[l].reader, feeBps: LEG_SPEC[l].feeBps, tolBps: LEG_SPEC[l].tolBps, confCapBps: 100, maxAgeS: LEG_SPEC[l].maxAgeS,
      receiptMint: LEG_SPEC[l].receiptMint, rateAccount: LEG_SPEC[l].rateAccount, extra: LEG_SPEC[l].extra, feedId: LEG_SPEC[l].feed ? "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d" : null, feedAccount: null,
    })),
  });
  it("encodes bytes 16..1504 at the documented offsets and decodes back", () => {
    const body = encodeConfig(cfg());
    expect(body.length).toBe(1488);
    expect(Buffer.from(body).readBigUInt64LE(64)).toBe(5_000_000n);   // abs 80
    const leg2 = 80 + 176 * 2;                                          // abs 96 + 176 * 2
    expect(body[leg2]).toBe(1);
    expect(body[leg2 + 1]).toBe(3);                                     // KLEND reader
    expect(body[leg2 + 2]).toBe(6);                                     // underlying decimals
    expect(Buffer.from(body).readUInt16LE(leg2 + 6)).toBe(10);          // tol_bps
    expect(Buffer.from(body).readUInt16LE(leg2 + 10)).toBe(60);         // max_age_s
    expect(Buffer.from(body.subarray(leg2 + 112, leg2 + 144)).every((b) => b === 0)).toBe(true);   // no feed for USDC lending
    const full = Buffer.concat([Buffer.from("LEASHCFG"), Buffer.from([1, 254]), Buffer.alloc(6), Buffer.from(body)]);
    expect(decodeConfig(new Uint8Array(full))).toEqual(cfg());
    expect(decodeConfig(body)).toEqual(cfg());
    expect(() => decodeConfig(new Uint8Array(Buffer.concat([Buffer.from("LEASHCFX"), full.subarray(8)])))).toThrow(/magic/);
  });
  it("AMEND 10-04 s20 (R325): header ++ legs == the body; the admin payloads are 81 / 81 / 178 bytes; an unset leg decodes as off", () => {
    const c = cfg();
    const body = Buffer.from(encodeConfig(c));
    const parts = [Buffer.from(encodeHeader(c)), ...([0, 1, 2, 3, 4, 5, 6, 7] as LeashLegByte[]).map((l) => Buffer.from(encodeLeg(l, c.legs[l])))];
    expect(Buffer.concat(parts).equals(body)).toBe(true);
    const init = initConfigData(c);
    expect([init.length, init[0]]).toEqual([81, 2]);
    expect(Buffer.from(init.subarray(1)).equals(body.subarray(0, 80))).toBe(true);
    const hdr = setHeaderData(c);
    expect([hdr.length, hdr[0]]).toEqual([81, 4]);
    const leg7 = setLegData(7, c);
    expect([leg7.length, leg7[0], leg7[1]]).toEqual([178, 5, 7]);
    expect(Buffer.from(leg7.subarray(2)).equals(body.subarray(80 + 176 * 7, 80 + 176 * 8))).toBe(true);
    expect(Buffer.from(leg7).readUInt16LE(2 + 10)).toBe(600);          // R324: cbBTC max_age_s
    const headerOnly = new Uint8Array(Buffer.concat([body.subarray(0, 80), Buffer.alloc(176 * 8)]));   // what init_config leaves
    expect(decodeConfig(headerOnly).legs.every((l) => !l.enabled && l.receiptMint === null && l.feedId === null)).toBe(true);
  });
});

// Golden vectors shared with track L (Review Focus 2): the program's floor (contracts 2.8) must answer the same numbers.
describe("floorRaw (contracts 2.8, amended tolerances)", () => {
  it("USDC lending, no price: ceil(net * rd / rn)", () => {
    expect(floorRaw({ leg: 2, amountRaw: 2_000_000n, rn: 12_038n, rd: 10_000n, priceLow: null, exponent: null, feeBps: 0, tolBps: 10, underlyingDecimals: 6 })).toBe(1_659_745n);
  });
  it("cbBTC at $62,000 (expo -8, conf $10)", () => {
    expect(floorRaw({ leg: 7, amountRaw: 2_000_000n, rn: 1n, rd: 1n, priceLow: 6_199_000_000_000n, exponent: -8, feeBps: 50, tolBps: 100, underlyingDecimals: 8 })).toBe(3_178n);
  });
  it("hSOL at 1.1894 SOL per hSOL and SOL $121.37 low", () => {
    expect(floorRaw({ leg: 6, amountRaw: 2_000_000n, rn: 1_189_400_000n, rd: 1_000_000_000n, priceLow: 12_137_000_000n, exponent: -8, feeBps: 50, tolBps: 100, underlyingDecimals: 9 })).toBe(13_646_678n);
  });
  it("SKR shares at share price 1.149090094, the same floor at exponent -8 and -5", () => {
    expect(floorRaw({ leg: 0, amountRaw: 2_000_000n, rn: 1_149_090_094n, rd: 1_000_000_000n, priceLow: 1_829_000n, exponent: -8, feeBps: 50, tolBps: 100, underlyingDecimals: 6 })).toBe(93_734_279n);
    expect(floorRaw({ leg: 0, amountRaw: 2_000_000n, rn: 1_149_090_094n, rd: 1_000_000_000n, priceLow: 1_829n, exponent: -5, feeBps: 50, tolBps: 100, underlyingDecimals: 6 })).toBe(93_734_279n);
  });
});

describe("readReceipt (what pull will read as pre)", () => {
  const TOK = "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6";
  const NONE = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
  const STAKE = "9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm";
  it("a token receipt reads u64 @64; a missing account reads 0; a UserStake reads shares u128 @105", async () => {
    const tok = Buffer.alloc(165); tok.writeBigUInt64LE(777n, 64);
    accounts.set(TOK, { data: tok, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" });
    expect(await readReceipt({ leg: 7, receipt: address(TOK) })).toBe(777n);
    expect(await readReceipt({ leg: 7, receipt: address(NONE) })).toBe(0n);
    const us = Buffer.alloc(140); us.writeBigUInt64LE(5n, 105); us.writeBigUInt64LE(1n, 113);
    accounts.set(STAKE, { data: us, owner: "SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ" });
    expect(await readReceipt({ leg: 0, receipt: address(STAKE) })).toBe(5n + (1n << 64n));
  });
  it("labels the program's error codes", () => {
    expect(LEASH_ERRORS[6005]).toBe("MissingSettle");
    expect(LEASH_ERRORS[6023]).toBe("AlreadyInitialized");
  });
});

// ---- Cross-check against the BUILT program (feat/leash-program 2cbb1ae) ----
// GOLDEN_BODY_HEX is printed by the program's own source: leash/program/src/{constants,config,price}.rs compiled via #[path]
// into a scratch binary (generator: .superpowers/sdd/2026-10-05-lending-api/task-5-golden-gen.rs), running config::encode_body on a
// verbatim port of leash/tests/src/cfg.rs mainnet_config(PULLER_MAINNET, PULLER_MAINNET_USDC, DAY1). config::validate == Ok.
const GOLDEN_BODY_HEX = [
  "f222a3d1d02bc821107e18142a705dd586481cfa72582c366767ad67785b95f81ec59ebce472327878d9c2e5b0df7c2a10e19136c8f6ae67e5952656d6fd36b5",
  "404b4c00000000000000000000000000000106003200640064003c00000000000000000000000000000000000000000000000000000000000000000000000000",
  "30c77438562d45ef5b79292f61cf0f3514359d8ce0b336e59766ad0889b1bcdeb80252d18db52b8e351589bd02fb8d1cb3265705f5ae0b00d29ba798e1c25de1",
  "38846ec4d0dbe808091817f5c0d6ab8058e25422348ddf97db52b6c378a93bf90000000000000000000000000000000000000000000000000000000000000000",
  "00050b003200640064003c00000000000d099eaaa4925fe4f2ba376df54c2c699c1ceefb5679557df6a497505e641608353d100dcc011e393ea6b011682db777",
  "6d4437433cf6b8623755b7c2b05a22390d099eaaa4925fe4f2ba376df54c2c699c1ceefb5679557df6a497505e641608142b804c658e14ff60886783e46e5a51",
  "bdf398b4871d9d8f7c28aa1585cad50400000000000000000000000000000000000000000000000000000000000000000103060000000a0064003c0000000000",
  "967fb3b7585eb44337656bd01603bb5579d54770b9d40b1eae4c0cc3a80c6ddcb3ca896fdd9e7319a26e06cdf9ad5fee4e23f249bb4067c89d5b602acd22e06c",
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "00000000000000000000000000000000000000000000000000000000000000000004060000000a0064003c0000000000797cb33cad6c0c8073b21da4c4376405",
  "85ed39f6b04672c87a51d6058cb726fa1c8fbd49ef4febbeed09ff24ced7aef8506c6a7a58d6b1bc4ccf204b1864c88500000000000000000000000000000000",
  "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "00000000000000000000000000000000000309000000960064003c00000000001606c07f20b1bac6c472864428aae09c920677dd01f0dc542bcdb0255f08d6b8",
  "093c7a30a890051b38e708f1fc74369caea19b8b5a0adf3bc79deb89cd0b2d910000000000000000000000000000000000000000000000000000000000000000",
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d0000000000000000000000000000000000000000000000000000000000000000",
  "000409000000960064003c00000000001c48e3967bc6617d446cfaeb8fc72c465f736de08e9063b38406de6955fb2e439e1a7ba851d7b5e25ea43f0c14bb8d44",
  "e3ac00d4604c3a4f50954cf7a05ff5de0000000000000000000000000000000000000000000000000000000000000000ef0d8b6fda2ceba41da15d4095d1da39",
  "2a0d2f8ed0c6c7bc0f4cfac8c280b56d0000000000000000000000000000000000000000000000000000000000000000010209003200640064003c0000000000",
  "0a69151da650d7b016aa1fa8e607b91590b5a15a080bc7e22020f3bb82ecddc52ba11f736cbc6abd83457d8c23daa7635a2bee5578ce3a0d9815602d4e7d6196",
  "0000000000000000000000000000000000000000000000000000000000000000ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  "000000000000000000000000000000000000000000000000000000000000000001000800320064006400580200000000091e73d17a5526d448e589aea5afe7c2",
  "2cd61c5b66a86a427ab262309514e55c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
  "000000000000000000000000000000002817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a9700000000000000000000000000000000",
  "00000000000000000000000000000000",
].join("");

describe("byte-for-byte against the leash program (feat/leash-program)", () => {
  const PULLER_MAINNET = address("HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd");
  const PULLER_MAINNET_USDC = address("3581Qy3hmNHiy8gkRPqyvyWoZ4Lt6sXc3jfokDNW6Eap");
  const DAY1 = [false, false, true, false, false, false, true, true];
  const golden = (): LeashConfig => ({
    puller: PULLER_MAINNET, pullerUsdc: PULLER_MAINNET_USDC, maxPullRaw: 5_000_000n,
    legs: ([0, 1, 2, 3, 4, 5, 6, 7] as LeashLegByte[]).map((l) => {
      const s = LEG_SPEC[l];
      return { enabled: DAY1[l], reader: s.reader, feeBps: s.feeBps, tolBps: s.tolBps, confCapBps: 100, maxAgeS: s.maxAgeS,
        receiptMint: s.receiptMint, rateAccount: s.rateAccount, extra: s.extra, feedId: s.feed ? PYTH_FEED[s.feed] : null, feedAccount: null };
    }),
  });
  it("encodeConfig(LEG_SPEC + the pinned feeds) equals the program's encode_body of the golden Config", () => {
    expect(Buffer.from(encodeConfig(golden())).toString("hex")).toBe(GOLDEN_BODY_HEX);
    expect(decodeConfig(Buffer.from(GOLDEN_BODY_HEX, "hex"))).toEqual(golden());
  });
  it("init_config and set_leg(7) data equal the program's [2][encode_header] and [5][7][encode_leg]", () => {
    expect(Buffer.from(initConfigData(golden())).toString("hex")).toBe("02f222a3d1d02bc821107e18142a705dd586481cfa72582c366767ad67785b95f81ec59ebce472327878d9c2e5b0df7c2a10e19136c8f6ae67e5952656d6fd36b5404b4c00000000000000000000000000");
    expect(Buffer.from(setLegData(7, golden())).toString("hex")).toBe("050701000800320064006400580200000000091e73d17a5526d448e589aea5afe7c22cd61c5b66a86a427ab262309514e55c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002817d7bfe5c64b8ea956e9a26f573ef64e72e4d7891f2d6af9bcc93f7aff9a970000000000000000000000000000000000000000000000000000000000000000");
  });
  it("tags and lengths match constants.rs", () => {
    expect(LEASH_IX).toEqual({ pull: 0, settle: 1, initConfig: 2, setHeader: 4, setLeg: 5 });
    expect(Object.values(LEASH_IX)).not.toContain(3);   // the retired full-body set_config answers BadData
    expect([CONFIG_HEADER_LEN, CONFIG_BODY_LEN]).toEqual([80, 1488]);
    expect(([0, 1, 2, 3, 4, 5, 6, 7] as LeashLegByte[]).map((l) => LEG_SPEC[l].reader)).toEqual([1, 5, 3, 4, 3, 4, 2, 0]);   // READER_OF_LEG
    expect(([0, 1, 2, 3, 4, 5, 6, 7] as LeashLegByte[]).map((l) => LEG_SPEC[l].maxAgeS)).toEqual([60, 60, 60, 60, 60, 60, 60, 600]);   // MAX_AGE_S_OF_LEG
    expect(([0, 1, 2, 3, 4, 5, 6, 7] as LeashLegByte[]).map((l) => LEG_SPEC[l].readers.length)).toEqual([1, 2, 1, 1, 1, 1, 1, 0]);   // READER_ACCOUNTS[reader]
  });
  // leash/tests/tests/unit_floor.rs, verbatim (floor_vectors, store_donation_halves_the_floor, the two error tests).
  it("floorRaw answers the program's unit_floor vectors", () => {
    // The leg picks the branch (Fix round 1, I2): unpriced vectors run as leg 2, priced ones as the leg they describe.
    const f = (leg: LeashLegByte, amount: bigint, rn: bigint, rd: bigint, p: [bigint, number] | null, fee: number, tol: number, dec: number) =>
      floorRaw({ leg, amountRaw: amount, rn, rd, priceLow: p ? p[0] : null, exponent: p ? p[1] : null, feeBps: fee, tolBps: tol, underlyingDecimals: dec });
    expect(f(7, 5_000_000n, 1n, 1n, [6_500_000_000_000n, -8], 50, 100, 8)).toBe(7_577n);
    expect(f(2, 2_000_000n, 1_200_000_000_000n, 1_000_000_000_000n, null, 0, 10, 6)).toBe(1_665_000n);
    expect(f(2, 1_000_001n, 1_200_001n, 1_000_000n, null, 0, 10, 6)).toBe(832_500n);
    expect(f(4, 5_000_000n, 11_551n, 10n, [1_499_000n, -4], 0, 150, 9)).toBe(28_444n);
    expect(f(0, 1_000_000n, 1_149_090_094n, 1_000_000_000n, [1_990_000n, -8], 50, 100, 6)).toBe(43_075_376n);
    expect(f(6, 5_000_000n, 1_250_000_000n, 1_000_000_000n, [15_000_000_000n, -8], 50, 100, 9)).toBe(26_266_667n);
    expect(f(1, 5_000_000n, 1_051_100_000n, 1_000_000_000n, [13_100_000_000n, -8], 50, 100, 11)).toBe(3_576_769_085n);
    expect(f(1, 5_000_000n, 2_102_200_000n, 1_000_000_000n, [13_100_000_000n, -8], 50, 100, 11)).toBe(1_788_384_543n);
    expect(() => f(2, 5_000_000n, 0n, 1_000_000n, null, 0, 10, 6)).toThrow(/BadReader/);
    expect(() => f(2, 5_000_000n, 1_000_000n, 0n, null, 0, 10, 6)).toThrow(/BadReader/);
    expect(() => f(1, (1n << 64n) - 1n, 1n, ((1n << 128n) - 1n) / 2n, [1n, -12], 0, 0, 11)).toThrow(/Overflow/);
    // Fix round 1 (minor 4): the negative margin is Overflow (checked_sub), p_low 0 is PriceConfidence.
    expect(() => f(7, 5_000_000n, 1n, 1n, [6_500_000_000_000n, -8], 100, 9_901, 8)).toThrow(/Overflow/);
    expect(() => f(7, 5_000_000n, 1n, 1n, [0n, -8], 50, 100, 8)).toThrow(/PriceConfidence/);
  });
  it("Fix round 1 (I2): the leg, not the price's presence, picks the formula; a price must be positive", () => {
    const base = { amountRaw: 2_000_000n, rn: 1_189_400_000n, rd: 1_000_000_000n, feeBps: 50, tolBps: 100, underlyingDecimals: 9 };
    expect(() => floorRaw({ ...base, leg: 6, priceLow: null, exponent: null })).toThrow(/BadPriceAccount.*priced and has no price/);
    expect(() => floorRaw({ ...base, leg: 6, priceLow: 12_137_000_000n, exponent: null })).toThrow(/BadPriceAccount/);
    expect(() => floorRaw({ ...base, leg: 2, priceLow: 100_000_000n, exponent: -8, feeBps: 0, tolBps: 10, underlyingDecimals: 6 })).toThrow(/BadPriceAccount.*unpriced and got a price/);
    expect(() => floorRaw({ ...base, leg: 6, priceLow: -12_137_000_000n, exponent: -8 })).toThrow(/PriceConfidence/);
    expect(floorRaw({ ...base, leg: 6, priceLow: 12_137_000_000n, exponent: -8 })).toBe(13_646_678n);
  });
});
