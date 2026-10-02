import { describe, it, expect } from "vitest";
import { widgetGardenSvg, widgetScale, WIDGET_SOIL_BAND } from "@/model/widget-svg";
import { buildScene, type GardenInput } from "@/model/garden";
const NOW = new Date("2026-10-08T12:00:00-07:00");
const base: GardenInput = { now: NOW, wateredAt: NOW, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200, allocation: { SKR: 50, stORE: 10, hSOL: 10, JitoSOL: 10, JupSOL: 10, cbBTC: 10 }, earned: {}, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null };
const p = (id: string, d: number, asset: GardenInput["plantings"][number]["asset"] = "SKR") => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: 200 });
const oct8 = buildScene({ ...base, plantings: [p("a", 10.8), p("b", 8.4), p("c", 6), p("d", 3.6), p("e", 1.2), p("o", 9, "stORE"), p("o2", 2, "stORE"), p("h", 4, "hSOL"), p("j", 2, "JitoSOL")] });
const year = buildScene({ ...base, plantings: Array.from({ length: 100 }, (_, i) => p(`y${i}`, 365 - i * 3.6, (["SKR", "SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const)[i % 7])) });
const uses = (svg: string) => [...svg.matchAll(/<use xlink:href="#s-([a-z0-9-]+)"/g)].map((m) => m[1]);
const defs = (svg: string) => [...svg.matchAll(/<image id="s-([a-z0-9-]+)"/g)].map((m) => m[1]);

describe("the widget string (spec 5 and 8)", () => {
  it("the small widget (a 60 px garden on an 86 px widget, Widget.tsx:24) shows the young garden at k 0.4 or more, draws the front row only and no sign, and declares each sprite once (Review Focus 4)", () => {
    const svg = widgetGardenSvg(oct8, 150, 60, false);
    expect(widgetScale(oct8, 60, false)).toBeGreaterThanOrEqual(0.4);
    expect(widgetScale(oct8, 60, false)).toBeLessThanOrEqual(1);
    expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(uses(svg).some((u) => u.startsWith("sign-"))).toBe(false);
    expect(uses(svg).some((u) => u === "blade-snake-s1" || u.startsWith("leaf-sunflower"))).toBe(false);   // the back row is not drawn
    const d = defs(svg); expect(new Set(d).size).toBe(d.length); for (const u of new Set(uses(svg))) expect(d).toContain(u);
  });
  it("the wide widget draws both rows and the signs at a fixed 0.8, not scaled by k", () => {
    const svg = widgetGardenSvg(year, 300, 120, true);
    expect(uses(svg).filter((u) => u.startsWith("sign-"))).toHaveLength(6);
    expect(svg).toMatch(/<use xlink:href="#s-sign-skr" transform="translate\([\d.]+ [\d.]+\) rotate\(0\) scale\(0\.8 0\.8\)/);
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
});
