import { describe, it, expect } from "vitest";
import { widgetGardenSvg, WIDGET_SOIL_BAND } from "@/model/widget-svg";
import { soilSurface } from "@/model/soil";
import { MAX_RISE, nodeRise } from "@/model/plant-geometry";
import { buildScene, type GardenInput, type Scene } from "@/model/garden";
import type { Asset } from "@/lib/coins";

const NOW = new Date("2026-10-04T12:00:00-07:00");
const base: GardenInput = {
  now: NOW, wateredAt: null, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrFruit: 0, skrNextFruitProgress: 0,
  skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200,
  storePutInRaw: 0n, storePups: 0, storeNextPupProgress: 0, joinedValueRaw: 0n, basket: null,
};
const planting = (id: string, daysAgo: number, raw: bigint, asset: Asset = "SKR") => ({ id, ts: new Date(NOW.getTime() - daysAgo * 86_400_000), asset, amountOutRaw: raw });

// The 09-29 Saga check: the widget drew a fixed 90-high garden with no seeds in a much taller widget, and its parts stood on a
// flat line above the mound. The garden now fills the height it is given and every part stands on the mound.
const scene = (parts: Scene["parts"]): Scene => ({ parts: [{ kind: "soil" }, ...parts], unrevealed: 0, canReady: false });
const circles = (svg: string) => [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

describe("widgetGardenSvg", () => {
  it("fills the height it is given", () => {
    expect(widgetGardenSvg(scene([]), 300, 140)).toContain('height="140" viewBox="0 0 300 140"');
  });

  it("draws a seed for each seed part, resting on the mound", () => {
    const svg = widgetGardenSvg(scene([{ kind: "seed", id: "seed0", x: 0.15 }, { kind: "seed", id: "seed1", x: 0.24 }]), 300, 140);
    const seeds = circles(svg);
    expect(seeds).toHaveLength(2);
    const line = 140 - WIDGET_SOIL_BAND;
    seeds.forEach((s, i) => {
      const surface = line + soilSurface([0.15, 0.24][i]) / 2;
      expect(s.y).toBeGreaterThan(surface);       // in the soil, not above it
      expect(s.y).toBeLessThan(surface + 5);
    });
  });

  // R89: one plant per coin; the stem roots on the mound and the plantings are shoots up it.
  const plant = { kind: "plant" as const, plant: "skr" as const, x: 0.4, shoots: 2 };
  const shoot = (id: string, y: number) => ({ kind: "sprout" as const, id, plant: "skr" as const, x: 0.4, y, stage: 2 as const, bud: false, sizeRaw: 1n });
  const k = Math.min(1, (140 - WIDGET_SOIL_BAND - 6) / MAX_RISE);
  const foot = 140 - WIDGET_SOIL_BAND + soilSurface(0.4) / 2;

  it("roots the plant's stem on the mound", () => {
    const svg = widgetGardenSvg(scene([plant, shoot("a", 0), shoot("b", 1)]), 300, 140);
    const m = svg.match(/<path d="M120 ([\d.]+) q/);
    expect(Number(m![1])).toBeCloseTo(foot, 1);
  });

  it("draws one leaf per planting up the one stem", () => {
    const svg = widgetGardenSvg(scene([plant, shoot("a", 0), shoot("b", 1)]), 300, 140);
    expect([...svg.matchAll(/<ellipse /g)].length).toBe(2);
    expect([...svg.matchAll(/stroke="#3F7A4A"/g)].length).toBe(1);
  });

  it("hangs a fruit beside the shoot it names", () => {
    const svg = widgetGardenSvg(scene([plant, shoot("a", 0), shoot("b", 1), { kind: "fruit", index: 0, plant: "skr", ripe: true, bud: false, on: "a" }]), 300, 140);
    const [fruit] = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="3" fill="#C9553D"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const nodeY = foot - nodeRise(0, 2) * k;
    expect(fruit.x).toBeCloseTo(120 + 6, 1);   // slot 0's leaf is on the left, so the fruit hangs right
    expect(fruit.y).toBeCloseTo(nodeY + 4, 1);
  });

  // Review Focus 4: six plants fit the widget's narrowest size without overlapping stems (Ruling P3: the stems are paths, read by data-plant).
  it("draws one stem per plant for six plants inside 160 px, each at its own x", () => {
    const scene = buildScene({
      ...base, wateredAt: NOW,
      plantings: [planting("a", 5, 1n, "SKR"), planting("b", 4, 1n, "stORE"), planting("c", 3, 1n, "hSOL"), planting("d", 2, 1n, "JitoSOL"), planting("e", 1, 1n, "JupSOL"), planting("f", 1, 1n, "cbBTC")],
    });
    const svg = widgetGardenSvg(scene, 160, 90);
    const stems = svg.match(/<path[^>]*data-plant="[a-z]+"/g) ?? [];
    expect(stems.length).toBe(6);
    const xs = stems.map((s) => Number(/d="M([\d.]+)/.exec(s)?.[1]));
    expect(new Set(xs.map((x) => Math.round(x))).size).toBe(6);
    expect(Math.min(...xs)).toBeGreaterThan(8);
    expect(Math.max(...xs)).toBeLessThan(152);
  });
});
