import { describe, it, expect } from "vitest";
import { computeRoundupCents, DEFAULT_RULES } from "@/domain/roundup";

describe("computeRoundupCents", () => {
  it("rounds a $1.17 swap up to $2.00: 83 cents", () => expect(computeRoundupCents(117, DEFAULT_RULES)).toBe(83));

  it("R484: a whole-dollar swap has no spare change and saves nothing", () => {
    expect(computeRoundupCents(100, DEFAULT_RULES)).toBe(0);
    expect(computeRoundupCents(2000, DEFAULT_RULES)).toBe(0);
    expect(computeRoundupCents(1430, DEFAULT_RULES)).toBe(70);
  });

  it("11-08 $1 minimum: a 2-cent dust swap saves nothing (it used to round up 98 cents)", () => expect(computeRoundupCents(2, DEFAULT_RULES)).toBe(0));
  it("11-08 $1 minimum: 99 cents saves nothing, $1.01 rounds up 99 cents", () => {
    expect(computeRoundupCents(99, DEFAULT_RULES)).toBe(0);
    expect(computeRoundupCents(101, DEFAULT_RULES)).toBe(99);
  });

  it("adds 1% on a $150.50 swap: 50 cents round-up plus 150 cents", () => expect(computeRoundupCents(15050, DEFAULT_RULES)).toBe(50 + 150));

  it("exactly $100 gets the 1% (and no round-up: a whole dollar)", () => expect(computeRoundupCents(10000, DEFAULT_RULES)).toBe(100));

  it("$99.99 does not get the 1%", () => expect(computeRoundupCents(9999, DEFAULT_RULES)).toBe(1));

  it("round-up off, pct on: only the 1%", () => expect(computeRoundupCents(15050, { ...DEFAULT_RULES, roundupOn: false })).toBe(150));

  it("both off: zero", () => expect(computeRoundupCents(15050, { ...DEFAULT_RULES, roundupOn: false, pctOn: false })).toBe(0));

  it("null size (unpriced): zero", () => expect(computeRoundupCents(null, DEFAULT_RULES)).toBe(0));

  it("zero size: zero", () => expect(computeRoundupCents(0, DEFAULT_RULES)).toBe(0));

  // 11-12 (his rulings): two opt-in rules, both off by default, so nothing changes for anyone until they switch one on.
  it("new rules are off by default: a $1.00 DCA buy still saves nothing", () => {
    expect(DEFAULT_RULES.smallOn).toBe(false);
    expect(DEFAULT_RULES.perSwapOn).toBe(false);
    expect(DEFAULT_RULES.perSwapCents).toBe(10);
    expect(computeRoundupCents(100, DEFAULT_RULES)).toBe(0);
  });

  it("add to every swap: a $1.00 buy saves the set amount (5, 10 or 25 cents)", () => {
    expect(computeRoundupCents(100, { ...DEFAULT_RULES, perSwapOn: true, perSwapCents: 10 })).toBe(10);
    expect(computeRoundupCents(100, { ...DEFAULT_RULES, perSwapOn: true, perSwapCents: 25 })).toBe(25);
  });

  it("add to every swap stacks with the round-up and the 1%", () => {
    expect(computeRoundupCents(117, { ...DEFAULT_RULES, perSwapOn: true, perSwapCents: 5 })).toBe(83 + 5);
    expect(computeRoundupCents(15050, { ...DEFAULT_RULES, perSwapOn: true, perSwapCents: 10 })).toBe(50 + 150 + 10);
  });

  it("under $1 off: a 40-cent swap saves nothing, even with add-to-every-swap on", () => {
    expect(computeRoundupCents(40, { ...DEFAULT_RULES, perSwapOn: true })).toBe(0);
  });

  it("under $1 on: a 40-cent swap rounds up 60 cents (plus the set amount when that is on)", () => {
    expect(computeRoundupCents(40, { ...DEFAULT_RULES, smallOn: true })).toBe(60);
    expect(computeRoundupCents(40, { ...DEFAULT_RULES, smallOn: true, perSwapOn: true, perSwapCents: 10 })).toBe(70);
  });

  it("under $1 on: swaps under 10 cents are dust and never count", () => {
    expect(computeRoundupCents(9, { ...DEFAULT_RULES, smallOn: true, perSwapOn: true })).toBe(0);
    expect(computeRoundupCents(10, { ...DEFAULT_RULES, smallOn: true })).toBe(90);
  });

  it("combos: under-$1 + 25c on a 99c swap; 1% from $1 with round-up off", () => {
    expect(computeRoundupCents(99, { ...DEFAULT_RULES, smallOn: true, perSwapOn: true, perSwapCents: 25 })).toBe(1 + 25);
    expect(computeRoundupCents(250, { ...DEFAULT_RULES, roundupOn: false, pctThresholdCents: 100 })).toBe(2);
  });

  it("the 1% can start from $1: a $1.00 swap adds 1 cent", () => {
    expect(computeRoundupCents(100, { ...DEFAULT_RULES, pctThresholdCents: 100 })).toBe(1);
  });
});
