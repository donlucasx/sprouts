import { describe, it, expect } from "vitest";
import { CAN_GROW, CAN_OVERLAP, canScale, canHit, canBelow, canHome, dropSize, roseAt, DRIP } from "@/model/can";
import { SPRITE_META } from "@/garden/sprite-meta";

const REST = SPRITE_META["can"];
const ZOOMS = [0.5, 1, 1.25, 1.5, 2];
describe("the can's size and seat (R175; R180; R184; R188: 2.6x the first can, tucked under the soil's bottom-right corner)", () => {
  it("is drawn 2.6x G11's proportion (can11 at a third of the frame's zoom), never under 2.6 x 32 px wide", () => {
    expect(CAN_GROW).toBe(2.6);
    expect(REST.w * canScale(1)).toBeCloseTo(2.6 * 32, 9);              // at zoom 1 the 32 px floor: 83.2 px
    expect(REST.w * canScale(2)).toBeCloseTo(2.6 * REST.w * 2 / 3, 9);   // at the cap: 127.7 px
  });
  it("its top overlaps the view's bottom edge by 8 px and its right edge sits 4 px in", () => {
    for (const z of ZOOMS) {
      const s = canScale(z), home = canHome(320, 150, s);
      expect(home.y - REST.ay * s).toBeCloseTo(150 - CAN_OVERLAP, 9);
      expect(home.x + (REST.w - REST.ax) * s).toBeCloseTo(316, 9);
    }
  });
});

describe("the can's touch box (R184 item 5): at least 48 dp, all of it inside the garden's wrapper, holding the whole can", () => {
  for (const z of ZOOMS) it(`at zoom ${z}`, () => {
    const s = canScale(z), width = 320, viewH = 150, home = canHome(width, viewH, s), hit = canHit(s);
    const box = { x0: home.x - hit.ox, y0: home.y - hit.oy, x1: home.x - hit.ox + hit.w, y1: home.y - hit.oy + hit.h };
    expect(hit.w).toBeGreaterThanOrEqual(48); expect(hit.h).toBeGreaterThanOrEqual(48);
    // inside the wrapper: width wide, viewH plus the room below tall (Android drops touches outside a parent's bounds)
    expect(box.x0).toBeGreaterThanOrEqual(0); expect(box.x1).toBeLessThanOrEqual(width + 1e-9);
    expect(box.y0).toBeGreaterThanOrEqual(0); expect(box.y1).toBeLessThanOrEqual(viewH + canBelow(s) + 1e-9);
    // it holds the drawn rest can, and the room below holds all of it (never clipped)
    expect(box.x0).toBeLessThanOrEqual(home.x - REST.ax * s); expect(box.x1).toBeGreaterThanOrEqual(home.x + (REST.w - REST.ax) * s - 1e-9);
    expect(box.y0).toBeLessThanOrEqual(home.y - REST.ay * s); expect(box.y1).toBeGreaterThanOrEqual(home.y + (REST.h - REST.ay) * s - 1e-9);
  });
});

describe("the drip (R184 item 3): one drop at the rose every 4 s while a bud waits", () => {
  it("forms at the rose of the can at rest and falls a short way", () => {
    expect(DRIP.everyMs).toBe(4000);
    expect(DRIP.formMs + DRIP.fallMs).toBeLessThan(DRIP.everyMs);
    const r = roseAt(0, 1); expect(r).toEqual({ x: -38, y: -22 });   // gen11_motion.py:123, sprite units
    expect(DRIP.fallPx).toBeGreaterThan(0); expect(DRIP.fallPx).toBeLessThanOrEqual(16);
  });
  it("the drops keep the garden's scale, not the can's", () => expect(dropSize(canScale(1.5))).toBeCloseTo(1.5, 9));
});
