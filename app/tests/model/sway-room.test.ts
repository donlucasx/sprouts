import { describe, it, expect } from "vitest";
import { buildScene, type GardenInput } from "@/model/garden";
import { plantLayouts } from "@/model/scene-to-layout";
import { frameFor, FOOT_Y } from "@/model/layout";
import { SWAY } from "@/model/motion";
import { SPRITE_META } from "@/garden/sprite-meta";
import { previewInputAt } from "@/model/fixtures/median-year";
import type { Placed } from "@/model/species";

/** A part's painted box corners (the sprite's baked box, or a stem's two ends) in the plant's frame. */
function corners(q: Placed): [number, number][] {
  if (q.kind === "stem") return [[q.x0, q.y0], [q.x1, q.y1]];
  const m = SPRITE_META[q.name]; if (!m) return [[q.x, q.y]];
  const r = (q.rot * Math.PI) / 180, sx = q.xScale ?? q.scale, sy = q.scale;
  return ([[0, 0], [m.w, 0], [0, m.h], [m.w, m.h]] as const).map(([u, v]) => { const lx = (u - m.ax) * sx, ly = (v - m.ay) * sy; return [q.x + lx * Math.cos(r) - ly * Math.sin(r), q.y + lx * Math.sin(r) + ly * Math.cos(r)]; });
}
const young = (() => { const s = previewInputAt(60); return { ...s } as GardenInput; })();
// R183: at 5 degrees either way nothing of a plant leaves the garden's view at its top (the headroom holds it); at the sides the frame
// holds it wherever the frame is not already the canvas's own edge (a full-breadth garden is limited by the canvas: see the report)
describe("the sway's room (R183, 5 degrees either way)", () => {
  for (const [label, input] of [["the year (day 365)", previewInputAt(365)], ["day 240", previewInputAt(240)], ["day 60", young]] as const) for (const width of [320, 353]) it(`${label} at ${width} wide`, () => {
    const s = buildScene(input), L = plantLayouts(s), f = frameFor(s, L, width);
    for (const p of L) for (const deg of [-SWAY.deg, SWAY.deg]) {
      const a = (deg * Math.PI) / 180, fx = p.x * width, fy = FOOT_Y(p.row);
      for (const q of p.layout.parts) for (const [x, y] of corners(q)) {
        const rx = fx + x * Math.cos(a) - y * Math.sin(a), ry = fy + x * Math.sin(a) + y * Math.cos(a);
        expect(ry, `${p.plant} ${q.kind} top at ${deg}`).toBeGreaterThanOrEqual(f.y);
        if (f.x > 0.5) expect(rx, `${p.plant} left`).toBeGreaterThanOrEqual(f.x);
        if (f.x + f.w < width - 0.5) expect(rx, `${p.plant} right`).toBeLessThanOrEqual(f.x + f.w);
      }
    }
  });
});
