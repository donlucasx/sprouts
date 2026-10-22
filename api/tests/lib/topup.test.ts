import { describe, it, expect, beforeAll } from "vitest";
import { address } from "@solana/kit";
import { parseSwapInstructions, checkQuoteSlippageExactOut, type Quote } from "@/lib/jupiter";
import { checkTopUp, toTopUpIx, topUpAccounts, type TopUpIx } from "@/lib/topup";
import fixture from "../fixtures/jupiter-topup-exactout.json";

// A real Jupiter answer (lite-api swap/v1, 2026-10-22): ExactOut 5 USDC from SOL, wrapAndUnwrapSol, for a fresh wallet (both ATAs created).
const USER = fixture.user;
const ATTACKER = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
let acc: { wsolAta: string; usdcAta: string };
beforeAll(async () => {
  acc = await topUpAccounts(address(USER));
});
const ixs = (): TopUpIx[] => {
  const p = parseSwapInstructions(JSON.parse(JSON.stringify(fixture.swapInstructions)));
  return [...p.computeBudget, ...p.setup, p.swap, ...(p.cleanup ? [p.cleanup] : [])].map(toTopUpIx);
};
const check = (list: TopUpIx[], outRaw: bigint | undefined = 5_000_000n) => checkTopUp(list, { user: USER, ...acc, outRaw });
const swapIndex = (list: TopUpIx[]) => list.findIndex((ix) => ix.program === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const tail = (ix: TopUpIx) => new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);

describe("checkTopUp (the SOL top-up's transaction, before it is built and again before it is sent)", () => {
  it("accepts Jupiter's own ExactOut answer: 5 USDC out, the wrap within the swap's maximum, no fee", () => {
    const plan = check(ixs());
    expect(plan.outRaw).toBe(5_000_000n);
    expect(plan.slippageBps).toBe(50);
    expect(plan.wrapLamports).toBe(BigInt(fixture.quote.otherAmountThreshold));
    expect(plan.quotedInLamports).toBe(BigInt(fixture.quote.inAmount));
  });

  it("accepts any amount from $2 to $25 when none is pinned (the confirm route), and refuses another pinned amount", () => {
    expect(() => check(ixs(), undefined)).not.toThrow();
    expect(() => check(ixs(), 6_000_000n)).toThrow(/not the amount asked/);
  });

  it("refuses a swap that delivers to someone else's account", () => {
    const list = ixs();
    const s = list[swapIndex(list)];
    s.accounts = s.accounts.map((a) => (a === acc.usdcAta ? ATTACKER : a));
    expect(() => check(list)).toThrow(/USDC account/);
  });

  it("refuses a platform fee, slippage above 1%, or a wrap above the swap's maximum", () => {
    let list = ixs();
    let s = list[swapIndex(list)];
    s.data[s.data.length - 1] = 20;
    expect(() => check(list)).toThrow(/platform fee/);
    list = ixs();
    s = list[swapIndex(list)];
    tail(s).setUint16(s.data.length - 3, 500, true);
    expect(() => check(list)).toThrow(/slippage/);
    list = ixs();
    const t = list.find((ix) => ix.program === "11111111111111111111111111111111")!;
    tail(t).setBigUint64(4, 10_000_000_000n, true);
    expect(() => check(list)).toThrow(/maximum/);
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
    list[swapIndex(list)].signers = [USER, ATTACKER];
    expect(() => check(list)).toThrow(/signer/);
    list = ixs();
    const price = list.find((ix) => ix.data[0] === 3 && ix.program.startsWith("ComputeBudget"))!;
    tail(price).setBigUint64(1, 10_000_000n, true);
    expect(() => check(list)).toThrow(/priority fee/);
  });

  it("refuses an ExactIn route (the amount on screen is the USDC out)", () => {
    const list = ixs();
    const s = list[swapIndex(list)];
    s.data.set([0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a], 0); // route (ExactIn)
    expect(() => check(list)).toThrow(/not an ExactOut route/);
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
