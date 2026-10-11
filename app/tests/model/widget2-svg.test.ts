import { describe, it, expect } from "vitest";
import { allStages, paintedBox, type Stages } from "@/model/garden2";
import { CANVAS } from "@/garden2/layout";
import { MIN_VIEW_W, VIEW_PAD, widget2Need, widgetCard, widgetGarden2 } from "@/model/widget2-svg";

const only = (s: Partial<Stages>): Stages => ({ ...allStages(0), ...s });
const box = (svg: string) => svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!.slice(1).map(Number);

describe("10-10: the widget draws Garden2 as stills, cropped to what is planted", () => {
  it("a lone mandarin: the view holds its painted box with VIEW_PAD around it, at least MIN_VIEW_W wide", () => {
    const st = only({ mandarin: 6 }), b = paintedBox("mandarin", 6)!, n = widget2Need(st, { stakes: true });
    expect(n.x0).toBeLessThanOrEqual(b.x0 - VIEW_PAD + 0.01); expect(n.x1).toBeGreaterThanOrEqual(b.x1 + VIEW_PAD - 0.01);
    expect(n.y0).toBe(Math.max(0, b.y0 - VIEW_PAD)); expect(n.x1 - n.x0).toBeGreaterThanOrEqual(MIN_VIEW_W);
    expect(n.x0).toBeGreaterThanOrEqual(0); expect(n.x1).toBeLessThanOrEqual(CANVAS.w);
  });
  it("draws the plate, each planted plant's own stage still, and never a plant's other stages", () => {
    const { svg } = widgetGarden2(only({ mandarin: 6, azalea: 3 }), { stakes: true }, 400, 200);
    for (const k of ["plate", "mandarin-6", "azalea-3"]) expect(svg).toContain(`id="w-${k}"`);
    expect(svg).not.toContain('id="w-mandarin-5"');
    expect(svg).toMatch(/data:image\/webp;base64,/);
  });
  it("stakes and their names on a wide widget; none where the name would be a speck", () => {
    const st = only({ mandarin: 6, store: 6, maple: 6, azalea: 6, orchid: 6, pothos: 6 });
    expect(widgetGarden2(st, { stakes: true }, 900, 400).svg).toContain(">SKR</text>");
    expect(widgetGarden2(st, { stakes: true }, 90, 60).svg).not.toContain("<text");
  });
  it("height-bound: as tall as the room, the view widened across the plate, never past it", () => {
    const g = widgetGarden2(only({ mandarin: 3 }), { stakes: true }, 430, 60), [x, , w] = box(g.svg);
    expect(g.h).toBe(60); expect(x).toBeGreaterThanOrEqual(0); expect(x + w).toBeLessThanOrEqual(CANVAS.w + 0.01);
  });
  it("his note 10-10: a box taller than the garden fills more of it, zoomed in on the trees and both kept whole", () => {
    const st = only({ mandarin: 8, store: 6, azalea: 5, pothos: 5 });
    const g = widgetGarden2(st, { stakes: true }, 160, 200), [x, , w] = box(g.svg), n = widget2Need(st, { stakes: true });
    // taller than the whole garden at that width; the box itself is reached once the two trees fit across it
    expect(g.h).toBeGreaterThan(Math.round((160 * (n.y1 - n.y0)) / (n.x1 - n.x0)));
    expect(widgetGarden2(only({ mandarin: 4, azalea: 3 }), { stakes: true }, 160, 200).h).toBe(200);
    for (const t of ["mandarin", "store"] as const) { const b = paintedBox(t, st[t])!; expect(b.x0).toBeGreaterThanOrEqual(x - 0.01); expect(b.x1).toBeLessThanOrEqual(x + w + 0.01); }
    expect(w).toBeLessThan(widget2Need(st, { stakes: true }).x1 - widget2Need(st, { stakes: true }).x0);
  });
  it("nothing planted: the bed, no stakes", () => {
    const { svg } = widgetGarden2(allStages(0), { stakes: true }, 300, 150);
    expect(svg).toContain('id="w-plate"'); expect(svg).not.toContain("<text");
  });
});

describe("10-10 (his note: \"make the edges transparent a bit\"): the card's rim and the garden's edges fade out", () => {
  const stops = (svg: string, id: string) => svg.match(new RegExp(`id="${id}"[^>]*>(.*?)</linearGradient>`))![1].match(/offset="([\d.]+)"[^>]*?(stop-opacity="0")?\/>/g)!;
  it("the card: transparent at every edge, full paper from `feather` in, both axes masked over the whole widget", () => {
    const svg = widgetCard(200, 100, 12);
    expect(svg).toContain('width="200" height="100"'); expect(svg).toContain('fill="#FFFCF6"');
    const h = stops(svg, "card-gh"), v = stops(svg, "card-gv");
    expect(h[0]).toContain('offset="0"'); expect(h[0]).toContain('stop-opacity="0"'); expect(h[1]).toContain('offset="0.06"'); expect(h[1]).not.toContain("stop-opacity");
    expect(h[3]).toContain('offset="1"'); expect(h[3]).toContain('stop-opacity="0"');
    expect(v[1]).toContain('offset="0.12"');
    expect(svg).toMatch(/<g mask="url\(#card-mv\)"><g mask="url\(#card-mh\)"><rect/);
  });
  it("the garden: every layer drawn inside its own two masks, so the crop's hard edge never shows", () => {
    const { svg } = widgetGarden2(only({ mandarin: 6, store: 5 }), { stakes: true }, 206, 140);
    const inner = svg.split('<g mask="url(#g-mv)"><g mask="url(#g-mh)">')[1];
    expect(inner).toBeDefined();
    expect(svg.split("<use").length - 1).toBe(inner.split("<use").length - 1);
  });
});
