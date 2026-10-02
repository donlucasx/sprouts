import { describe, it, expect } from "vitest";
import { CAN_GROW, CAN_OVERLAP, canScale, canTouch, canBelow, canHome, dropSize } from "@/model/can";
import { SPRITE_META } from "@/garden/sprite-meta";

const REST = SPRITE_META["can"];
describe("the can's size and seat (R175; R180: 1.6x, tucked under the soil's bottom-right corner, a 48 dp target)", () => {
  it("is drawn 1.6x G11's proportion (can11 at a third of the frame's zoom), never under 1.6 x 32 px wide", () => {
    expect(CAN_GROW).toBe(1.6);
    expect(REST.w * canScale(1)).toBeCloseTo(1.6 * 32, 9);           // at zoom 1 the 32 px floor: 51.2 px
    expect(REST.w * canScale(2)).toBeCloseTo(1.6 * REST.w * 2 / 3, 9);   // at the cap: 78.6 px
  });
  it("its touch box is at least 48 dp at every zoom the frame takes", () => {
    for (const z of [0.5, 1, 1.25, 1.5, 2]) expect(canTouch(canScale(z))).toBeGreaterThanOrEqual(48);
    expect(canTouch(0.1)).toBe(48);
  });
  it("its top overlaps the view's bottom edge by 8 px, its right edge 4 px in, and the room below holds the rest of it", () => {
    for (const z of [1, 2]) {
      const s = canScale(z), home = canHome(320, 150, s);
      expect(home.y - REST.ay * s).toBeCloseTo(150 - CAN_OVERLAP, 9);
      expect(home.x + (REST.w - REST.ax) * s).toBeCloseTo(316, 9);
      expect(home.y + (REST.h - REST.ay) * s).toBeCloseTo(150 + canBelow(s), 9);   // nothing of it below the garden's wrapper
      expect(home.x - REST.ax * s).toBeGreaterThan(0);
    }
  });
  it("the drops keep the garden's scale, not the can's", () => expect(dropSize(canScale(1.5))).toBeCloseTo(1.5, 9));
});
