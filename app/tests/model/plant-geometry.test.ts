import { describe, it, expect } from "vitest";
import { nodeRise, stemRise, side, MAX_RISE, TRANSPLANT_BASE } from "@/model/plant-geometry";

describe("plant geometry (R89)", () => {
  it("stacks shoots up the stem, oldest lowest, alternating sides", () => {
    expect([0, 1, 2].map((i) => nodeRise(i, 3))).toEqual([16, 32, 48]);
    expect([0, 1, 2].map(side)).toEqual([-1, 1, -1]);
  });

  it("the stem reaches a little past the newest shoot", () => {
    expect(stemRise(3)).toBe(60);
    expect(stemRise(0)).toBe(0);
  });

  it("a long history still fits under the cap", () => {
    expect(stemRise(40)).toBeLessThanOrEqual(MAX_RISE);
    expect(stemRise(40, TRANSPLANT_BASE)).toBeLessThanOrEqual(MAX_RISE);
    expect(nodeRise(39, 40)).toBeGreaterThan(nodeRise(38, 40));
  });

  it("a transplant's own plantings start above its grown base", () => {
    expect(nodeRise(0, 1, TRANSPLANT_BASE)).toBe(TRANSPLANT_BASE + 16);
  });
});
