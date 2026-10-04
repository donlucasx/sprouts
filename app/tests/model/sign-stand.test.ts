import { describe, it, expect } from "vitest";
import { widgetGardenSvg, widgetView } from "@/model/widget-svg";
import { signPlacement, SIGN_FOOT, SIGN_SOIL_MARGIN, CANVAS } from "@/model/layout";
import { soilClipPath, soilBottomAt, appGround, frameGround, type GroundPlace } from "@/model/soil-clip";
import { SPRITE_META } from "@/garden/sprite-meta";
import { buildScene, type GardenInput } from "@/model/garden";

// R181 (RG32): every stake stands IN the soil: its post's foot inside the painted soil's outline, a few px above its bottom edge.
const NOW = new Date("2026-10-08T12:00:00-07:00");
const base: GardenInput = { now: NOW, wateredAt: NOW, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200, allocation: { SKR: 50, stORE: 10, hSOL: 10, JitoSOL: 10, JupSOL: 10, cbBTC: 10 }, earned: {}, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null };
const p = (id: string, d: number, asset: GardenInput["plantings"][number]["asset"] = "SKR") => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: 200 });
const oct8 = buildScene({ ...base, plantings: [p("a", 10.8), p("b", 8.4), p("c", 6), p("d", 3.6), p("e", 1.2), p("o", 9, "stORE"), p("o2", 2, "stORE"), p("h", 4, "hSOL"), p("j", 2, "JitoSOL")] });
const year = buildScene({ ...base, plantings: Array.from({ length: 100 }, (_, i) => p(`y${i}`, 365 - i * 3.6, (["SKR", "SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const)[i % 7])) });
const nums = (d: string) => [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
const inside = (pt: [number, number], poly: [number, number][]) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
const soilPoly = (g: GroundPlace) => nums(soilClipPath(g.x0, g.y0, g.sx, g.sy));
const footIn = (x: number, y: number, scale: number, g: GroundPlace) => {
  const fx = x + SIGN_FOOT.x * scale, fy = y + SIGN_FOOT.y * scale;
  expect(inside([fx, fy], soilPoly(g)), `foot (${fx.toFixed(1)}, ${fy.toFixed(1)}) inside the soil`).toBe(true);
  expect(soilBottomAt(fx, g) - fy, "a few px above the soil's bottom edge").toBeGreaterThanOrEqual(SIGN_SOIL_MARGIN - 0.06);   // the widget string rounds its transforms to 0.1 px
};

describe("R181: the stakes stand in the soil", () => {
  it("the soil's bottom edge is read off the outline (the lowest crossing at that x)", () => {
    const g = appGround(320), b = soilBottomAt(160, g);
    expect(b).toBeGreaterThan(CANVAS.soilLine + 40); expect(b).toBeLessThanOrEqual(CANVAS.height);
  });
  for (const [name, scene] of [["Oct 8", oct8], ["the year", year]] as const) {
    it(`${name}, the app at 320 and 353 wide: all six signs' feet in the soil`, () => {
      for (const width of [320, 353]) {
        const signs = scene.parts.filter((q) => q.kind === "sign"); expect(signs).toHaveLength(6);
        for (const s of signs) { const at = signPlacement(s, width); footIn(at.x, at.y, at.scale, appGround(width)); }
      }
    });
    it(`${name}, R252: on a widget with stakes (340 by 150, 400 by 170, 480 by 220, where they read): every sign's foot in the soil`, () => {
      for (const [w, h] of [[340, 150], [400, 170], [480, 220]] as const) {
        const v = widgetView(scene, w, h), svg = widgetGardenSvg(scene, w, h), g = frameGround(320, v);
        if (!v.signs) continue;
        const signs = [...svg.matchAll(/<use xlink:href="#s-sign" transform="translate\(([-\d.]+) ([-\d.]+)\) rotate\(0\) scale\(([\d.]+) [\d.]+\)/g)];
        expect(signs).toHaveLength(6);
        for (const m of signs) footIn(Number(m[1]), Number(m[2]), Number(m[3]), g);
      }
    });
  }
});
