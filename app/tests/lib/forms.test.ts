import { describe, it, expect } from "vitest";
import { amountProblem, maxAmountText, rulesChanges } from "@/lib/forms";
import type { Pins, Stop } from "@/lib/api";

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
  const saved = { dailyCapCents: 500, plantThresholdCents: 200, roundupOn: true, managed: false, stop: "balanced", pins: {}, allocation: { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 } };
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
  // Review Focus 1: a draft that restates the saved pins is no change.
  it("compares pins by value: no pins change, no patch; a changed pin is the whole pins object", () => {
    const saved = { dailyCapCents: 500, managed: false, stop: "balanced" as Stop, pins: { stORE: 50 } as Pins };
    expect(rulesChanges(saved, { pins: { stORE: 50 } })).toEqual({ patch: {}, raises: false });
    expect(rulesChanges(saved, { pins: { stORE: 50, hSOL: 20 } })).toEqual({ patch: { pins: { stORE: 50, hSOL: 20 } }, raises: false });
    expect(rulesChanges(saved, { managed: true, stop: "bold" })).toEqual({ patch: { managed: true, stop: "bold" }, raises: false });
  });
});

// Plan v2 (R92): the allocation is an object, so the draft compares it by value; moving the fence never asks for a sign-in.
describe("rulesChanges with the allocation", () => {
  const saved = { dailyCapCents: 500, allocation: { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 } };
  it("an allocation equal in value to the saved one is not a change", () => {
    expect(rulesChanges(saved, { allocation: { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 } }).patch).toEqual({});
  });
  it("a moved fence is a change and never a raise", () => {
    const { patch, raises } = rulesChanges(saved, { allocation: { SKR: 70, stORE: 30, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 } });
    expect(patch).toEqual({ allocation: { SKR: 70, stORE: 30, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 } });
    expect(raises).toBe(false);
  });
});
