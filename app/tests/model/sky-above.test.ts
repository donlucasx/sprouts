import { describe, it, expect } from "vitest";
import { CANVAS, FOOT_Y, HEADROOM, MAX_VIEW_H, PLANT_SCALE, frameFor, skyAbove, valuePull } from "@/model/layout";
import { plantLayouts } from "@/model/scene-to-layout";
import { buildScene, type GardenInput } from "@/model/garden";

// R357 (10-05, "tighten the gap above the garden by another half"): Home pulls the garden up under the value block only as far as the
// garden's own empty paper allows, so a tall garden (its headroom given way to MAX_VIEW_H) never pushes a leaf into the block.
const NOW = new Date("2026-10-08T12:00:00-07:00");
type Asset = GardenInput["plantings"][number]["asset"];
const many = (asset: Asset, n: number, every: number) => Array.from({ length: n }, (_, i) => ({ id: `${asset}${i}`, ts: new Date(NOW.getTime() - (1 + i * every) * 864e5), asset, amountOutRaw: 1n, usdcInCents: 300 }));
const g = (plantings: GardenInput["plantings"]): GardenInput => ({ now: NOW, wateredAt: NOW, picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200, allocation: { SKR: 50, stORE: 50, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 }, earned: {}, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null, plantings });

describe("skyAbove and valuePull (R357)", () => {
  it("skyAbove is the view px of paper over the tallest drawn part", () => {
    const scene = buildScene(g(many("SKR", 3, 2))), plants = plantLayouts(scene), f = frameFor(scene, plants, 320);
    const top = Math.min(...plants.map((p) => FOOT_Y(p.row) - p.layout.top * PLANT_SCALE));
    expect(skyAbove(plants, f)).toBeCloseTo(Math.max(0, (top - f.y) * f.zoom), 9);
    expect(skyAbove([], { y: CANVAS.height - 100, zoom: 1 })).toBe(100);
  });
  it("valuePull: the screen's gap plus the sky past SKY_KEEP, at most the gap plus 40", () => {
    expect(valuePull(200)).toBe(16 + 40);
    expect(valuePull(32 + 10)).toBe(16 + 10);
    expect(valuePull(20)).toBe(16);
    expect(valuePull(0)).toBe(16);
  });
  it("in a young and a tall garden the pulled garden's tallest part stays at least 32 view px under the block", () => {
    for (const plantings of [many("SKR", 2, 1), [...many("SKR", 20, 2), ...many("stORE", 12, 3)]]) {
      const scene = buildScene(g(plantings)), plants = plantLayouts(scene), f = frameFor(scene, plants, 320);
      const sky = skyAbove(plants, f), overlap = valuePull(sky) - 16;
      expect(sky - overlap).toBeGreaterThanOrEqual(Math.min(32, sky) - 1e-9);
      expect(f.viewH).toBeLessThanOrEqual(MAX_VIEW_H);
      expect(HEADROOM.minPx).toBe(72);
    }
  });
});
