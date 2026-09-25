import { describe, it, expect } from "vitest";
import { computeRoundupCents, DEFAULT_RULES } from "@/domain/roundup";

describe("computeRoundupCents", () => {
  it("rounds a $1.17 swap up to $2.00: 83 cents", () => expect(computeRoundupCents(117, DEFAULT_RULES)).toBe(83));

  it("whole dollar rounds up one dollar", () => {
    expect(computeRoundupCents(100, DEFAULT_RULES)).toBe(100);
    expect(computeRoundupCents(2000, DEFAULT_RULES)).toBe(100);
  });

  it("dust swap of 2 cents rounds up 98 cents", () => expect(computeRoundupCents(2, DEFAULT_RULES)).toBe(98));

  it("adds 1% on a $150.50 swap: 50 cents round-up plus 150 cents", () => expect(computeRoundupCents(15050, DEFAULT_RULES)).toBe(50 + 150));

  it("exactly $100 gets the 1%", () => expect(computeRoundupCents(10000, DEFAULT_RULES)).toBe(100 + 100));

  it("$99.99 does not get the 1%", () => expect(computeRoundupCents(9999, DEFAULT_RULES)).toBe(1));

  it("round-up off, pct on: only the 1%", () => expect(computeRoundupCents(15050, { ...DEFAULT_RULES, roundupOn: false })).toBe(150));

  it("both off: zero", () => expect(computeRoundupCents(15050, { ...DEFAULT_RULES, roundupOn: false, pctOn: false })).toBe(0));

  it("null size (unpriced): zero", () => expect(computeRoundupCents(null, DEFAULT_RULES)).toBe(0));

  it("zero size: zero", () => expect(computeRoundupCents(0, DEFAULT_RULES)).toBe(0));
});
