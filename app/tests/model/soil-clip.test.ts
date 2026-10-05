import { describe, it, expect } from "vitest";
import { widgetGardenSvg, widgetView } from "@/model/widget-svg";
import { frameGround } from "@/model/soil-clip";
import { soilClipPath, SOIL_CLIP_ID } from "@/model/soil-clip";
import { SPRITE_META, GROUND_OUTLINE } from "@/garden/sprite-meta";
import { buildScene, type GardenInput } from "@/model/garden";
const NOW = new Date("2026-10-08T12:00:00-07:00");
const base: GardenInput = { now: NOW, wateredAt: NOW, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200, allocation: { SKR: 50, stORE: 10, hSOL: 10, USDC_LEND: 10, SOL_LEND: 10, cbBTC: 10 }, earned: {}, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null };
const pl = (id: string, d: number, asset: GardenInput["plantings"][number]["asset"]) => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: 200 });
const scene = buildScene({ ...base, plantings: [pl("a", 3, "SKR"), pl("o", 2, "stORE"), pl("c", 2, "cbBTC"), pl("h", 2, "hSOL")] });
const nums = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
const inside = (pt: [number, number], poly: [number, number][]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };

describe("R176: no soil, no water", () => {
  it("every ring <use> in the widget string sits inside a group clipped to the soil, and the clip is declared once in <defs>", () => {
    for (const [w, h, wide] of [[150, 60, false], [300, 120, true]] as const) {
      const svg = widgetGardenSvg(scene, w, h); void wide;
      const rings = [...svg.matchAll(/<use xlink:href="#s-ring"/g)]; expect(rings.length).toBeGreaterThan(0);
      expect([...svg.matchAll(/<g clip-path="url\(#soil\)"><g opacity="[\d.]+"><use xlink:href="#s-ring"/g)]).toHaveLength(rings.length);
      expect(SOIL_CLIP_ID).toBe("soil");
      expect([...svg.matchAll(/<clipPath id="soil">/g)]).toHaveLength(1); expect(svg.indexOf("<clipPath")).toBeLessThan(svg.indexOf("</defs>"));
    }
  });
  it("a garden with no ring declares no clip", () => {
    expect(widgetGardenSvg(buildScene({ ...base, wateredAt: null, plantings: [pl("a", 3, "SKR")] }), 150, 60)).not.toContain("clipPath");
  });
  it("R252: the clip polygon is the ground sprite's outline placed as the widget's ground is (spanning the view, R238), inside the view's width", () => {
    const w = 150, h = 120, svg = widgetGardenSvg(scene, w, h), v = widgetView(scene, w, h), g = frameGround(320, v);
    expect(svg.match(/<clipPath id="soil"><path d="([^"]+)"/)![1]).toBe(soilClipPath(g.x0, g.y0, g.sx, g.sy));
    for (const [x] of nums(soilClipPath(g.x0, g.y0, g.sx, g.sy))) { expect(x).toBeGreaterThanOrEqual(v.x - 0.01); expect(x).toBeLessThanOrEqual(v.x + v.w + 0.01); }
  });
  it("the app's clip is the same outline placed as the ground is: x scaled by width / 320, its top at soilY + 60 - the sprite's height", () => {
    const d = soilClipPath(0, 200 + 60 - SPRITE_META["ground"].h, 340 / 320, 1), p = nums(d);
    expect(p).toHaveLength(GROUND_OUTLINE.length); expect(d.endsWith("Z")).toBe(true);
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    expect(Math.max(...xs)).toBeLessThanOrEqual(340); expect(Math.min(...xs)).toBeGreaterThanOrEqual(0); expect(Math.max(...ys)).toBeLessThanOrEqual(260); expect(Math.min(...ys)).toBeGreaterThanOrEqual(200 + 60 - 86);
  });
});
