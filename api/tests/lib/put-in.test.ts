import { describe, it, expect } from "vitest";
import { withNetworkFee } from "@/lib/put-in";

const P = (id: string, pull: number, fee: number) => ({ id, usdcPulledCents: pull, networkFeeCents: fee });
const L = (plantingId: string, usdcInCents: number, asset = "SKR") => ({ plantingId, usdcInCents, asset });

describe("withNetworkFee (R583, audits/putin-3c)", () => {
  it("adds a legacy planting's 3c back so its legs sum to the pull; a fee-free planting is unchanged", () => {
    const out = withNetworkFee([L("old", 249, "USDC_LEND"), L("new", 100)], [P("old", 252, 3), P("new", 100, 0)]);
    expect(out.map((l) => l.usdcInCents)).toEqual([252, 100]);
  });
  it("splits over several legs by size, largest remainder first, summing to the pull exactly", () => {
    const out = withNetworkFee([L("p", 1000), L("p", 1000, "stORE")], [P("p", 2003, 3)]);
    expect(out.map((l) => l.usdcInCents)).toEqual([1002, 1001]);
    const uneven = withNetworkFee([L("q", 10), L("q", 90, "stORE")], [P("q", 103, 3)]);
    expect(uneven.reduce((s, l) => s + l.usdcInCents, 0)).toBe(103);
    expect(uneven.map((l) => l.usdcInCents)).toEqual([10, 93]);
  });
  it("never adds more than the pull covers (legs already at or above pull - fee)", () => {
    expect(withNetworkFee([L("p", 101)], [P("p", 103, 3)])[0].usdcInCents).toBe(103);
    expect(withNetworkFee([L("p", 103)], [P("p", 103, 3)])[0].usdcInCents).toBe(103);
    expect(withNetworkFee([L("p", 1000), L("p", 1000)], [P("p", 1000, 3)]).map((l) => l.usdcInCents)).toEqual([1000, 1000]);
  });
  it("leaves legs of plantings it was not given (a move's carried basis) and does not change its input", () => {
    const legs = [L("move:1", 200, "USDC_LEND"), L("p", 97)];
    const out = withNetworkFee(legs, [P("p", 100, 3)]);
    expect(out.map((l) => l.usdcInCents)).toEqual([200, 100]);
    expect(legs.map((l) => l.usdcInCents)).toEqual([200, 97]);
    expect(out[0]).toBe(legs[0]);
  });
  it("a planting whose legs are all 0c gives the add-back to its first leg", () => {
    expect(withNetworkFee([L("p", 0), L("p", 0)], [P("p", 3, 3)]).map((l) => l.usdcInCents)).toEqual([3, 0]);
  });
});
