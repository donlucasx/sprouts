import { describe, it, expect } from "vitest";
import { capLeftCents, plantAmountCents } from "@/domain/cap";

describe("cap", () => {
  it("cap left is cap minus pulled, never negative", () => {
    expect(capLeftCents(500, 120)).toBe(380);
    expect(capLeftCents(500, 900)).toBe(0);
  });

  it("plants pending plus fee when it fits", () => {
    expect(plantAmountCents({ pendingCents: 214, capLeftCents: 500, feeCents: 3, minCents: 200 })).toEqual({ pullCents: 217, changeCents: 214 });
  });

  it("cap left bounds the pull including fee", () => {
    expect(plantAmountCents({ pendingCents: 3000, capLeftCents: 500, feeCents: 3, minCents: 200 })).toEqual({ pullCents: 500, changeCents: 497 });
  });

  it("below the minimum plants nothing", () => {
    expect(plantAmountCents({ pendingCents: 140, capLeftCents: 500, feeCents: 3, minCents: 200 })).toEqual({ pullCents: 0, changeCents: 0 });
  });

  it("cap exhausted plants nothing", () => {
    expect(plantAmountCents({ pendingCents: 900, capLeftCents: 0, feeCents: 3, minCents: 200 })).toEqual({ pullCents: 0, changeCents: 0 });
  });

  it("forced (7-day rule) ignores the minimum but not the cap", () => {
    expect(plantAmountCents({ pendingCents: 140, capLeftCents: 500, feeCents: 3, minCents: 0 })).toEqual({ pullCents: 143, changeCents: 140 });
  });
});
