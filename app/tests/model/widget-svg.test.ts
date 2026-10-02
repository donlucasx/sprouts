import { describe, it, expect } from "vitest";
import { widgetGardenSvg, widgetGardenHeight, widgetScale, WIDGET_SOIL_BAND } from "@/model/widget-svg";
import { SPRITE_META } from "@/garden/sprite-meta";
import { buildScene, type GardenInput } from "@/model/garden";
const NOW = new Date("2026-10-08T12:00:00-07:00");
const base: GardenInput = { now: NOW, wateredAt: NOW, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200, allocation: { SKR: 50, stORE: 10, hSOL: 10, JitoSOL: 10, JupSOL: 10, cbBTC: 10 }, earned: {}, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null };
const p = (id: string, d: number, asset: GardenInput["plantings"][number]["asset"] = "SKR") => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: 200 });
const oct8 = buildScene({ ...base, plantings: [p("a", 10.8), p("b", 8.4), p("c", 6), p("d", 3.6), p("e", 1.2), p("o", 9, "stORE"), p("o2", 2, "stORE"), p("h", 4, "hSOL"), p("j", 2, "JitoSOL")] });
const year = buildScene({ ...base, plantings: Array.from({ length: 100 }, (_, i) => p(`y${i}`, 365 - i * 3.6, (["SKR", "SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const)[i % 7])) });
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

describe("the widget string (spec 5 and 8)", () => {
  it("the small widget (a 60 px garden on an 86 px widget, Widget.tsx:24) shows the young garden at k 0.4 or more, draws the front row only and no sign, and declares each sprite once (Review Focus 4)", () => {
    const svg = widgetGardenSvg(oct8, 150, 60, false);
    expect(widgetScale(oct8, 60, false)).toBeGreaterThanOrEqual(0.4);
    expect(widgetScale(oct8, 60, false)).toBeLessThanOrEqual(1);
    expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(uses(svg).some((u) => u.startsWith("sign"))).toBe(false); expect(svg).not.toContain("<text");
    expect(uses(svg).some((u) => u === "blade-snake-s1" || u.startsWith("leaf-sunflower"))).toBe(false);   // the back row is not drawn
    const d = defs(svg); expect(new Set(d).size).toBe(d.length); for (const u of new Set(uses(svg))) expect(d).toContain(u);
  });
  it("the wide widget draws both rows and the signs at a fixed 0.8, not scaled by k", () => {
    const svg = widgetGardenSvg(year, 300, 120, true);
    expect(uses(svg).filter((u) => u === "sign")).toHaveLength(6);   // R168: one blank board, declared once
    expect(svg).toMatch(/<use xlink:href="#s-sign" transform="translate\([\d.]+ [\d.]+\) rotate\(0\) scale\(0\.8 0\.8\)/);
    // the word as vector text in a plain sans-serif, dark ink, on the board's lean at the fixed 0.8, each right after its board
    const words = [...svg.matchAll(/<use xlink:href="#s-sign" transform="translate\(([\d.]+) ([\d.]+)\)[^>]*\/><g transform="translate\(([\d.]+) ([\d.]+)\) scale\(0\.8\) rotate\(-4\)"><text x="0" y="-4\.1" text-anchor="middle" font-family="sans-serif" font-size="6\.8" font-weight="500" fill="#2B2622">([A-Za-z]+)<\/text><\/g>/g)];
    expect(words.map((w) => w[5]).sort()).toEqual(["JitoSOL", "JupSOL", "SKR", "cbBTC", "hSOL", "stORE"]);
    for (const w of words) { expect(w[3]).toBe(w[1]); expect(w[4]).toBe(w[2]); }
    expect(widgetScale(year, 120, true)).toBeLessThan(0.6);
  });
  it("a year's garden fits: no sprite anchor or stem end above the top edge, every stem a path", () => {
    const svg = widgetGardenSvg(year, 300, 90, true);
    const ys = [...svg.matchAll(/transform="translate\([\d.-]+ ([\d.-]+)\)/g)].map((m) => Number(m[1]));   // the placement's own translate, never spriteTransform's trailing translate(-ax -ay)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(4);   // a leaf anchored at its base reaches up to its length; the k rule leaves 6 px
    const stemYs = [...svg.matchAll(/<path d="M[\d.-]+ ([\d.-]+) Q [\d.-]+ ([\d.-]+)/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...stemYs)).toBeGreaterThanOrEqual(0);
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(50);
  });
  it("fills the height it is given and keeps the 30 px soil band", () => {
    expect(widgetGardenSvg(buildScene(base), 300, 140, true)).toContain('height="140" viewBox="0 0 300 140"');
    expect(WIDGET_SOIL_BAND).toBe(30);
  });
  it.each([[150, 86, false], [300, 120, true]] as const)("R167: at %i by %i (wide %s) the Oct 8 garden leaves under 20 percent of the garden empty above its tallest part, and nothing crops", (w, maxH, wide) => {
    const h = widgetGardenHeight(oct8, maxH, wide), svg = widgetGardenSvg(oct8, w, h, wide), top = paintedTop(svg);
    expect(h).toBeLessThanOrEqual(maxH); expect(svg).toContain(`height="${h}" viewBox="0 0 ${w} ${h}"`);
    expect(top).toBeGreaterThanOrEqual(0); expect(top / h).toBeLessThan(0.2);   // measured 10-02: 2.7 of 86 and 2.6 of 92 (before: 24.8 of 86, 30.6 of 120)
    expect(widgetScale(oct8, h, wide)).toBeCloseTo(widgetScale(oct8, maxH, wide), 9);   // the plants are as large as the full height draws them
  });
  it("R167: a garden of seeds keeps the soil band plus 40, never a sliver", () => {
    expect(widgetGardenHeight(buildScene({ ...base, pendingCents: 80, nextAsset: "SKR" }), 120, true)).toBe(WIDGET_SOIL_BAND + 40);
  });
});
