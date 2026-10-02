import { describe, it, expect } from "vitest";
import { plantUnder, slotsFor, toCanvas } from "@/model/layout";
const six = slotsFor(["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"]);   // gen06_garden.py:59: skr .30, ore .80, hsol .09, jitosol .50, jupsol .67, cbbtc .92; at 320 wide 96, 256, 28.8, 160, 214.4, 294.4
describe("the plant under the rose (RG25; the slots are those of the plants with a closed bud)", () => {
  it("the nearest slot by x within 40 px, over the garden", () => {
    expect(plantUnder(96, 120, six, 320)).toBe("skr");
    expect(plantUnder(300, 60, six, 320)).toBe("cbbtc");      // 5.6 px from .92
    expect(plantUnder(130, 100, six, 320)).toBe("jitosol");   // 34 from SKR, 30 from JitoSOL: the nearer wins
    expect(plantUnder(62, 100, six, 320)).toBe("hsol");       // 33.2 from hSOL, 34 from SKR
  });
  it("nothing when the rose is off every plant, below the front feet, above the canvas, or no plant has a bud", () => {
    expect(plantUnder(60, 100, { skr: 0.4 }, 320)).toBeNull();   // a lone front SKR at .40 = 128 px: 68 away
    expect(plantUnder(120, 100, { skr: 0.4 }, 320)).toBe("skr");
    expect(plantUnder(96, 300, six, 320)).toBeNull();            // below the front feet (244) plus 10
    expect(plantUnder(96, -1, six, 320)).toBeNull();
    expect(plantUnder(96, 120, {}, 320)).toBeNull();
  });
});
describe("a point on the garden's view back to the canvas (the frame of RG30: canvas p lands at (p - frame) * zoom)", () => {
  it("undoes the frame's offset and zoom", () => {
    expect(toCanvas({ x: 0, y: 0 }, { x: 40, y: 100, zoom: 2 })).toEqual({ x: 40, y: 100 });
    expect(toCanvas({ x: 120, y: 60 }, { x: 40, y: 100, zoom: 2 })).toEqual({ x: 100, y: 130 });
    expect(toCanvas({ x: 96, y: 120 }, { x: 0, y: 0, zoom: 1 })).toEqual({ x: 96, y: 120 });
  });
});
