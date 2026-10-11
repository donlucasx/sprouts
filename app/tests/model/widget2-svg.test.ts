import { describe, it, expect } from "vitest";
import { allStages, frameTop, type Stages } from "@/model/garden2";
import { CANVAS } from "@/garden2/layout";
import { FRAME_K, frameInner, frameK, HORIZON_TOP, MIN_SPAN, plantedSpan, plantedTop, PLATE_FOOT, widget2View, widgetFrame, widgetGarden2 } from "@/model/widget2-svg";
import { WIDGET2_FRAME } from "@/garden2/widget-b64";

const only = (s: Partial<Stages>): Stages => ({ ...allStages(0), ...s });
const box = (svg: string) => svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!.slice(1).map(Number);

describe("10-11 (his notes: \"a lot of sand under and above... we should have a horizon... cropped in a bit to fill the space\"): the painting fills the opening", () => {
  const GB = { x: 4, y: 60, w: 230, h: 145 }, W = 238, H = 232;
  const st = only({ mandarin: 8, store: 4, azalea: 3, maple: 1 }), ex = { stakes: true };
  it("the SVG is the whole opening; its view inside the plate across, at the opening's own aspect", () => {
    const g = widgetGarden2(st, ex, W, H, GB), [x, , vw, vh] = box(g.svg);
    expect([g.w, g.h]).toEqual([W, H]); expect(g.svg).toContain(`width="${W}" height="${H}"`);
    expect(x).toBeGreaterThanOrEqual(0); expect(x + vw).toBeLessThanOrEqual(CANVAS.w + 0.01); expect(vw / vh).toBeCloseTo(W / H, 2);
  });
  it("what is planted sits in the garden box: across it whole, its tallest plant at the box's top, the plate's foot above the bottom line", () => {
    const v = widget2View(st, W, H, GB), span = plantedSpan(st), at = (cx: number) => (cx - v.x) * v.s, down = (cy: number) => (cy - v.y) * v.s;
    expect(at(span.x0)).toBeGreaterThanOrEqual(GB.x - 0.5); expect(at(span.x1)).toBeLessThanOrEqual(GB.x + GB.w + 0.5);
    expect(down(plantedTop(st))).toBeGreaterThanOrEqual(GB.y - 0.5);
    expect(down(PLATE_FOOT)).toBeLessThanOrEqual(GB.y + GB.h + 0.5);
    // and it fills the box one way or the other: as tall as it, or as wide as what is planted
    const tall = (PLATE_FOOT - plantedTop(st)) * v.s, wide = (span.x1 - span.x0) * v.s;
    expect(Math.abs(tall - GB.h) < 0.5 || Math.abs(wide - GB.w) < 0.5).toBe(true);
  });
  it("cropped in: the decor at the plate's sides may fall outside, what is planted never does", () => {
    const v = widget2View(st, W, H, GB);
    expect(v.w).toBeLessThan(CANVAS.w);
    const span = plantedSpan(st); expect(span.x0).toBeGreaterThanOrEqual(v.x - 0.01); expect(span.x1).toBeLessThanOrEqual(v.x + v.w + 0.01);
  });
  it("a very wide opening keeps the painting's fitted size (paper beside the plate), so the plants never reach the headline", () => {
    const gb = { x: 150, y: 4, w: 300, h: 90 }, v = widget2View(st, 460, 120, gb), span = plantedSpan(st);
    expect(v.w).toBeGreaterThan(CANVAS.w);
    expect((span.x0 - v.x) * v.s).toBeGreaterThanOrEqual(gb.x - 0.5); expect((plantedTop(st) - v.y) * v.s).toBeGreaterThanOrEqual(gb.y - 0.5);
  });
  it("a lone seedling is not a close-up: the crop is never narrower than MIN_SPAN", () => {
    const sp = plantedSpan(only({ mandarin: 2 })); expect(sp.x1 - sp.x0).toBeCloseTo(MIN_SPAN, 5); expect(sp.x0).toBeGreaterThanOrEqual(0);
  });
  it("the view starts at the tallest planted plant, not the bamboo stand (a young garden is not a band of sky)", () => {
    const young = only({ mandarin: 3 });
    expect(plantedTop(young)).toBeGreaterThan(frameTop(young)); expect(plantedTop(allStages(0))).toBe(frameTop(allStages(0)));
    expect(plantedTop(young)).toBeLessThanOrEqual(HORIZON_TOP - 24);   // the horizon and the lantern stay in view

  });
  it("draws the plate, each planted plant's own stage still, and never a plant's other stages; no fade on anything", () => {
    const { svg } = widgetGarden2(only({ mandarin: 6, azalea: 3 }), ex, 400, 200, { x: 4, y: 40, w: 392, h: 140 });
    for (const k of ["plate", "mandarin-6", "azalea-3"]) expect(svg).toContain(`id="w-${k}"`);
    expect(svg).not.toContain('id="w-mandarin-5"'); expect(svg).toMatch(/data:image\/webp;base64,/);
    expect(svg).not.toContain("mask"); expect(svg).not.toContain("Gradient");
  });
  it("stakes and their names where the name comes out readable; none where it would be a speck", () => {
    const all6 = only({ mandarin: 6, store: 6, maple: 6, azalea: 6, orchid: 6, pothos: 6 });
    expect(widgetGarden2(all6, ex, 900, 500, { x: 0, y: 40, w: 900, h: 420 }).svg).toContain(">SKR</text>");
    expect(widgetGarden2(all6, ex, 90, 60, { x: 0, y: 10, w: 90, h: 40 }).svg).not.toContain("<text");
  });
  it("nothing planted: the whole bed, no stakes", () => {
    const { svg } = widgetGarden2(allStages(0), ex, 300, 150, { x: 0, y: 30, w: 300, h: 100 });
    expect(svg).toContain('id="w-plate"'); expect(svg).not.toContain("<text");
    expect(plantedSpan(allStages(0))).toEqual({ x0: 0, x1: CANVAS.w });
  });
});

describe("10-10 (his ask: \"contained by a bamboo frame in the same style of the artwork\"): the nine-slice frame", () => {
  const imgs = (svg: string) => [...svg.matchAll(/<image x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => m.slice(1).map(Number));
  it("eight pieces tile the widget edge to edge; the corners keep the painting's shape, the runs stretch", () => {
    const W = 300, H = 260, k = frameK(W, H), parts = imgs(widgetFrame(W, H));
    expect(k).toBe(FRAME_K); expect(parts).toHaveLength(8);
    const [tl, t, tr] = parts;
    expect(tl).toEqual([0, 0, WIDGET2_FRAME.cut.l * k, WIDGET2_FRAME.cut.t * k].map((n) => Number(n.toFixed(2))));
    expect(t[0]).toBeCloseTo(tl[2]); expect(t[0] + t[2]).toBeCloseTo(tr[0]); expect(tr[0] + tr[2]).toBeCloseTo(W);
    const br = parts[7]; expect(br[1] + br[3]).toBeCloseTo(H);
  });
  it("paper fills the frame to its poles' centre lines (the painting's sky runs on into it); the opening sits inside the poles", () => {
    const W = 260, H = 200, k = frameK(W, H), svg = widgetFrame(W, H), m = WIDGET2_FRAME.mid;
    const r = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#FFFCF6"/)!.slice(1).map(Number);
    expect(r[0]).toBeCloseTo(m.l * k, 1); expect(r[0] + r[2]).toBeCloseTo(W - m.r * k, 1); expect(r[1] + r[3]).toBeCloseTo(H - m.b * k, 1);
    const o = frameInner(W, H);
    expect(o.l).toBeGreaterThan(m.l * k); expect(o.l + o.w + o.r).toBe(W); expect(o.t + o.h + o.b).toBe(H);
  });
  it("a small widget gets a thinner frame (never under its floor)", () => {
    expect(frameK(110, 100)).toBeLessThan(FRAME_K); expect(frameK(110, 100)).toBeGreaterThanOrEqual(0.05);
  });
});
