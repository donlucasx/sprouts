import { describe, it, expect } from "vitest";
import { FIRST_PLANTING_MIN_CENTS, plantThresholdFor } from "@/domain/threshold";

describe("plantThresholdFor (first planting, owner 10-22)", () => {
  it("the first planting is at 50 cents", () => {
    expect(FIRST_PLANTING_MIN_CENTS).toBe(50);
    expect(plantThresholdFor({ ruleCents: 200, hasPlanted: false })).toBe(50);
  });

  it("after the first planting the user's own threshold applies", () => {
    expect(plantThresholdFor({ ruleCents: 200, hasPlanted: true })).toBe(200);
    expect(plantThresholdFor({ ruleCents: 1_000, hasPlanted: true })).toBe(1_000);
  });

  it("a user whose own threshold is lower keeps theirs, before and after", () => {
    expect(plantThresholdFor({ ruleCents: 10, hasPlanted: false })).toBe(10);
    expect(plantThresholdFor({ ruleCents: 10, hasPlanted: true })).toBe(10);
    expect(plantThresholdFor({ ruleCents: 50, hasPlanted: false })).toBe(50);
  });

  it("a high own threshold does not delay the first planting", () => {
    expect(plantThresholdFor({ ruleCents: 2_000, hasPlanted: false })).toBe(50);
  });
});
