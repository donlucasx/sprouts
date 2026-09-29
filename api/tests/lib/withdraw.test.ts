import { describe, it, expect } from "vitest";
import { planPick } from "@/lib/withdraw";

const SP = 1_146_000_000n;
const pot = { skrStakedRaw: 2_292_000_000n, skrPutInRaw: 2_200_000_000n, skrEarnedRaw: 92_000_000n, skrPickedRaw: 0n };

describe("planPick", () => {
  it("earned only: shares by floor, the plant keeps the dust, nothing pruned", () => {
    const p = planPick({ mode: "earned", pot, sharePrice: SP, skrUsd: 0.0183 });
    expect(p.shares).toBe(80_279_232n);
    expect(p.amountRaw).toBeLessThanOrEqual(92_000_000n);
    expect(p.prunes).toBe(false);
    expect(p.brief[0]).toContain("earned");
  });
  it("an amount above what was earned prunes the plant and says so", () => {
    const p = planPick({ mode: "amount", amountRaw: 1_000_000_000n, pot, sharePrice: SP, skrUsd: 0.0183 });
    expect(p.prunes).toBe(true);
    expect(p.brief.some((l) => l.includes("prunes"))).toBe(true);
  });
  // Review Focus 3
  it("refuses a pick below 1 SKR", () => {
    expect(() => planPick({ mode: "earned", pot: { ...pot, skrEarnedRaw: 500_000n }, sharePrice: SP, skrUsd: null })).toThrow(/1 SKR/);
  });
  it("refuses an amount above the pot", () => {
    expect(() => planPick({ mode: "amount", amountRaw: 9_000_000_000n, pot, sharePrice: SP, skrUsd: null })).toThrow(/more than/);
  });
});
