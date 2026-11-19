import { describe, it, expect, beforeAll } from "vitest";
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { parseSwapInstructions, checkQuoteSlippageExactOut, type Quote } from "@/lib/jupiter";
import { checkTopUp, parseSharedExactOut, toTopUpIx, topUpAccounts, type TopUpAccounts, type TopUpIx } from "@/lib/topup";
import { SKR_MINT } from "@/lib/constants";
import fixture from "../fixtures/jupiter-topup-exactout.json";
import whirlpool from "../fixtures/jupiter-topup-exactout-whirlpool.json";
import plain from "../fixtures/jupiter-topup-exactout-plain.json";

// Real Jupiter answers (lite-api swap/v1, 2026-10-22): ExactOut 5 USDC from SOL, useSharedAccounts, dexes Raydium CLMM + Whirlpool,
// wrapAndUnwrapSol, for a fresh wallet (both ATAs created). The plain-route capture is the answer before the API asked for shared accounts.
const USER = fixture.user;
const ATTACKER = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
type Fixture = typeof fixture;
let acc: TopUpAccounts;
let skrAta: string;
beforeAll(async () => {
  acc = await topUpAccounts(address(USER));
  [skrAta] = await findAssociatedTokenPda({ owner: address(USER), mint: SKR_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
});
const ixs = (f: Fixture = fixture): TopUpIx[] => {
  const p = parseSwapInstructions(JSON.parse(JSON.stringify(f.swapInstructions)));
  return [...p.computeBudget, ...p.setup, p.swap, ...(p.cleanup ? [p.cleanup] : [])].map(toTopUpIx);
};
const check = (list: TopUpIx[], outRaw: bigint | undefined = 5_000_000n) => checkTopUp(list, { user: USER, ...acc, outRaw });
const swapIndex = (list: TopUpIx[]) => list.findIndex((ix) => ix.program === JUP);
const swapOf = (list: TopUpIx[]) => list[swapIndex(list)];
const tail = (ix: TopUpIx) => new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);

describe("checkTopUp (the SOL top-up's transaction, before it is built and again before it is sent)", () => {
  it("accepts Jupiter's own shared-accounts ExactOut answers (Raydium CLMM, Whirlpool): 5 USDC out, the wrap within the swap's maximum, no fee", () => {
    const plan = check(ixs());
    expect(plan.outRaw).toBe(5_000_000n);
    expect(plan.slippageBps).toBe(50);
    expect(plan.wrapLamports).toBe(BigInt(fixture.quote.otherAmountThreshold));
    expect(plan.quotedInLamports).toBe(BigInt(fixture.quote.inAmount));
    expect(check(ixs(whirlpool)).quotedInLamports).toBe(BigInt(whirlpool.quote.inAmount));
  });

  it("refuses Jupiter's plain exact_out_route, whose route accounts carry the wallet itself", () => {
    expect(() => check(ixs(plain as Fixture))).toThrow(/shared-accounts ExactOut/);
  });

  it("accepts any amount from $2 to $25 when none is pinned (the confirm route), and refuses another pinned amount", () => {
    expect(() => check(ixs(), undefined)).not.toThrow();
    expect(() => check(ixs(), 6_000_000n)).toThrow(/not the amount asked/);
  });

  it("refuses a swap that delivers to someone else's account, or through another program authority than its id's", () => {
    let list = ixs();
    swapOf(list).accounts = swapOf(list).accounts.map((a) => (a === acc.usdcAta ? ATTACKER : a));
    expect(() => check(list)).toThrow(/account 6/);
    list = ixs();
    swapOf(list).data[8] = (swapOf(list).data[8] + 1) % 8;
    expect(() => check(list)).toThrow(/account 1/);
  });

  it("refuses the wallet, its wSOL or USDC account among the route accounts, and its other token accounts anywhere", () => {
    for (const who of [USER, acc.wsolAta, acc.usdcAta]) {
      const list = ixs();
      swapOf(list).accounts.push(who);
      expect(() => check(list)).toThrow(/route accounts/);
    }
    const list = ixs();
    swapOf(list).accounts.push(skrAta);
    expect(() => check(list)).toThrow(/other token account/);
    expect(acc.foreign).toContain(skrAta);
  });

  it("refuses data Jupiter would read differently: a second tail, an unknown swap variant, a route length that does not match", () => {
    let list = ixs();
    let s = swapOf(list);
    s.data = Uint8Array.from([...s.data, ...s.data.slice(-19)]);
    expect(() => check(list)).toThrow(/bytes after the route plan/);
    list = ixs();
    swapOf(list).data[13] = 105;
    expect(() => check(list)).toThrow(/variant 105/);
    list = ixs();
    s = swapOf(list);
    tail(s).setUint32(9, 2, true);
    expect(() => check(list)).toThrow(/swap variant|cut short|bytes after/);
    expect(() => parseSharedExactOut(Uint8Array.from(Buffer.from(fixture.swapInstructions.swapInstruction.data, "base64")))).not.toThrow();
  });

  it("refuses a platform fee, slippage above 1%, a wrap above the swap's maximum, or a maximum above 1 SOL", () => {
    let list = ixs();
    let s = swapOf(list);
    s.data[s.data.length - 1] = 20;
    expect(() => check(list)).toThrow(/platform fee/);
    list = ixs();
    s = swapOf(list);
    tail(s).setUint16(s.data.length - 3, 500, true);
    expect(() => check(list)).toThrow(/slippage/);
    list = ixs();
    const t = list.find((ix) => ix.program === "11111111111111111111111111111111")!;
    tail(t).setBigUint64(4, 10_000_000_000n, true);
    expect(() => check(list)).toThrow(/maximum/);
    list = ixs();
    s = swapOf(list);
    tail(s).setBigUint64(s.data.length - 11, 2_000_000_000n, true);
    expect(() => check(list)).toThrow(/more than 1 SOL/);
  });

  it("refuses a SOL transfer anywhere but the wallet's own wSOL account, and a second one", () => {
    let list = ixs();
    const t = list.find((ix) => ix.program === "11111111111111111111111111111111")!;
    t.accounts = [USER, ATTACKER];
    expect(() => check(list)).toThrow(/SOL transfer/);
    list = ixs();
    const again = { ...list.find((ix) => ix.program === "11111111111111111111111111111111")! };
    list.splice(swapIndex(list), 0, again);
    expect(() => check(list)).toThrow(/SOL transfer|token instruction/);
  });

  it("refuses a token Approve, an unwrap to someone else, or anything after the unwrap", () => {
    let list = ixs();
    list.splice(swapIndex(list), 0, { program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", accounts: [acc.usdcAta, ATTACKER, USER], data: new Uint8Array([4, 1, 0, 0, 0, 0, 0, 0, 0]) });
    expect(() => check(list)).toThrow(/SyncNative/);
    list = ixs();
    list[list.length - 1].accounts = [acc.wsolAta, ATTACKER, USER];
    expect(() => check(list)).toThrow(/closed back/);
    list = ixs();
    list.push({ ...list[list.length - 1] });
    expect(() => check(list)).toThrow(/after the unwrap/);
  });

  it("refuses a program a top-up never uses, a second signer, and a priority fee above 0.001 SOL", () => {
    let list = ixs();
    list.splice(1, 0, { program: "SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ", accounts: [], data: new Uint8Array() });
    expect(() => check(list)).toThrow(/not used by a top-up/);
    list = ixs();
    swapOf(list).signers = [USER, ATTACKER];
    expect(() => check(list)).toThrow(/signer/);
    list = ixs();
    const price = list.find((ix) => ix.data[0] === 3 && ix.program.startsWith("ComputeBudget"))!;
    tail(price).setBigUint64(1, 10_000_000n, true);
    expect(() => check(list)).toThrow(/priority fee/);
  });

  it("refuses an ExactIn route (the amount on screen is the USDC out)", () => {
    const list = ixs();
    swapOf(list).data.set([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a], 0); // route (ExactIn)
    expect(() => check(list)).toThrow(/shared-accounts ExactOut/);
  });
});

describe("checkQuoteSlippageExactOut", () => {
  const q = (inAmount: string, otherAmountThreshold: string) => ({ inAmount, otherAmountThreshold, outAmount: "5000000" }) as Quote;
  it("accepts the recorded quote and refuses a maximum above the slippage or under the input", () => {
    expect(() => checkQuoteSlippageExactOut(fixture.quote as Quote, 50)).not.toThrow();
    expect(() => checkQuoteSlippageExactOut(q("1000000", "1200000"), 50)).toThrow(/maximum/);
    expect(() => checkQuoteSlippageExactOut(q("1000000", "999999"), 50)).toThrow(/maximum/);
  });
});

// 10-27 (his ruling: one "Add USDC" button, SOL never the user's problem): the amounts a wallet's SOL covers, or none
describe("affordableTopUps", async () => {
  const { affordableTopUps } = await import("@/lib/topup");
  const SOL = 1_000_000_000n;
  it("offers each amount the SOL covers after the 0.01 SOL reserve and the fee; none at all with too little", () => {
    expect(affordableTopUps(SOL, 200)).toEqual([500, 1_000, 2_500]);          // 1 SOL at $200: $25 is 0.126 SOL
    expect(affordableTopUps(70_000_000n, 200)).toEqual([500, 1_000]);         // 0.07 SOL: $10 (0.0505) yes, $25 no
    expect(affordableTopUps(40_000_000n, 200)).toEqual([500]);                // 0.04 SOL: $5 (0.02525 of 0.029 spare) yes
    expect(affordableTopUps(30_000_000n, 200)).toEqual([]);                   // 0.03 SOL: 0.019 spare, under $5
    expect(affordableTopUps(20_000_000n, 200)).toEqual([]);                   // 0.02 SOL less 0.011 kept: under $5
    expect(affordableTopUps(0n, 200)).toEqual([]);
  });
  it("no price, no offer", () => {
    expect(affordableTopUps(SOL, 0)).toEqual([]);
  });
});

// Task 7 (any-coin top-up): the token path of the same check. The fixture is Jupiter's real answer (api.jup.ag swap/v1, 2026-11-19):
// ExactOut 5 USDC from JUP through TOPUP_DEXES, useSharedAccounts, wrapAndUnwrapSol false, for the same public placeholder wallet.
describe("checkTopUp with a source coin (the token top-up)", async () => {
  const token = (await import("../fixtures/jupiter-topup-exactout-token.json")).default;
  const { topUpSourceAccounts, affordableTopUpsFor } = await import("@/lib/topup");
  const { USDC_MINT, WSOL_MINT } = await import("@/lib/constants");
  const { COINS } = await import("@/domain/coins");
  const { RECEIPT } = await import("@/lib/venues/addresses");
  const JUP_MINT = token.quote.inputMint;
  type Source = Awaited<ReturnType<typeof topUpSourceAccounts>>;
  let src: Source;
  beforeAll(async () => {
    src = await topUpSourceAccounts(address(USER), address(JUP_MINT));
  });
  const tixs = (): TopUpIx[] => {
    const p = parseSwapInstructions(JSON.parse(JSON.stringify(token.swapInstructions)));
    return [...p.computeBudget, ...p.setup, p.swap, ...(p.cleanup ? [p.cleanup] : [])].map(toTopUpIx);
  };
  const tcheck = (list: TopUpIx[], source: Source = src, outRaw: bigint | undefined = 5_000_000n) => checkTopUp(list, { user: USER, ...acc, outRaw, source });
  const SYS = "11111111111111111111111111111111";
  const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

  it("accepts Jupiter's own token answer: 5 USDC out of the wallet's own JUP account, no fee, no wrap", () => {
    expect(token.user).toBe(USER);
    const plan = tcheck(tixs());
    expect(plan.outRaw).toBe(5_000_000n);
    expect(plan.slippageBps).toBe(50);
    expect(plan.wrapLamports).toBe(0n);
    expect(plan.quotedIn).toBe(BigInt(token.quote.inAmount));
    expect(swapOf(tixs()).accounts[3]).toBe(src.ata);
    expect(swapOf(tixs()).accounts[7]).toBe(JUP_MINT);
  });

  it("refuses an added SOL transfer, a SyncNative, or a close (nothing is wrapped and nothing follows the swap)", () => {
    let list = tixs();
    list.splice(swapIndex(list), 0, { program: SYS, accounts: [USER, acc.wsolAta], signers: [USER], data: Uint8Array.from([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]) });
    expect(() => tcheck(list)).toThrow(/before the swap/);
    list = tixs();
    list.splice(swapIndex(list), 0, { program: TOKEN, accounts: [acc.wsolAta], data: Uint8Array.from([17]) });
    expect(() => tcheck(list)).toThrow(/before the swap/);
    list = tixs();
    list.push({ program: TOKEN, accounts: [acc.wsolAta, USER, USER], signers: [USER], data: Uint8Array.from([9]) });
    expect(() => tcheck(list)).toThrow(/after the swap/);
  });

  it("refuses the source account swapped for another of the wallet's accounts, or delivery anywhere else", () => {
    let list = tixs();
    swapOf(list).accounts[3] = acc.wsolAta;
    expect(() => tcheck(list)).toThrow(/account 3/);
    list = tixs();
    swapOf(list).accounts[3] = src.token2022Ata;
    expect(() => tcheck(list)).toThrow(/other token account|account 3/);
    list = tixs();
    swapOf(list).accounts = swapOf(list).accounts.map((a) => (a === acc.usdcAta ? ATTACKER : a));
    expect(() => tcheck(list)).toThrow(/account 6/);
  });

  it("never takes USDC, wSOL, a garden coin (but SKR) or a lending receipt as the source", async () => {
    const refused = [USDC_MINT, WSOL_MINT, COINS.hSOL.mint, COINS.stORE.mint, COINS.cbBTC.mint, COINS.JitoSOL.mint, COINS.JupSOL.mint, RECEIPT.USDC_LEND.kamino_klend.mint, RECEIPT.SOL_LEND.jupiter_lend.mint];
    for (const m of refused) {
      await expect(topUpSourceAccounts(address(USER), m)).rejects.toThrow(/not a top-up source/);
      expect(() => tcheck(tixs(), { ...src, mint: m })).toThrow(/not a top-up source/);
    }
  });

  it("SKR (staked when planted, so the wallet's liquid SKR is the user's own) may be the source, and only as the source", async () => {
    const skr = await topUpSourceAccounts(address(USER), SKR_MINT);
    expect(skr.ata).toBe(skrAta);
    // The JUP answer re-pointed at SKR: same route, the source mint, the wallet's SKR account and the authority's SKR account swapped in.
    const list = tixs();
    const s = swapOf(list);
    const auth = src.authorities[s.data[8]];
    const skrAuth = skr.authorities[s.data[8]];
    s.accounts = s.accounts.map((a) => (a === JUP_MINT ? SKR_MINT : a === src.ata ? skr.ata : a === auth.source ? skrAuth.source : a));
    expect(() => tcheck(list, skr)).not.toThrow();
    // In a JUP top-up the wallet's SKR account stays untouchable.
    const other = tixs();
    swapOf(other).accounts.push(skrAta);
    expect(() => tcheck(other)).toThrow(/other token account/);
  });

  it("refuses a platform fee, slippage above 1%, or another amount than asked", () => {
    let list = tixs();
    let s = swapOf(list);
    s.data[s.data.length - 1] = 20;
    expect(() => tcheck(list)).toThrow(/platform fee/);
    list = tixs();
    s = swapOf(list);
    tail(s).setUint16(s.data.length - 3, 101, true);
    expect(() => tcheck(list)).toThrow(/slippage/);
    expect(() => tcheck(tixs(), src, 6_000_000n)).toThrow(/not the amount asked/);
  });

  it("refuses the wallet, its source, wSOL or USDC account among the route accounts", () => {
    for (const who of [USER, src.ata, acc.wsolAta, acc.usdcAta]) {
      const list = tixs();
      swapOf(list).accounts.push(who);
      expect(() => tcheck(list)).toThrow(/route accounts/);
    }
  });

  it("refuses an account creation other than the wallet's own USDC account", () => {
    const list = tixs();
    const create = list.find((ix) => ix.program === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")!;
    list.splice(swapIndex(list), 0, { ...create, accounts: [USER, acc.wsolAta, USER, WSOL_MINT, SYS, TOKEN] });
    expect(() => tcheck(list)).toThrow(/account creation/);
  });

  it("affordableTopUpsFor: the offers at or under the coin's value less 3%", () => {
    expect(affordableTopUpsFor(520)).toEqual([500]);
    expect(affordableTopUpsFor(1_100)).toEqual([500, 1_000]);
    expect(affordableTopUpsFor(2_600)).toEqual([500, 1_000, 2_500]);
    expect(affordableTopUpsFor(400)).toEqual([]);
  });
});

// Kimi plan review #8: the app's never-touched list (app/src/lib/sign.ts TOPUP_FOREIGN_MINTS) and this API's FOREIGN_MINTS are the same set.
describe("the top-up's foreign mints match the app's", async () => {
  const { FOREIGN_MINTS } = await import("@/lib/topup");
  const { readFileSync } = await import("node:fs");
  it("lists the same mints as app/src/lib/sign.ts", () => {
    const src = readFileSync(new URL("../../../app/src/lib/sign.ts", import.meta.url), "utf8");
    const block = src.match(/const TOPUP_FOREIGN_MINTS[^\n]*\n([\s\S]*?)\n\]\)/)![1];
    const entries = block.split("\n").map((l) => l.replace(/\/\/.*$/, "").trim().replace(/,$/, "")).filter(Boolean);
    const resolve = (e: string): string => {
      const lit = e.match(/^'(\w+)'$/);
      if (lit) return lit[1];
      const constant = e.match(/^(\w+)$/);
      if (constant) return src.match(new RegExp(`export const ${constant[1]} = '(\\w+)'`))![1];
      const klend = e.match(/^KLEND_RESERVE\.(\w+)\.collateralMint$/);
      if (klend) return src.match(new RegExp(`${klend[1]}: Object\\.freeze\\(\\{ reserve:[^}]*collateralMint: '(\\w+)'`))![1];
      const jlend = e.match(/^JLEND\.(\w+)\.fTokenMint$/);
      if (jlend) return src.match(new RegExp(`${jlend[1]}: Object\\.freeze\\(\\{ lending:[^}]*fTokenMint: '(\\w+)'`))![1];
      throw new Error(`cannot read the app's TOPUP_FOREIGN_MINTS entry ${e}`);
    };
    const app = entries.map(resolve);
    expect(app.length).toBe(10);
    expect([...app].sort()).toEqual([...FOREIGN_MINTS].map(String).sort());
  });
});
