import { describe, it, expect } from "vitest";
import { amountProblem, maxAmountText, rulesChanges } from "@/lib/forms";

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
