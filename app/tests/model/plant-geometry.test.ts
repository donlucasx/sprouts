import { describe, it, expect } from "vitest";
import { nodeRise, stemRise, side, pupOffset, MAX_RISE, TRANSPLANT_BASE } from "@/model/plant-geometry";

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

// 09-30, the Saga: the ORE plant's forming pup sat 17 px from the stem and read as a seed. Pups grow at the succulent's foot,
// touching the stem or the pup before them on their side, alternating sides; a forming pup (smaller) takes the next slot.
describe("ORE pups at the succulent's foot", () => {
  it("full pups touch the stem, then each other, alternating sides", () => {
    expect([0, 1, 2, 3].map((i) => pupOffset(i))).toEqual([-6.25, 6.25, -14.25, 14.25]);
  });
  it("a forming pup of any size touches whatever stands on its side", () => {
    expect(pupOffset(0, 2)).toBe(-4.25);    // the stem's edge is 2.25 out; a 2 px pup centres 4.25 out
    expect(pupOffset(2, 2)).toBe(-12.25);   // pup 0 reaches 10.25 out on that side
    expect(pupOffset(1, 5)).toBe(7.25);
  });
});
