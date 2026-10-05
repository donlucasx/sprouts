import { describe, it, expect } from "vitest";
import { widgetGardenSvg, widgetGardenHeight, widgetView, WIDGET_SIGN_MIN_PX } from "@/model/widget-svg";
import { CANVAS } from "@/model/layout";
import { SPRITE_META } from "@/garden/sprite-meta";
import { buildScene, type GardenInput } from "@/model/garden";
import { plantLayouts } from "@/model/scene-to-layout";
const NOW = new Date("2026-10-08T12:00:00-07:00");
const base: GardenInput = { now: NOW, wateredAt: NOW, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200, allocation: { SKR: 50, stORE: 10, hSOL: 10, USDC_LEND: 10, SOL_LEND: 10, cbBTC: 10 }, earned: {}, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null };
const p = (id: string, d: number, asset: GardenInput["plantings"][number]["asset"] = "SKR") => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: 200 });
const oct8 = buildScene({ ...base, plantings: [p("a", 10.8), p("b", 8.4), p("c", 6), p("d", 3.6), p("e", 1.2), p("o", 9, "stORE"), p("o2", 2, "stORE"), p("h", 4, "hSOL"), p("j", 2, "USDC_LEND")] });
const year = buildScene({ ...base, plantings: Array.from({ length: 100 }, (_, i) => p(`y${i}`, 365 - i * 3.6, (["SKR", "SKR", "stORE", "hSOL", "USDC_LEND", "SOL_LEND", "cbBTC"] as const)[i % 7])) });
const uses = (svg: string) => [...svg.matchAll(/<use xlink:href="#s-([a-z0-9-]+)"/g)].map((m) => m[1]);
/** The highest painted point in a widget string, read off the string itself: every <use>'s box corners through its own transform
 * (translate, rotate, scale, translate by minus the anchor), every path coordinate, every circle's top; the ground excluded (it is the bed). */
function paintedTop(svg: string): number {
  let top = Infinity;
  for (const m of svg.matchAll(/<use xlink:href="#s-([a-z0-9-]+)" transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\) translate\(([-\d.]+) ([-\d.]+)\)"/g)) {
    const [, name, , ty, r, sx, sy, ax, ay] = m; if (name === "ground") continue;
    const box = SPRITE_META[name], a = (Number(r) * Math.PI) / 180;
    for (const [cx, cy] of [[0, 0], [box.w, 0], [0, box.h], [box.w, box.h]]) top = Math.min(top, Number(ty) + (cx + Number(ax)) * Number(sx) * Math.sin(a) + (cy + Number(ay)) * Number(sy) * Math.cos(a));
  }
  for (const m of svg.matchAll(/<path d="([^"]+)"/g)) for (const n of m[1].matchAll(/[-\d.]+ ([-\d.]+)/g)) top = Math.min(top, Number(n[1]));
  for (const m of svg.matchAll(/<circle cx="[-\d.]+" cy="([-\d.]+)" r="([-\d.]+)"/g)) top = Math.min(top, Number(m[1]) - Number(m[2]));
  return top;
}
const defs = (svg: string) => [...svg.matchAll(/<image id="s-([a-z0-9-]+)"/g)].map((m) => m[1]);

describe("R252: the widget draws the app's garden through a viewBox", () => {
  const box = (svg: string) => svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!.slice(1).map(Number);
  it("both rows on every size (the back row's spruce and sunflower drawn), each sprite declared once, the view ending at the bed's bottom", () => {
    for (const [w, h] of [[150, 120], [340, 160]] as const) {
      const svg = widgetGardenSvg(oct8, w, h);
      expect(uses(svg)).toContain("ground");
      expect(new Set(defs(svg)).size).toBe(defs(svg).length);
      for (const n of new Set(uses(svg))) expect(defs(svg)).toContain(n);
      const [, y, , vh] = box(svg); expect(y + vh).toBeCloseTo(CANVAS.height, 6);
    }
    expect(plantLayouts(oct8).some((p) => p.row === "back")).toBe(true);
  });
  it("stakes only where they read: none on a narrow widget, six on a wide one, each with its word", () => {
    const narrow = widgetGardenSvg(oct8, 150, 120), wide = widgetGardenSvg(oct8, 400, 170);
    expect(widgetView(oct8, 150, 120).signs).toBe(false); expect(uses(narrow)).not.toContain("sign");
    expect(widgetView(oct8, 400, 170).px).toBeGreaterThanOrEqual(WIDGET_SIGN_MIN_PX); expect(uses(wide).filter((n) => n === "sign")).toHaveLength(6);
    expect([...wide.matchAll(/<text /g)]).toHaveLength(6);   // oct8's six coins all hold a sign (the allocation)
  });
  it("a year's garden fits the view: no sprite anchor or stem end above the view's top", () => {
    for (const [w, h] of [[150, 120], [340, 160]] as const) { const svg = widgetGardenSvg(year, w, h), [, y] = box(svg); expect(paintedTop(svg)).toBeGreaterThanOrEqual(y - 0.5); }
  });
  it("the garden is as tall as its view at the widget's width, never more than the room", () => {
    for (const [w, room] of [[150, 300], [340, 120], [150, 40]] as const) {
      const h = widgetGardenHeight(oct8, w, room), v = widgetView(oct8, w, room);
      expect(h).toBeLessThanOrEqual(room); expect(h).toBeLessThanOrEqual(Math.round(v.h * v.px));
    }
  });
});
