import { describe, it, expect } from "vitest";
import { buildScene } from "@/model/garden";
import { plantLayouts } from "@/model/scene-to-layout";
import { frameFor, FOOT_Y, PLANT_SCALE, SIDE_GUTTER } from "@/model/layout";
import { GUST, SWAY } from "@/model/motion";
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
/** Every part's box corner of every plant on screen (px from the view's left and top), each plant turned `deg` about its foot and drawn
 * PLANT_SCALE about it (R187), as Plant.tsx's view transform (plantTurn) draws it. */
function reach(L: ReturnType<typeof plantLayouts>, f: ReturnType<typeof frameFor>, width: number, deg: number) {
  const a = (deg * Math.PI) / 180, out: { plant: string; kind: string; rx: number; ry: number; sx: number; sy: number }[] = [];
  for (const p of L) {
    const fx = p.x * width, fy = FOOT_Y(p.row);
    for (const q of p.layout.parts) for (const [x0, y0] of corners(q)) {
      const x = x0 * PLANT_SCALE, y = y0 * PLANT_SCALE, rx = fx + x * Math.cos(a) - y * Math.sin(a), ry = fy + x * Math.sin(a) + y * Math.cos(a);
      out.push({ plant: p.plant, kind: q.kind, rx, ry, sx: (rx - f.x) * f.zoom, sy: (ry - f.y) * f.zoom });
    }
  }
  return out;
}
const GARDENS = [["the year (day 365)", previewInputAt(365)], ["day 240", previewInputAt(240)], ["day 120", previewInputAt(120)], ["day 10 (zoomed to 2)", previewInputAt(10)], ["day 30 (zoomed, the frame inside the bed)", previewInputAt(30)]] as const;
const ANGLES = [-SWAY.deg, SWAY.deg, GUST.deg];   // the steady sway either way, and R189's gust peak (always with the wind, rightward)

// R183 and R189 with R187's 1.25x plants: at the steady 5 degrees either way and at the gust's 12, nothing of a plant leaves the
// garden's view at its top (the headroom holds it; the frame is not refitted to the bigger plants); at the sides the frame holds a
// zoomed garden's plants wherever it sits inside the bed
describe("the wind's room at the top and inside a zoomed frame (R183, R187, R189)", () => {
  for (const [label, input] of GARDENS) for (const width of [320, 353]) it(`${label} at ${width} wide`, () => {
    const s = buildScene(input), L = plantLayouts(s), f = frameFor(s, L, width);
    for (const deg of ANGLES) for (const c of reach(L, f, width, deg)) {
      expect(c.ry, `${c.plant} ${c.kind} top at ${deg}`).toBeGreaterThanOrEqual(f.y);
      if (f.x > 0.5) expect(c.rx, `${c.plant} left at ${deg}`).toBeGreaterThanOrEqual(f.x);
      if (f.x + f.w < width - 0.5) expect(c.rx, `${c.plant} right at ${deg}`).toBeLessThanOrEqual(f.x + f.w);
    }
  });
});

// The round-3 ruling: plants may spill into the screen's 20 px side gutters (the plant layer's room), never past them. With R187's
// 1.25x plants that holds for a young or mid garden at every angle; a full-breadth garden (day 240, the year) cannot hold it: its frame
// is already the canvas's own edge, and R187 keeps the slots and the frame. The overshoot is measured here, so it can only shrink.
describe("the side gutters (I4 fix round 3) with 1.25x plants (R187)", () => {
  for (const [label, input] of GARDENS.slice(2)) for (const width of [320, 353]) it(`${label} at ${width} wide stays within the gutters, gusts included`, () => {
    const s = buildScene(input), L = plantLayouts(s), f = frameFor(s, L, width);
    for (const deg of ANGLES) for (const c of reach(L, f, width, deg)) {
      expect(c.sx, `${c.plant} within the left gutter at ${deg}`).toBeGreaterThanOrEqual(-SIDE_GUTTER);
      expect(c.sx, `${c.plant} within the right gutter at ${deg}`).toBeLessThanOrEqual(width + SIDE_GUTTER);
    }
  });
  // measured 10-02 with the baked boxes (they overstate the paint by about 2 px a side, 2.5 at 1.25x): past the gutter, at 320 / 353 wide
  //   the year:   steady sway  left 7.7 / 4.7  right 8.1 / 5.5;  gust peak  right 13.5 / 10.8 (hSOL's head left, cbBTC's spruce right)
  //   day 240:    steady sway  left 2.5 / 0    right 8.1 / 5.5;  gust peak  right 13.5 / 10.8
  for (const [label, input] of GARDENS.slice(0, 2)) for (const width of [320, 353]) it(`${label} at ${width} wide spills past the gutter by at most 9 px in the steady sway and 14 px at a gust's peak`, () => {
    const s = buildScene(input), L = plantLayouts(s), f = frameFor(s, L, width);
    const past = (deg: number) => Math.max(0, ...reach(L, f, width, deg).map((c) => Math.max(-SIDE_GUTTER - c.sx, c.sx - width - SIDE_GUTTER)));
    expect(Math.max(past(-SWAY.deg), past(SWAY.deg))).toBeLessThanOrEqual(9);
    expect(past(GUST.deg)).toBeLessThanOrEqual(14);
    expect(past(GUST.deg)).toBeGreaterThan(0);   // the cost is real at 1.25x: reported to the founder (i4b report, concern 1)
  });
});

describe("the plant layer's side room (I4 fix round 3)", () => {
  it("is the screen's side padding, the 20 px Home leaves either side of the garden", () => expect(SIDE_GUTTER).toBe(20));
  it("the year garden's widest swing at the width the Saga's 393 dp screen gives (353) reaches into the gutter, so the room is needed", () => {
    const s = buildScene(previewInputAt(365)), L = plantLayouts(s), f = frameFor(s, L, 353);
    expect(Math.min(...reach(L, f, 353, -SWAY.deg).map((c) => c.sx))).toBeLessThan(0);
  });
});
