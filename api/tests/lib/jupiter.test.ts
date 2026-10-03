import { describe, it, expect } from "vitest";
import { AccountRole } from "@solana/kit";
import { toKitInstruction, parseSwapInstructions, checkSwapInstructions, JUPITER_AGGREGATOR } from "@/lib/jupiter";
import fixture from "../fixtures/jupiter-swap-instructions.json";

const PULLER = "9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm";
const clone = () => JSON.parse(JSON.stringify(fixture)) as typeof fixture;

// Review I5: the puller signs whatever Jupiter's HTTP response contains, so the response is checked before it is signed.
describe("checkSwapInstructions", () => {
  it("accepts Jupiter's own response", () => {
    expect(() => checkSwapInstructions(parseSwapInstructions(fixture), { puller: PULLER })).not.toThrow();
    expect(JUPITER_AGGREGATOR).toBe("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
  });

  it("refuses a swap instruction that is not the Jupiter aggregator", () => {
    const f = clone();
    f.swapInstruction.programId = "SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ";
    expect(() => checkSwapInstructions(parseSwapInstructions(f), { puller: PULLER })).toThrow(/swap program/);
  });

  it("refuses a setup or cleanup instruction from a program outside the allowlist", () => {
    const f = clone();
    f.setupInstructions[0].programId = "SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ";
    expect(() => checkSwapInstructions(parseSwapInstructions(f), { puller: PULLER })).toThrow(/setup program/);
  });

  it("refuses any signer other than the puller", () => {
    const f = clone();
    f.swapInstruction.accounts.push({ pubkey: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6", isSigner: true, isWritable: true });
    expect(() => checkSwapInstructions(parseSwapInstructions(f), { puller: PULLER })).toThrow(/signer/);
  });

  it("requires the fee account and the destination account to appear in the swap when they were requested", () => {
    const parsed = parseSwapInstructions(fixture);
    expect(() => checkSwapInstructions(parsed, { puller: PULLER, feeAccount: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6" })).toThrow(/fee account/);
    expect(() => checkSwapInstructions(parsed, { puller: PULLER, destination: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6" })).toThrow(/destination/);
    const f = clone();
    f.swapInstruction.accounts.push({ pubkey: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6", isSigner: false, isWritable: true });
    expect(() => checkSwapInstructions(parseSwapInstructions(f), { puller: PULLER, feeAccount: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6" })).not.toThrow();
  });
});

describe("jupiter instruction conversion", () => {
  it("maps signer and writable flags to kit roles", () => {
    const ix = toKitInstruction(fixture.setupInstructions[0]);
    expect(ix.programAddress).toBe("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    expect(ix.accounts![0].role).toBe(AccountRole.WRITABLE_SIGNER);
    expect(ix.accounts![1].role).toBe(AccountRole.WRITABLE);
    expect(ix.data!.length).toBe(1);
  });

  it("parses the whole response", () => {
    const p = parseSwapInstructions(fixture);
    expect(p.computeBudget.length).toBe(1);
    expect(p.setup.length).toBe(1);
    expect(p.cleanup).toBeNull();
    expect(p.lookupTables).toEqual(["D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVniYD6"]);
    expect(p.swap.programAddress).toBe("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
  });
});

import { checkQuoteMints, type Quote } from "@/lib/jupiter";

// Spec 7.3: nothing checks mints today. The quote's mints are asserted against the registry before the puller signs.
describe("checkQuoteMints", () => {
  const quote: Quote = { inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A", inAmount: "2000000", outAmount: "14228499", otherAmountThreshold: "14086214", priceImpactPct: "0", routePlan: [] };
  it("accepts the registry's mints", () => {
    expect(() => checkQuoteMints(quote, { inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A" })).not.toThrow();
  });
  it("refuses a swapped output mint and a non-USDC input", () => {
    expect(() => checkQuoteMints({ ...quote, outputMint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn" }, { inputMint: quote.inputMint, outputMint: quote.outputMint })).toThrow(/output mint/);
    expect(() => checkQuoteMints({ ...quote, inputMint: "So11111111111111111111111111111111111111112" }, { inputMint: quote.inputMint, outputMint: quote.outputMint })).toThrow(/input mint/);
  });
});

import { vi, afterEach } from "vitest";
import { checkQuoteSlippage, getQuote } from "@/lib/jupiter";

// Security audit R207 #4 (a): otherAmountThreshold is the aggregator's only floor and the SKR stake's amount; it must match the
// slippage the request asked for, within one raw unit of rounding.
describe("checkQuoteSlippage", () => {
  const q: Quote = { inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3", inAmount: "2000000", outAmount: "14228499", otherAmountThreshold: "14086214", priceImpactPct: "0", routePlan: [] };
  it("accepts Jupiter's own threshold at 100 bps and one raw unit under it", () => {
    expect(() => checkQuoteSlippage(q, 100)).not.toThrow(); // floor(14228499 * 0.99) = 14086214
    expect(() => checkQuoteSlippage({ ...q, otherAmountThreshold: "14086213" }, 100)).not.toThrow();
  });
  it("refuses a threshold below the requested slippage, a threshold of 1, and one above the quote", () => {
    expect(() => checkQuoteSlippage({ ...q, otherAmountThreshold: "14086212" }, 100)).toThrow(/minimum 14086212/);
    expect(() => checkQuoteSlippage({ ...q, otherAmountThreshold: "1" }, 100)).toThrow(/refused/);
    expect(() => checkQuoteSlippage({ ...q, otherAmountThreshold: "14228500" }, 100)).toThrow(/refused/);
    expect(() => checkQuoteSlippage(q, 50)).toThrow(/50 bps/); // a 1% threshold for a 0.5% request
  });
  it("refuses amounts that are not integers, and an empty quote", () => {
    expect(() => checkQuoteSlippage({ ...q, otherAmountThreshold: "1.5" }, 100)).toThrow(/not integers/);
    expect(() => checkQuoteSlippage({ ...q, outAmount: "0", otherAmountThreshold: "0" }, 100)).toThrow(/refused/);
  });
});

describe("getQuote applies the slippage check to every caller", () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (threshold: string) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ inputMint: "a", outputMint: "b", inAmount: "1", outAmount: "1000000", otherAmountThreshold: threshold, priceImpactPct: "0", routePlan: [] }), { status: 200 })));
  const ask = (slippageBps?: number) => getQuote({ inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as never, outputMint: "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3" as never, amountRaw: 1n, ...(slippageBps ? { slippageBps } : {}) });
  it("passes a threshold at the default 100 bps, refuses one at 1", async () => {
    process.env.JUPITER_API_KEY ??= "test";
    answer("990000");
    await expect(ask()).resolves.toMatchObject({ otherAmountThreshold: "990000" });
    answer("1");
    await expect(ask()).rejects.toThrow(/refused/);
  });
  it("checks against the slippage the caller asked for", async () => {
    answer("990000");
    await expect(ask(50)).rejects.toThrow(/50 bps/);
    answer("995000");
    await expect(ask(50)).resolves.toBeTruthy();
  });
});

// Security audit R207 #4 (b) and (c): setup and cleanup are decoded, not just program-checked, and the swap must deliver to the
// destination in its output position. Each refusal below is a crafted instruction a compromised response could carry.
describe("checkSwapInstructions, decoded (R207 #4)", () => {
  const USER = "52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e";
  const DEST = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
  const WSOL_ACC = "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6";
  const THIEF = "DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr";
  const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
  const TOKEN22 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
  const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
  const SYSTEM = "11111111111111111111111111111111";
  const MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
  const acc = (pubkey: string, isWritable = true, isSigner = false) => ({ pubkey, isSigner, isWritable });
  const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
  const ix = (programId: string, accounts: ReturnType<typeof acc>[], data: number[]) => ({ programId, accounts, data: b64(data) });
  const opts = { puller: PULLER, wsolAccount: WSOL_ACC, destinationOwner: USER };
  const withSetup = (...setup: ReturnType<typeof ix>[]) => { const f = clone(); f.setupInstructions = setup as never; return parseSwapInstructions(f); };
  const withCleanup = (c: ReturnType<typeof ix>) => { const f = clone(); (f as { cleanupInstruction: unknown }).cleanupInstruction = c; return parseSwapInstructions(f); };
  const ataCreate = (owner: string, tag: number[] = [1], payer = PULLER) => ix(ATA, [acc(payer, true, payer === PULLER), acc(DEST), acc(owner, false), acc(MINT, false), acc(SYSTEM, false), acc(TOKEN, false)], tag);

  it("accepts what Jupiter emits: an ATA create for the puller or the destination's owner, SyncNative and CloseAccount on the puller's wSOL", () => {
    expect(() => checkSwapInstructions(withSetup(ataCreate(PULLER), ataCreate(USER), ataCreate(PULLER, [0]), ataCreate(PULLER, []), ix(TOKEN, [acc(WSOL_ACC)], [17])), opts)).not.toThrow();
    expect(() => checkSwapInstructions(withCleanup(ix(TOKEN, [acc(WSOL_ACC), acc(PULLER), acc(PULLER, false, true)], [9])), opts)).not.toThrow();
  });

  it("refuses a System transfer of the puller's SOL in setup or cleanup", () => {
    const transfer = ix(SYSTEM, [acc(PULLER, true, true), acc(THIEF)], [2, 0, 0, 0, 0, 202, 154, 59, 0, 0, 0, 0]);
    expect(() => checkSwapInstructions(withSetup(transfer), opts)).toThrow(/setup program 1111/);
    expect(() => checkSwapInstructions(withCleanup(transfer), opts)).toThrow(/cleanup program 1111/);
  });

  for (const [name, data] of [["Transfer", [3, 64, 66, 15, 0, 0, 0, 0, 0]], ["Approve", [4, 255, 255, 255, 255, 255, 255, 255, 255]], ["SetAuthority", [6, 2, 1]], ["TransferChecked", [12, 64, 66, 15, 0, 0, 0, 0, 0, 6]]] as const) {
    it(`refuses a Token ${name} on the puller's account, on Token and Token-2022`, () => {
      const t = (prog: string) => ix(prog, [acc(WSOL_ACC), acc(THIEF), acc(PULLER, false, true)], [...data]);
      expect(() => checkSwapInstructions(withSetup(t(TOKEN)), opts)).toThrow(/not SyncNative or CloseAccount/);
      expect(() => checkSwapInstructions(withSetup(t(TOKEN22)), opts)).toThrow(/not SyncNative or CloseAccount/);
      expect(() => checkSwapInstructions(withCleanup(t(TOKEN)), opts)).toThrow(/cleanup token instruction/);
    });
  }

  it("refuses CloseAccount paying anyone but the puller, and SyncNative or CloseAccount on any account but the puller's wSOL", () => {
    expect(() => checkSwapInstructions(withCleanup(ix(TOKEN, [acc(WSOL_ACC), acc(THIEF), acc(PULLER, false, true)], [9])), opts)).toThrow(/CloseAccount pays/);
    expect(() => checkSwapInstructions(withCleanup(ix(TOKEN, [acc(DEST), acc(PULLER), acc(PULLER, false, true)], [9])), opts)).toThrow(/not the puller's wSOL/);
    expect(() => checkSwapInstructions(withSetup(ix(TOKEN, [acc(DEST)], [17])), opts)).toThrow(/not the puller's wSOL/);
    expect(() => checkSwapInstructions(withSetup(ix(TOKEN, [acc(WSOL_ACC)], [17])), { puller: PULLER })).toThrow(/not the puller's wSOL/);
  });

  it("refuses an ATA RecoverNested, a create for a stranger, and a create paid by someone else", () => {
    expect(() => checkSwapInstructions(withSetup(ataCreate(PULLER, [2])), opts)).toThrow(/not a create/);
    expect(() => checkSwapInstructions(withSetup(ataCreate(THIEF)), opts)).toThrow(/neither the puller nor the destination's owner/);
    expect(() => checkSwapInstructions(withSetup(ataCreate(USER)), { puller: PULLER, wsolAccount: WSOL_ACC })).toThrow(/neither/);
    expect(() => checkSwapInstructions(withSetup(ataCreate(PULLER, [1], THIEF)), opts)).toThrow(/not paid by the puller/);
  });

  it("refuses a compute-budget entry from another program", () => {
    const f = clone();
    f.computeBudgetInstructions[0].programId = SYSTEM;
    expect(() => checkSwapInstructions(parseSwapInstructions(f), opts)).toThrow(/compute budget program/);
  });

  // The route layouts by discriminator: route e517cb977ae3ad2a (output at 3, or at 4 when that optional slot is set),
  // shared_accounts_route c1209b3341d69c81 (output at 6).
  const ROUTE = [0xe5, 0x17, 0xcb, 0x97, 0x7a, 0xe3, 0xad, 0x2a];
  const SHARED = [0xc1, 0x20, 0x9b, 0x33, 0x41, 0xd6, 0x9c, 0x81];
  const swapWith = (disc: number[], accounts: ReturnType<typeof acc>[]) => { const f = clone(); f.swapInstruction = { programId: JUPITER_AGGREGATOR, accounts, data: b64([...disc, 1, 0, 0, 0]) } as never; return parseSwapInstructions(f); };
  const route = (slot3: string, slot4: string, extra: ReturnType<typeof acc>[] = []) => swapWith(ROUTE, [acc(TOKEN, false), acc(PULLER, false, true), acc(WSOL_ACC), acc(slot3), acc(slot4, slot4 !== JUPITER_AGGREGATOR), acc(MINT, false), ...extra]);

  it("a plain route delivers to the user slot when the custom slot is empty, and to the custom slot when it is set", () => {
    expect(() => checkSwapInstructions(route(DEST, JUPITER_AGGREGATOR), { ...opts, destination: DEST })).not.toThrow();
    expect(() => checkSwapInstructions(route(WSOL_ACC, DEST), { ...opts, destination: DEST })).not.toThrow();
  });

  it("refuses a route that lists the destination but delivers elsewhere", () => {
    expect(() => checkSwapInstructions(route(THIEF, JUPITER_AGGREGATOR, [acc(DEST)]), { ...opts, destination: DEST })).toThrow(/delivers to DPJ58/);
    expect(() => checkSwapInstructions(route(DEST, THIEF), { ...opts, destination: DEST })).toThrow(/delivers to DPJ58/);
  });

  it("a shared-accounts route must deliver at slot 6, writable", () => {
    const shared = (slot6: string, writable = true) => swapWith(SHARED, [acc(TOKEN, false), acc(THIEF, false), acc(PULLER, false, true), acc(WSOL_ACC), acc(WSOL_ACC), acc(WSOL_ACC), acc(slot6, writable), acc(MINT, false), acc(DEST)]);
    expect(() => checkSwapInstructions(shared(DEST), { ...opts, destination: DEST })).not.toThrow();
    expect(() => checkSwapInstructions(shared(THIEF), { ...opts, destination: DEST })).toThrow(/delivers to/);
    expect(() => checkSwapInstructions(shared(DEST, false), { ...opts, destination: DEST })).toThrow(/delivers to/);
  });

  it("an unknown route layout must at least carry the destination writable", () => {
    const other = (writable: boolean) => swapWith([1, 2, 3, 4, 5, 6, 7, 8], [acc(PULLER, false, true), acc(DEST, writable)]);
    expect(() => checkSwapInstructions(other(true), { ...opts, destination: DEST })).not.toThrow();
    expect(() => checkSwapInstructions(other(false), { ...opts, destination: DEST })).toThrow(/not writable/);
  });
});
