import { describe, it, expect } from "vitest";
import { address, generateKeyPairSigner, getAddressEncoder, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda, getBurnInstruction, getTransferInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { readJlendRate, jlendShares, buildJlendDepositIxs, checkJlendDepositInstructions, jlendDeliveryShortfall, buildJlendWithdrawIxs, buildJlendUserDepositIxs, JL_EXPECTED_LEFTOVER, LENDING_LEN } from "@/lib/venues/jlend";
import { JLEND } from "@/lib/venues/addresses";
import { JLEND_PROGRAM } from "@/lib/constants";

const enc = getAddressEncoder();
const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
const OTHER = address("DdpHknAJvVsG8HYTAN3ZmSLLiPh2GfXP2pMoJJFa1p9m");
const PRICE = 1_062_915_000_000n;   // 1.062915, the API's convertToAssets on 10-04

function lending(over: { fMint?: string; price?: bigint; len?: number } = {}) {
  const b = Buffer.alloc(Math.max(over.len ?? LENDING_LEN, LENDING_LEN));   // fill a full account, then cut to `len` (a short buffer would throw in the fixture, not the reader)
  Buffer.from("87c75210f983b6f1", "hex").copy(b, 0);
  Buffer.from(enc.encode(JLEND.USDC_LEND.mint)).copy(b, 8);
  Buffer.from(enc.encode(address(over.fMint ?? JLEND.USDC_LEND.fTokenMint))).copy(b, 40);
  b.writeBigUInt64LE(over.price ?? PRICE, 115);
  return new Uint8Array(b.subarray(0, over.len ?? LENDING_LEN));
}

describe("Jupiter Lend rate and shares", () => {
  it("reads token_exchange_price over 1e12 and refuses another f-token mint", () => {
    expect(readJlendRate(lending(), "USDC_LEND")).toEqual({ rn: PRICE, rd: 1_000_000_000_000n });
    expect(() => readJlendRate(lending({ fMint: OTHER }), "USDC_LEND")).toThrow(/f-token/);
    expect(() => readJlendRate(lending({ len: 100 }), "USDC_LEND")).toThrow(/bytes/);
  });
  it("asks for shares worth 2 bp under the deposit; min_out is shares - 1", () => {
    expect(jlendShares(2_000_000n, PRICE)).toBe(1_881_241n);
  });
});

describe("buildJlendDepositIxs + checkJlendDepositInstructions (contracts 3.2 step 5b, 3.3), mutation-proven", () => {
  async function built(over: { pullerJlBalance?: bigint; leftover?: 0n | 1n } = {}) {
    const puller = await generateKeyPairSigner();
    const r = await buildJlendDepositIxs({ puller, user: USER, asset: "USDC_LEND", depositRaw: 2_000_000n, rn: PRICE, pullerJlBalance: over.pullerJlBalance ?? 0n, leftover: over.leftover ?? 0n });
    return { puller, ...r };
  }
  it("leftover 0 (N - 1 minted): mint into the puller's jl account, transfer shares - 1 to the user's canonical jl account, close", async () => {
    const { puller, ixs, shares, minOutRaw, pullerJl } = await built();
    expect(shares).toBe(1_881_241n);
    expect(minOutRaw).toBe(1_881_240n);
    const [expectedPullerJl] = await findAssociatedTokenPda({ owner: puller.address, mint: JLEND.USDC_LEND.fTokenMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    expect(pullerJl).toBe(expectedPullerJl);
    const mint = ixs.find((ix) => ix.programAddress === JLEND_PROGRAM)!;
    const d = Buffer.from(mint.data!);
    expect(d.subarray(0, 8).toString("hex")).toBe("065e457a1eb392ab");
    expect(d.readBigUInt64LE(8)).toBe(1_881_241n);
    expect(d.readBigUInt64LE(16)).toBe(2_000_000n);
    expect(ixs.map((ix) => ix.data?.[0])).toEqual([1, 1, 6, 3, 9]);   // ATA x2, mint (disc 0x06...), Transfer, CloseAccount
    await expect(checkJlendDepositInstructions(ixs, { puller: puller.address, user: USER, asset: "USDC_LEND" })).resolves.toBeUndefined();
  });
  it("leftover 1 (N minted): the one share left after the transfer is burned before the close", async () => {
    const { puller, ixs, minOutRaw } = await built({ leftover: 1n });
    expect(minOutRaw).toBe(1_881_240n);
    expect(ixs.map((ix) => ix.data?.[0])).toEqual([1, 1, 6, 3, 8, 9]);
    expect(Buffer.from(ixs[4].data!).readBigUInt64LE(1)).toBe(1n);
    await expect(checkJlendDepositInstructions(ixs, { puller: puller.address, user: USER, asset: "USDC_LEND" })).resolves.toBeUndefined();
  });
  it("foreign dust already in the puller's jl account is burned before the mint (Claude audit F9)", async () => {
    const { puller, ixs } = await built({ pullerJlBalance: 7n });
    expect(ixs.map((ix) => ix.data?.[0])).toEqual([1, 1, 8, 6, 3, 9]);
    await expect(checkJlendDepositInstructions(ixs, { puller: puller.address, user: USER, asset: "USDC_LEND" })).resolves.toBeUndefined();
  });
  it("refuses a burn of more than one share after the transfer (it would eat the user's shares)", async () => {
    const { puller, ixs, pullerJl } = await built({ leftover: 1n });
    const bad = ixs.map((ix, i) => (i === 4 ? getBurnInstruction({ account: pullerJl, mint: JLEND.USDC_LEND.fTokenMint, authority: puller, amount: 2n }) as Instruction : ix));
    await expect(checkJlendDepositInstructions(bad, { puller: puller.address, user: USER, asset: "USDC_LEND" })).rejects.toThrow(/burn/);
  });
  it("refuses a transfer to another owner's jl account", async () => {
    const { puller, ixs, pullerJl } = await built();
    const [alias] = await findAssociatedTokenPda({ owner: OTHER, mint: JLEND.USDC_LEND.fTokenMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const bad = ixs.map((ix) => (ix.data?.[0] === 3 ? getTransferInstruction({ source: pullerJl, destination: alias, authority: puller, amount: 1_881_240n }) as Instruction : ix));
    await expect(checkJlendDepositInstructions(bad, { puller: puller.address, user: USER, asset: "USDC_LEND" })).rejects.toThrow(/transfer/);
  });
  it("refuses a plan with no close (the zero-residue assertion) and a second Jupiter Lend instruction", async () => {
    const { puller, ixs } = await built();
    await expect(checkJlendDepositInstructions(ixs.filter((ix) => ix.data?.[0] !== 9), { puller: puller.address, user: USER, asset: "USDC_LEND" })).rejects.toThrow(/close/);
    const mint = ixs.find((ix) => ix.programAddress === JLEND_PROGRAM)!;
    await expect(checkJlendDepositInstructions([...ixs, mint], { puller: puller.address, user: USER, asset: "USDC_LEND" })).rejects.toThrow(/Jupiter Lend instructions/);
  });
});

describe("jlendDeliveryShortfall (contracts 3.3)", () => {
  const P = address("11111111111111111111111111111112");
  it("the user's jl account gains min_out AND the puller's jl account is gone after", () => {
    const sim = (post: bigint, pullerPost: bigint | null) => ({ ok: true, err: null, logs: [], units: 1, delivery: { pre: 0n, post }, watched: { [P]: { pre: null, post: pullerPost } } });
    expect(jlendDeliveryShortfall(sim(1_881_240n, null), { minOutRaw: 1_881_240n, pullerJl: P })).toBeNull();
    expect(jlendDeliveryShortfall(sim(1_881_240n, 1n), { minOutRaw: 1_881_240n, pullerJl: P })).toMatch(/still holds/);
    expect(jlendDeliveryShortfall(sim(1_881_239n, null), { minOutRaw: 1_881_240n, pullerJl: P })).toMatch(/under the minimum/);
    expect(jlendDeliveryShortfall({ ok: true, err: null, logs: [], units: 1, delivery: { pre: 0n, post: 1_881_240n } }, { minOutRaw: 1_881_240n, pullerJl: P })).toMatch(/watched/);
  });
});

describe("user-signed Jupiter Lend withdraw (contracts 6 withdraw_jlend)", () => {
  it("[ATA create], redeem(receiptRaw) with 18 accounts in sign.ts's order; SOL closes WSOL", async () => {
    const ixs = await buildJlendWithdrawIxs({ user: USER, asset: "USDC_LEND", receiptRaw: 1_881_240n });
    const redeem = ixs[1];
    expect(Buffer.from(redeem.data!).subarray(0, 8).toString("hex")).toBe("b80c569546c461e1");
    expect(redeem.accounts!.length).toBe(18);
    const j = JLEND.USDC_LEND;
    const [fAta] = await findAssociatedTokenPda({ owner: USER, mint: j.fTokenMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [uAta] = await findAssociatedTokenPda({ owner: USER, mint: j.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    expect(redeem.accounts!.slice(0, 7).map((a) => a.address)).toEqual([USER, fAta, uAta, "5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6", j.lending, j.mint, j.fTokenMint]);
    expect(redeem.accounts![11].address).toBe(j.claimAccount);
    expect((await buildJlendWithdrawIxs({ user: USER, asset: "SOL_LEND", receiptRaw: 5n })).length).toBe(3);
  });
});

describe("share math and leftover agree with the leash fork measurements (leash Task 7)", () => {
  // Measured on the mainnet fork: the venue mints ONE share less than asked (20,000,000 -> 19,999,999), USDC and SOL; the
  // stored exchange price lags the mint-time price by ~5e-7, so `assets * rd / rn - 2` shares costs more than max_assets.
  const S = 1_000_000_000_000n;
  const lagged = (rn: bigint) => rn + (rn * 5n) / 10_000_000n;
  const cost = (shares: bigint, price: bigint) => (shares * price + S - 1n) / S;
  for (const [asset, rn] of [["USDC_LEND", PRICE], ["SOL_LEND", 1_041_337_000_000n]] as const) {
    it(`${asset}: the 2 bp shares fit max_assets at the lagged price where the naive "- 2" does not`, () => {
      const deposit = 20_000_000n;
      expect(cost(jlendShares(deposit, rn), lagged(rn))).toBeLessThanOrEqual(deposit);
      expect(cost((deposit * S) / rn - 2n, lagged(rn))).toBeGreaterThan(deposit);
    });
    it(`${asset}: N - 1 minted, shares - 1 transferred leaves exactly JL_EXPECTED_LEFTOVER (0) in the puller's jl account`, async () => {
      const puller = await generateKeyPairSigner();
      const r = await buildJlendDepositIxs({ puller, user: USER, asset, depositRaw: 20_000_000n, rn, pullerJlBalance: 0n, leftover: JL_EXPECTED_LEFTOVER });
      const minted = r.shares - 1n;
      const transfer = r.ixs.find((ix) => ix.programAddress === TOKEN_PROGRAM_ADDRESS && ix.data?.[0] === 3)!;
      const moved = Buffer.from(transfer.data!).readBigUInt64LE(1);
      expect(moved).toBe(r.minOutRaw);
      expect(minted - moved).toBe(JL_EXPECTED_LEFTOVER);
      expect(JL_EXPECTED_LEFTOVER).toBe(0n);
      expect(r.ixs.some((ix) => ix.data?.[0] === 8)).toBe(false);   // no burn on the expected path
    });
  }
});

// The app's verifier (sign.ts, app Task 6 report "Final account-role table") pins these shapes; literals here come from the
// contracts (sec 1.4 / 6), never from addresses.ts, so a drifted constant goes red.
const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATOKEN = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM = "11111111111111111111111111111111";
const JL = "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9";
const PIN = {
  admin: "5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6", liquidity: "7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z", liqProgram: "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC",
  USDC_LEND: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", fMint: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", lending: "2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ", strl: "94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu", lspol: "Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF", rateModel: "5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688", vault: "BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB", rewards: "5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd", claim: "HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW" },
  SOL_LEND: { mint: "So11111111111111111111111111111111111111112", fMint: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", lending: "BeAqbxfrcXmzEYT2Ra62oW2MqkuFDHaCtps47Mzg6Zj3", strl: "4Y66HtUEqbbbpZdENGtFdVhUMS3tnagffn3M4do59Nfy", lspol: "4SkEYxmiRgQ4VYyvh9VB4k39M49BpqazyzDUFDzJhXQm", rateModel: "Acvyi9HBGmqh3Exe1N4PjBVyY8fokq2AdC6fSLqV6KSo", vault: "5JP5zgYCb9W37QQLgAHRHuinFLrKt87akDY1CgZoTPzr", rewards: "CkeQGDRsgMZcCaU8cZEdC2aFAohia4jLzL36RaLcUDsR", claim: "6AQGR8zK4KTVZfZ9UZaRzyEL5ynvwVaF5ywVdmtJT24N" },
} as const;
const shape = (ixs: Instruction[]) => ixs.map((ix) => ({ program: ix.programAddress as string, data: Buffer.from(ix.data ?? []).toString("hex"), accounts: (ix.accounts ?? []).map((a) => a.address as string) }));
const u64hex = (v: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b.toString("hex"); };
const ataOf = async (owner: string, mint: string) => (await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram: address(TOKENKEG) }))[0] as string;

describe("user-signed Jupiter Lend builders produce EXACTLY the app verifier's shapes (app Task 6 table, contracts 6)", () => {
  for (const asset of ["USDC_LEND", "SOL_LEND"] as const) {
    it(`withdraw_jlend ${asset}: create, redeem (18 accounts in order), ${asset === "SOL_LEND" ? "close WSOL" : "no close"}; no ComputeBudget`, async () => {
      const p = PIN[asset];
      const fAta = await ataOf(USER, p.fMint);
      const uAta = await ataOf(USER, p.mint);
      const want = [
        { program: ATOKEN, data: "01", accounts: [USER, uAta, USER, p.mint, SYSTEM, TOKENKEG] },
        { program: JL, data: "b80c569546c461e1" + u64hex(1_881_240n), accounts: [USER, fAta, uAta, PIN.admin, p.lending, p.mint, p.fMint, p.strl, p.lspol, p.rateModel, p.vault, p.claim, PIN.liquidity, PIN.liqProgram, p.rewards, TOKENKEG, ATOKEN, SYSTEM] },
        ...(asset === "SOL_LEND" ? [{ program: TOKENKEG, data: "09", accounts: [uAta, USER, USER] }] : []),
      ];
      expect(shape(await buildJlendWithdrawIxs({ user: USER, asset, receiptRaw: 1_881_240n }))).toEqual(want);
    });
    it(`move deposit into Jupiter Lend ${asset}: create jl, deposit (17 accounts in order), ${asset === "SOL_LEND" ? "close WSOL" : "no close"}; no ComputeBudget`, async () => {
      const p = PIN[asset];
      const fAta = await ataOf(USER, p.fMint);
      const uAta = await ataOf(USER, p.mint);
      const want = [
        { program: ATOKEN, data: "01", accounts: [USER, fAta, USER, p.fMint, SYSTEM, TOKENKEG] },
        { program: JL, data: "f223c68952e1f2b6" + u64hex(2_000_000n), accounts: [USER, uAta, fAta, p.mint, PIN.admin, p.lending, p.fMint, p.strl, p.lspol, p.rateModel, p.vault, PIN.liquidity, PIN.liqProgram, p.rewards, TOKENKEG, ATOKEN, SYSTEM] },
        ...(asset === "SOL_LEND" ? [{ program: TOKENKEG, data: "09", accounts: [uAta, USER, USER] }] : []),
      ];
      expect(shape(await buildJlendUserDepositIxs({ user: USER, asset, depositRaw: 2_000_000n }))).toEqual(want);
    });
  }
  it("the only signer on every user-signed instruction is the user", async () => {
    for (const ixs of [await buildJlendWithdrawIxs({ user: USER, asset: "SOL_LEND", receiptRaw: 5n }), await buildJlendUserDepositIxs({ user: USER, asset: "SOL_LEND", depositRaw: 5n })])
      for (const ix of ixs) for (const a of ix.accounts ?? []) if (a.role >= 2) expect(a.address).toBe(USER);
  });
});
