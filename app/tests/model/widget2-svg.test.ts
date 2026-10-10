import { describe, it, expect } from "vitest";
import { allStages, paintedBox, type Stages } from "@/model/garden2";
import { CANVAS } from "@/garden2/layout";
import { MIN_VIEW_W, VIEW_PAD, widget2Need, widgetGarden2 } from "@/model/widget2-svg";

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
  it("nothing planted: the bed, no stakes", () => {
    const { svg } = widgetGarden2(allStages(0), { stakes: true }, 300, 150);
    expect(svg).toContain('id="w-plate"'); expect(svg).not.toContain("<text");
  });
});
