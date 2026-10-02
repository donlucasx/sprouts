import { describe, it, expect } from "vitest";
import { slotsFor, signSide, signX, ROW_OF, CANVAS } from "@/model/layout";

describe("the two rows (RG6, RG22, G6)", () => {
  it("six occupants take the locked slots", () => {
    expect(slotsFor(["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"])).toEqual({ skr: 0.3, ore: 0.8, hsol: 0.09, jitosol: 0.5, jupsol: 0.67, cbbtc: 0.92 });
  });
  it("a lone front occupant centres at 0.40; a lone back plant keeps its slot (RG22)", () => {
    expect(slotsFor(["skr"])).toEqual({ skr: 0.4 }); expect(slotsFor(["ore", "hsol"])).toEqual({ ore: 0.4, hsol: 0.09 }); expect(slotsFor(["hsol"])).toEqual({ hsol: 0.09 });
  });
  it("a bare sign occupies a slot like a plant", () => expect(slotsFor(["skr", "ore"])).toEqual({ skr: 0.3, ore: 0.8 }));
  it("rows and feet are the spec's", () => { expect(ROW_OF.jupsol).toBe("back"); expect(CANVAS).toEqual({ height: 260, soilLine: 200, backFeet: 214, frontFeet: 244, backScale: 0.8 }); });
});

describe("the sign rule (RG7, gen06:68-74)", () => {
  it("takes the side with more room at foot level, the edge counting as twice its distance; the clamp keeps it inside", () => {
    const xs = [0.09, 0.3, 0.5, 0.67, 0.8, 0.92].map((f) => f * 320);
    expect(signSide(0.3 * 320, xs, 320)).toBe(-1);   // at x 96: left 67.2 to hSOL, right 64 to JitoSOL; right is not larger, so left
    expect(signSide(0.09 * 320, xs, 320)).toBe(1);   // at x 28.8: left is twice the edge, 57.6; right 67.2 to SKR; right is larger
    expect(signX(0.92 * 320, 1, 320, 0.8)).toBeLessThanOrEqual(320 - 15 * 0.8 - 1);
  });
});
