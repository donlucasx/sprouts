import { describe, it, expect } from "vitest";
import { AccountRole } from "@solana/kit";
import { toKitInstruction, parseSwapInstructions } from "@/lib/jupiter";
import fixture from "../fixtures/jupiter-swap-instructions.json";

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
