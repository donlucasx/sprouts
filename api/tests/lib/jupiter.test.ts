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
