import { describe, it, expect } from "vitest";
import { address, generateKeyPairSigner, getAddressEncoder, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { readKlendRate, klendMinOut, buildKlendDepositIxs, checkKlendDepositInstructions, klendDeliveryShortfall, klendDepositIx, klendRedeemIx, klendRefreshIx, buildKlendWithdrawIxs, buildKlendUserDepositIxs, RESERVE_LEN } from "@/lib/venues/klend";
import { KLEND, KLEND_MARKET, KLEND_LMA, KLEND_JUNK_USDC_RESERVE } from "@/lib/venues/addresses";
import { KLEND_PROGRAM, USDC_MINT } from "@/lib/constants";

const enc = getAddressEncoder();
const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
const OTHER = address("DdpHknAJvVsG8HYTAN3ZmSLLiPh2GfXP2pMoJJFa1p9m");

function reserve(over: { market?: string; collateralMint?: string; disc?: string; available?: bigint; borrowedSf?: bigint; protocolFeesSf?: bigint; supply?: bigint; len?: number } = {}) {
  const b = Buffer.alloc(over.len ?? RESERVE_LEN);
  Buffer.from(over.disc ?? "2bf2ccca1af73b7f", "hex").copy(b, 0);
  Buffer.from(enc.encode(address(over.market ?? KLEND_MARKET))).copy(b, 32);
  Buffer.from(enc.encode(KLEND.USDC_LEND.liquidityMint)).copy(b, 128);
  b.writeBigUInt64LE(over.available ?? 1_000_000n, 224);
  const sf = over.borrowedSf ?? 5_000_000n << 60n;
  b.writeBigUInt64LE(sf & 0xffff_ffff_ffff_ffffn, 232); b.writeBigUInt64LE(sf >> 64n, 240);
  const pf = over.protocolFeesSf ?? 0n;
  b.writeBigUInt64LE(pf & 0xffff_ffff_ffff_ffffn, 344); b.writeBigUInt64LE(pf >> 64n, 352);
  Buffer.from(enc.encode(address(over.collateralMint ?? KLEND.USDC_LEND.collateralMint))).copy(b, 2560);
  b.writeBigUInt64LE(over.supply ?? 5_000_000n, 2592);
  return new Uint8Array(b);
}

describe("readKlendRate (contracts 2.7 KLEND reader; rd = the reserve's own collateral-supply field)", () => {
  it("rn = available + (borrowed_sf - fees_sf) >> 60, rd = the reserve's collateral supply @2592", () => {
    expect(readKlendRate(reserve(), "USDC_LEND")).toEqual({ rn: 6_000_000n, rd: 5_000_000n, availableRaw: 1_000_000n });
    expect(readKlendRate(reserve({ protocolFeesSf: 1_000_000n << 60n }), "USDC_LEND").rn).toBe(5_000_000n);
  });
  it("refuses another market, the junk reserve's collateral mint, a wrong discriminator or length", () => {
    expect(() => readKlendRate(reserve({ market: OTHER }), "USDC_LEND")).toThrow(/market/);
    expect(() => readKlendRate(reserve({ collateralMint: KLEND_JUNK_USDC_RESERVE.collateralMint }), "USDC_LEND")).toThrow(/collateral/);
    expect(() => readKlendRate(reserve({ disc: "0000000000000000" }), "USDC_LEND")).toThrow(/Reserve/);
    expect(() => readKlendRate(reserve({ len: 8000 }), "USDC_LEND")).toThrow(/bytes/);
  });
  it("min_out keeps a 2 bp margin for the refresh accrual", () => {
    expect(klendMinOut(2_000_000n, { rn: 12_038n, rd: 10_000n })).toBe(1_661_072n);
  });
});

describe("checkKlendDepositInstructions (contracts 3.3), mutation-proven", () => {
  async function built() {
    const puller = await generateKeyPairSigner();
    const ixs = await buildKlendDepositIxs({ puller, user: USER, asset: "USDC_LEND", amountRaw: 2_000_000n });
    return { puller, ixs };
  }
  it("passes what buildKlendDepositIxs builds: refresh then deposit, into the user's canonical kUSDC account", async () => {
    const { puller, ixs } = await built();
    const k = ixs.filter((ix) => ix.programAddress === KLEND_PROGRAM);
    expect(k.length).toBe(2);
    expect(Buffer.from(k[1].data!).subarray(8).readBigUInt64LE(0)).toBe(2_000_000n);
    await expect(checkKlendDepositInstructions(ixs, { puller: puller.address, user: USER, asset: "USDC_LEND" })).resolves.toBeUndefined();
  });
  it("refuses a deposit into another owner's kToken account", async () => {
    const { puller, ixs } = await built();
    const [alias] = await findAssociatedTokenPda({ owner: OTHER, mint: KLEND.USDC_LEND.collateralMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [src] = await findAssociatedTokenPda({ owner: puller.address, mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const bad = ixs.map((ix) => (ix.data?.[0] === 169 ? klendDepositIx({ owner: puller, asset: "USDC_LEND", source: src, destination: alias, amountRaw: 2_000_000n }) : ix));
    await expect(checkKlendDepositInstructions(bad, { puller: puller.address, user: USER, asset: "USDC_LEND" })).rejects.toThrow(/accounts/);
  });
  it("refuses a deposit drawn from another source account", async () => {
    const { puller, ixs } = await built();
    const [dest] = await findAssociatedTokenPda({ owner: USER, mint: KLEND.USDC_LEND.collateralMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [foreign] = await findAssociatedTokenPda({ owner: OTHER, mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const bad = ixs.map((ix) => (ix.data?.[0] === 169 ? klendDepositIx({ owner: puller, asset: "USDC_LEND", source: foreign, destination: dest, amountRaw: 2_000_000n }) : ix));
    await expect(checkKlendDepositInstructions(bad, { puller: puller.address, user: USER, asset: "USDC_LEND" })).rejects.toThrow(/accounts/);
  });
  it("refuses the junk reserve, an extra K-Lend instruction, and deposit-before-refresh", async () => {
    const { puller, ixs } = await built();
    const junkRefresh: Instruction = { ...klendRefreshIx("USDC_LEND"), accounts: klendRefreshIx("USDC_LEND").accounts!.map((a, i) => (i === 0 ? { ...a, address: KLEND_JUNK_USDC_RESERVE.reserve } : a)) };
    await expect(checkKlendDepositInstructions(ixs.map((ix) => (ix.data?.[0] === 2 ? junkRefresh : ix)), { puller: puller.address, user: USER, asset: "USDC_LEND" })).rejects.toThrow(/accounts/);
    const [src] = await findAssociatedTokenPda({ owner: USER, mint: KLEND.USDC_LEND.collateralMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const extra = klendRedeemIx({ owner: puller, asset: "USDC_LEND", source: src, destination: src, amountRaw: 1n });
    await expect(checkKlendDepositInstructions([...ixs, extra], { puller: puller.address, user: USER, asset: "USDC_LEND" })).rejects.toThrow(/K-Lend instructions/);
    const k = ixs.filter((ix) => ix.programAddress === KLEND_PROGRAM);
    await expect(checkKlendDepositInstructions([k[1], k[0]], { puller: puller.address, user: USER, asset: "USDC_LEND" })).rejects.toThrow(/refresh/);
  });
});

describe("klendDeliveryShortfall (contracts 3.3 delivery guard)", () => {
  it("the user's kToken account must gain at least min_out; no balance fails closed", () => {
    const sim = (pre: bigint, post: bigint) => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre, post } });
    expect(klendDeliveryShortfall(sim(0n, 1_661_072n), { minOutRaw: 1_661_072n })).toBeNull();
    expect(klendDeliveryShortfall(sim(0n, 1_661_071n), { minOutRaw: 1_661_072n })).toMatch(/under the minimum/);
    expect(klendDeliveryShortfall({ ok: true, err: null, logs: [], units: 1 }, { minOutRaw: 1n })).toMatch(/no delivery/);
  });
});

describe("user-signed K-Lend flows (contracts 6 withdraw_klend)", () => {
  it("USDC: [ATA create], refresh, redeem(receiptRaw) with the 12 accounts in sign.ts's order", async () => {
    const ixs = await buildKlendWithdrawIxs({ user: USER, asset: "USDC_LEND", receiptRaw: 1_661_072n });
    expect(ixs.length).toBe(3);
    const redeem = ixs[2];
    expect(Buffer.from(redeem.data!).subarray(0, 8).toString("hex")).toBe("ea75b57db98edc1d");
    expect(Buffer.from(redeem.data!).readBigUInt64LE(8)).toBe(1_661_072n);
    const [kAta] = await findAssociatedTokenPda({ owner: USER, mint: KLEND.USDC_LEND.collateralMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [usdcAta] = await findAssociatedTokenPda({ owner: USER, mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    expect(redeem.accounts!.map((a) => a.address)).toEqual([USER, KLEND_MARKET, KLEND.USDC_LEND.reserve, KLEND_LMA, KLEND.USDC_LEND.liquidityMint, KLEND.USDC_LEND.collateralMint, KLEND.USDC_LEND.supplyVault, kAta, usdcAta, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "Sysvar1nstructions1111111111111111111111111"]);
  });
  it("SOL: the WSOL account is created, redeemed into, then closed to the user", async () => {
    const ixs = await buildKlendWithdrawIxs({ user: USER, asset: "SOL_LEND", receiptRaw: 10n });
    expect(ixs.length).toBe(4);
    expect(Array.from(ixs[3].data!)).toEqual([9]);
  });
});

/**
 * The app's verifier pins these shapes (sprouts lending-app task-6 report, "Final account-role table"; contracts 6).
 * Every literal below is typed out from that table, not taken from klend.ts, so a drift in the builder goes red here.
 */
describe("user-signed K-Lend builders equal sign.ts's pinned table (contracts 6, app T6)", () => {
  const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const ATOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const SYSTEM = "11111111111111111111111111111111";
  const SYSVAR_IX = "Sysvar1nstructions1111111111111111111111111";
  const KLEND_ID = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
  const MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
  const LMA = "9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo";
  const SCOPE = "3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH";
  const ROW = {
    USDC_LEND: { reserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59", liquidityMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", supplyVault: "Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6", collateralMint: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D" },
    SOL_LEND: { reserve: "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q", liquidityMint: "So11111111111111111111111111111111111111112", supplyVault: "GafNuUXj9rxGLn4y79dPu6MHSuPWeJR6UtTWuexpGh3U", collateralMint: "2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1" },
  } as const;
  const ataOf = async (owner: string, mint: string) => (await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0] as string;
  const shape = (ixs: Instruction[]) => ixs.map((ix) => ({ program: ix.programAddress as string, data: Buffer.from(ix.data ?? []).toString("hex"), accounts: (ix.accounts ?? []).map((a) => a.address as string) }));
  const u64hex = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b.toString("hex"); };

  async function withdrawTable(asset: "USDC_LEND" | "SOL_LEND", receiptRaw: bigint) {
    const r = ROW[asset];
    const und = await ataOf(USER, r.liquidityMint);
    const k = await ataOf(USER, r.collateralMint);
    const rows = [
      { program: ATOKEN, data: "01", accounts: [USER, und, USER, r.liquidityMint, SYSTEM, TOKEN] },
      { program: KLEND_ID, data: "02da8aeb4fc91966", accounts: [r.reserve, MARKET, KLEND_ID, KLEND_ID, KLEND_ID, SCOPE] },
      { program: KLEND_ID, data: "ea75b57db98edc1d" + u64hex(receiptRaw), accounts: [USER, MARKET, r.reserve, LMA, r.liquidityMint, r.collateralMint, r.supplyVault, k, und, TOKEN, TOKEN, SYSVAR_IX] },
    ];
    if (asset === "SOL_LEND") rows.push({ program: TOKEN, data: "09", accounts: [und, USER, USER] });
    return rows;
  }

  it("withdraw_klend USDC: create, refresh, redeem, every account in order", async () => {
    expect(shape(await buildKlendWithdrawIxs({ user: USER, asset: "USDC_LEND", receiptRaw: 1_661_072n }))).toEqual(await withdrawTable("USDC_LEND", 1_661_072n));
  });
  it("withdraw_klend SOL: create (required), refresh, redeem into the WSOL ATA, close to the user", async () => {
    expect(shape(await buildKlendWithdrawIxs({ user: USER, asset: "SOL_LEND", receiptRaw: 987_654n }))).toEqual(await withdrawTable("SOL_LEND", 987_654n));
  });
  it("move part deposit into K-Lend (USDC and SOL): create kToken ATA, refresh, deposit from the user's underlying; SOL closes WSOL", async () => {
    for (const asset of ["USDC_LEND", "SOL_LEND"] as const) {
      const r = ROW[asset];
      const und = await ataOf(USER, r.liquidityMint);
      const k = await ataOf(USER, r.collateralMint);
      const want = [
        { program: ATOKEN, data: "01", accounts: [USER, k, USER, r.collateralMint, SYSTEM, TOKEN] },
        { program: KLEND_ID, data: "02da8aeb4fc91966", accounts: [r.reserve, MARKET, KLEND_ID, KLEND_ID, KLEND_ID, SCOPE] },
        { program: KLEND_ID, data: "a9c91e7e06cd6644" + u64hex(5_000n), accounts: [USER, r.reserve, MARKET, LMA, r.liquidityMint, r.supplyVault, r.collateralMint, und, k, TOKEN, TOKEN, SYSVAR_IX] },
      ];
      if (asset === "SOL_LEND") want.push({ program: TOKEN, data: "09", accounts: [und, USER, USER] });
      expect(shape(await buildKlendUserDepositIxs({ user: USER, asset, depositRaw: 5_000n }))).toEqual(want);
    }
  });
  it("user-signed builders carry no ComputeBudget and only the user signs (contracts 6 AMEND)", async () => {
    const all = [
      ...(await buildKlendWithdrawIxs({ user: USER, asset: "USDC_LEND", receiptRaw: 1n })),
      ...(await buildKlendWithdrawIxs({ user: USER, asset: "SOL_LEND", receiptRaw: 1n })),
      ...(await buildKlendUserDepositIxs({ user: USER, asset: "USDC_LEND", depositRaw: 1n })),
      ...(await buildKlendUserDepositIxs({ user: USER, asset: "SOL_LEND", depositRaw: 1n })),
    ];
    expect(all.some((ix) => ix.programAddress === "ComputeBudget111111111111111111111111111111")).toBe(false);
    const signers = new Set(all.flatMap((ix) => (ix.accounts ?? []).filter((a) => a.role >= 2).map((a) => a.address as string)));
    expect([...signers]).toEqual([USER]);
  });
});
