import { describe, it, expect } from "vitest";
import { allStages, frameTop, type Stages } from "@/model/garden2";
import { CANVAS } from "@/garden2/layout";
import { FRAME_K, frameInner, frameK, widget2Box, widgetFrame, widgetGarden2 } from "@/model/widget2-svg";
import { WIDGET2_FRAME, WIDGET2_SAND } from "@/garden2/widget-b64";

const only = (s: Partial<Stages>): Stages => ({ ...allStages(0), ...s });
const box = (svg: string) => svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!.slice(1).map(Number);

describe("10-11 (his note: \"Match the garden art and all the decor so it looks the same on the widget and the app\"): Home's view", () => {
  it("the plate's full width, from Home's frameTop to its foot: the lantern, the stand and the rake are never cropped", () => {
    const st = only({ mandarin: 8, store: 6, azalea: 5 });
    expect(box(widgetGarden2(st, { stakes: true }, 200, 200).svg)).toEqual([0, frameTop(st), CANVAS.w, CANVAS.h - frameTop(st)]);
    expect(widget2Box(st)).toEqual({ x: 0, y: frameTop(st), w: CANVAS.w, h: CANVAS.h - frameTop(st) });
  });
  it("fitted inside the box at the view's own aspect: as wide as it, or as tall as it", () => {
    const st = only({ mandarin: 8, store: 6 }), v = widget2Box(st);
    const wide = widgetGarden2(st, { stakes: true }, 200, 400); expect(wide.w).toBe(200); expect(wide.h).toBe(Math.round((200 * v.h) / v.w));
    const short = widgetGarden2(st, { stakes: true }, 400, 60); expect(short.h).toBe(60); expect(short.w).toBe(Math.round((60 * v.w) / v.h));
  });
  it("draws the plate, each planted plant's own stage still, and never a plant's other stages", () => {
    const { svg } = widgetGarden2(only({ mandarin: 6, azalea: 3 }), { stakes: true }, 400, 200);
    for (const k of ["plate", "mandarin-6", "azalea-3"]) expect(svg).toContain(`id="w-${k}"`);
    expect(svg).not.toContain('id="w-mandarin-5"');
    expect(svg).toMatch(/data:image\/webp;base64,/);
  });
  it("no fade on anything drawn (10-11: the fades read airbrushed)", () => {
    const { svg } = widgetGarden2(only({ mandarin: 6, store: 5 }), { stakes: true }, 206, 140);
    expect(svg).not.toContain("mask"); expect(svg).not.toContain("Gradient");
  });
  it("stakes and their names on a wide widget; none where the name would be a speck", () => {
    const st = only({ mandarin: 6, store: 6, maple: 6, azalea: 6, orchid: 6, pothos: 6 });
    expect(widgetGarden2(st, { stakes: true }, 900, 400).svg).toContain(">SKR</text>");
    expect(widgetGarden2(st, { stakes: true }, 90, 60).svg).not.toContain("<text");
  });
  it("nothing planted: the bed, no stakes", () => {
    const { svg } = widgetGarden2(allStages(0), { stakes: true }, 300, 150);
    expect(svg).toContain('id="w-plate"'); expect(svg).not.toContain("<text");
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
  it("raked sand fills the frame to its poles' centre lines, rows down the whole opening; the opening sits inside the poles", () => {
    const W = 260, H = 200, k = frameK(W, H), svg = widgetFrame(W, H), m = WIDGET2_FRAME.mid;
    const r = svg.match(/<clipPath id="in"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/)!.slice(1).map(Number);
    expect(r[0]).toBeCloseTo(m.l * k, 1); expect(r[0] + r[2]).toBeCloseTo(W - m.r * k, 1); expect(r[1] + r[3]).toBeCloseTo(H - m.b * k, 1);
    const th = (WIDGET2_SAND.h * r[2]) / CANVAS.w, rows = svg.match(/<use xlink:href="#sand"/g)!.length;
    expect(rows * th).toBeGreaterThanOrEqual(r[3]);
    expect(svg).not.toContain("#FFFCF6");
    const o = frameInner(W, H);
    expect(o.l).toBeGreaterThan(m.l * k); expect(o.l + o.w + o.r).toBe(W); expect(o.t + o.h + o.b).toBe(H);
  });
  it("a small widget gets a thinner frame (never under its floor)", () => {
    expect(frameK(110, 100)).toBeLessThan(FRAME_K); expect(frameK(110, 100)).toBeGreaterThanOrEqual(0.05);
  });
});
