import { describe, it, expect } from "vitest";
import { PLANT_SCALE, fromFoot, plantTurn } from "@/model/layout";

/** React Native's view transform: about the origin, the list applied in order (each entry multiplies on the right), so a point p of the
 * view lands at origin + M (p - origin). Only rotate and scale are used here. */
function applyRn(transform: ({ rotate: string } | { scale: number })[], origin: { x: number; y: number }, p: { x: number; y: number }) {
  let m = [1, 0, 0, 1];
  for (const t of transform) {
    const n = "scale" in t ? [t.scale, 0, 0, t.scale] : (() => { const a = (parseFloat(t.rotate) * Math.PI) / 180; return [Math.cos(a), -Math.sin(a), Math.sin(a), Math.cos(a)]; })();
    m = [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3]];
  }
  const dx = p.x - origin.x, dy = p.y - origin.y;
  return { x: origin.x + m[0] * dx + m[1] * dy, y: origin.y + m[2] * dx + m[3] * dy };
}

describe("R187: every plant draws 1.25x about its own foot, same slot", () => {
  it("is 1.25", () => expect(PLANT_SCALE).toBe(1.25));
  it("a point of the plant moves away from the foot by 1.25, the foot stays put", () => {
    expect(fromFoot({ x: 100, y: 244 }, { x: 100, y: 244 })).toEqual({ x: 100, y: 244 });
    expect(fromFoot({ x: 100, y: 144 }, { x: 100, y: 244 })).toEqual({ x: 100, y: 119 });   // a tip 100 above the foot: 125 above
    expect(fromFoot({ x: 120, y: 234 }, { x: 100, y: 244 })).toEqual({ x: 125, y: 231.5 });
  });
  it("the plant view's transform (about the foot, its transform origin) scales by 1.25 and turns by the wind's angle, the foot fixed", () => {
    const foot = { x: 40, y: 90 };
    for (const deg of [0, 5, -5, 12]) {
      const t = plantTurn(deg);
      expect(applyRn(t, foot, foot)).toEqual(foot);
      const tip = applyRn(t, foot, { x: 40, y: 10 }), a = (deg * Math.PI) / 180;   // 80 above the foot
      expect(tip.x).toBeCloseTo(40 + 80 * 1.25 * Math.sin(a), 9);
      expect(tip.y).toBeCloseTo(90 - 80 * 1.25 * Math.cos(a), 9);
    }
    expect(plantTurn(0)).toContainEqual({ scale: 1.25 });
  });
});
