import { describe, it, expect } from "vitest";
import { buildScene } from "@/model/garden";
import { plantLayouts } from "@/model/scene-to-layout";
import { frameFor, FOOT_Y, SIDE_GUTTER } from "@/model/layout";
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
// R183: at 5 degrees either way nothing of a plant leaves the garden's view at its top (the headroom holds it); at the sides the frame
// holds it wherever the frame is not already the canvas's own edge, and a full-breadth garden's plants spill at most into the screen's
// 20 px side gutters (I4 fix round 3: the plant layer is clipped vertically only, with that much room a side)
describe("the sway's room (R183, 5 degrees either way)", () => {
  for (const [label, input] of [["the year (day 365)", previewInputAt(365)], ["day 240", previewInputAt(240)], ["day 10 (zoomed to 2)", previewInputAt(10)], ["day 30 (zoomed, the frame inside the bed)", previewInputAt(30)]] as const) for (const width of [320, 353]) it(`${label} at ${width} wide`, () => {
    const s = buildScene(input), L = plantLayouts(s), f = frameFor(s, L, width);
    for (const p of L) for (const deg of [-SWAY.deg, SWAY.deg]) {
      const a = (deg * Math.PI) / 180, fx = p.x * width, fy = FOOT_Y(p.row);
      for (const q of p.layout.parts) for (const [x, y] of corners(q)) {
        const rx = fx + x * Math.cos(a) - y * Math.sin(a), ry = fy + x * Math.sin(a) + y * Math.cos(a);
        expect(ry, `${p.plant} ${q.kind} top at ${deg}`).toBeGreaterThanOrEqual(f.y);
        if (f.x > 0.5) expect(rx, `${p.plant} left`).toBeGreaterThanOrEqual(f.x);
        if (f.x + f.w < width - 0.5) expect(rx, `${p.plant} right`).toBeLessThanOrEqual(f.x + f.w);
        // the round-3 ruling: plants may spill into the screen's side gutters, never past them (on screen: (x - frame) * zoom)
        const sx = (rx - f.x) * f.zoom;
        expect(sx, `${p.plant} within the left gutter`).toBeGreaterThanOrEqual(-SIDE_GUTTER);
        expect(sx, `${p.plant} within the right gutter`).toBeLessThanOrEqual(width + SIDE_GUTTER);
      }
    }
  });
});

describe("the plant layer's side room (I4 fix round 3)", () => {
  it("is the screen's side padding, the 20 px Home leaves either side of the garden", () => expect(SIDE_GUTTER).toBe(20));
  it("the year garden's widest swing at the width the Saga's 393 dp screen gives (353) reaches into the gutter, so the room is needed", () => {
    const s = buildScene(previewInputAt(365)), L = plantLayouts(s), f = frameFor(s, L, 353);
    let lo = Infinity;
    for (const p of L) for (const q of p.layout.parts) for (const [x, y] of corners(q)) { const a = (-SWAY.deg * Math.PI) / 180; lo = Math.min(lo, (p.x * 353 + x * Math.cos(a) - y * Math.sin(a) - f.x) * f.zoom); }
    expect(lo).toBeLessThan(0);
  });
});
