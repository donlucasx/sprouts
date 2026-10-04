import { describe, it, expect } from "vitest";
import { slotsFor, signSide, signX, signScale, SIGN_SCALE, ROW_OF, CANVAS } from "@/model/layout";

describe("the two rows (RG6, RG22, G6)", () => {
  it("six occupants take the locked slots", () => {
    expect(slotsFor(["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"])).toEqual({ skr: 0.3, ore: 0.8, hsol: 0.09, jitosol: 0.5, jupsol: 0.67, cbbtc: 0.92 });
  });
  it("a lone front occupant centres at 0.40; a lone back plant keeps its slot (RG22)", () => {
    expect(slotsFor(["skr"])).toEqual({ skr: 0.4 }); expect(slotsFor(["ore", "hsol"])).toEqual({ ore: 0.4, hsol: 0.09 }); expect(slotsFor(["hsol"])).toEqual({ hsol: 0.09 });
  });
  it("a bare sign occupies a slot like a plant", () => expect(slotsFor(["skr", "ore"])).toEqual({ skr: 0.3, ore: 0.8 }));
  it("rows and feet are the spec's", () => { expect(ROW_OF.jupsol).toBe("back"); expect(CANVAS).toEqual({ height: 290, soilLine: 200, backFeet: 214, frontFeet: 266, backScale: 0.8, frontScale: 1.3 }); });   // R231: from 260 and 244
});

describe("the sign rule (RG7, gen06:68-74)", () => {
  it("takes the side with more room at foot level, the edge counting as twice its distance; the clamp keeps it inside", () => {
    const xs = [0.09, 0.3, 0.5, 0.67, 0.8, 0.92].map((f) => f * 320);
    expect(signSide(0.3 * 320, xs, 320)).toBe(-1);   // at x 96: left 67.2 to hSOL, right 64 to JitoSOL; right is not larger, so left
    expect(signSide(0.09 * 320, xs, 320)).toBe(1);   // at x 28.8: left is twice the edge, 57.6; right 67.2 to SKR; right is larger
    expect(signX(0.92 * 320, 1, 320, signScale("back"))).toBeLessThanOrEqual(320 - 15 * signScale("back") - 1);
  });
  it("round 3 item 2 and R231: the signs 1.35x, the front row's 1.2 times that (1.62), the back row 0.8; the offset and the clamp use the bigger half width", () => {
    expect(SIGN_SCALE).toBe(1.35); expect(signScale("front")).toBeCloseTo(1.62, 12); expect(signScale("back")).toBeCloseTo(1.08, 12);
    expect(signX(96, -1, 320, signScale("front"))).toBeCloseTo(96 - (14 + 24.3 * 0.2), 9);   // 77.14 (79 at 1x)
    expect(signX(310, 1, 320, signScale("front"))).toBeCloseTo(320 - 24.3 - 1, 9);   // clamped a pixel inside: 294.7
    expect(signX(5, -1, 320, signScale("back"))).toBeCloseTo(16.2 + 1, 9);   // 17.2
  });
});
