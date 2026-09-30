import { describe, it, expect } from "vitest";
import { amountProblem, maxAmountText, rulesChanges, fenceShare } from "@/lib/forms";

// 09-29 Saga check: Continue stayed grey with no reason; the limits mirror the server's planPick (1 SKR minimum, the garden maximum).
describe("amountProblem", () => {
  const held = 34_910_172n; // 34.910172 SKR
  it("asks for an amount when the field is empty", () => {
    expect(amountProblem("", held)).toBe("Enter an amount in SKR.");
  });
  it("names the minimum and the maximum", () => {
    expect(amountProblem("0.5", held)).toBe("The smallest withdrawal is 1 SKR.");
    expect(amountProblem("35", held)).toBe("That is more than your garden holds.");
  });
  it("accepts a comma as the decimal mark", () => {
    expect(amountProblem("1,5", held)).toBeNull();
  });
  it("accepts everything the garden holds", () => {
    expect(amountProblem(maxAmountText(held), held)).toBeNull();
  });
});

describe("maxAmountText", () => {
  it("writes the whole garden with no trailing zeros", () => {
    expect(maxAmountText(34_910_172n)).toBe("34.910172");
    expect(maxAmountText(2_000_000n)).toBe("2");
  });
});

// 09-29: each "+" asked for its own approval; changes are now drafted and saved once.
describe("rulesChanges", () => {
  const saved = { dailyCapCents: 500, plantThresholdCents: 200, roundupOn: true };
  it("keeps only what differs from the saved rules", () => {
    expect(rulesChanges(saved, { dailyCapCents: 500, plantThresholdCents: 150 })).toEqual({ patch: { plantThresholdCents: 150 }, raises: false });
  });
  it("flags a raise of the daily limit, however many taps it took", () => {
    expect(rulesChanges(saved, { dailyCapCents: 700 })).toEqual({ patch: { dailyCapCents: 700 }, raises: true });
  });
  it("a lower limit and a switch need no approval", () => {
    expect(rulesChanges(saved, { dailyCapCents: 300, roundupOn: false })).toEqual({ patch: { dailyCapCents: 300, roundupOn: false }, raises: false });
  });
  it("nothing changed is an empty patch", () => {
    expect(rulesChanges(saved, { dailyCapCents: 500 }).patch).toEqual({});
  });
});

// Plan v2 (R92): the allocation is an object, so the draft compares it by value; moving the fence never asks for a sign-in.
describe("rulesChanges with the allocation", () => {
  const saved = { dailyCapCents: 500, allocation: { SKR: 100, stORE: 0 } };
  it("an allocation equal in value to the saved one is not a change", () => {
    expect(rulesChanges(saved, { allocation: { SKR: 100, stORE: 0 } }).patch).toEqual({});
  });
  it("a moved fence is a change and never a raise", () => {
    const { patch, raises } = rulesChanges(saved, { allocation: { SKR: 70, stORE: 30 } });
    expect(patch).toEqual({ allocation: { SKR: 70, stORE: 30 } });
    expect(raises).toBe(false);
  });
});

describe("fenceShare", () => {
  // The post starts at the right end (ORE's bed has no width) and moves left as ORE grows; the bed right of it is ORE's share.
  it("snaps a touch on the track to the nearest 10 of the bed right of it, between 0 and 50", () => {
    expect(fenceShare(300, 300)).toBe(0);
    expect(fenceShare(0, 300)).toBe(50); // the whole bed would be ORE; half is the most
    expect(fenceShare(210, 300)).toBe(30);
    expect(fenceShare(186, 300)).toBe(40); // 38 rounds up
    expect(fenceShare(400, 300)).toBe(0);
    expect(fenceShare(-20, 300)).toBe(50);
  });
});
