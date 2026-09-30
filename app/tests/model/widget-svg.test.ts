import { describe, it, expect } from "vitest";
import { widgetGardenSvg, WIDGET_SOIL_BAND } from "@/model/widget-svg";
import { soilSurface } from "@/model/soil";
import { MAX_RISE, nodeRise } from "@/model/plant-geometry";
import type { Scene } from "@/model/garden";

// The 09-29 Saga check: the widget drew a fixed 90-high garden with no seeds in a much taller widget, and its parts stood on a
// flat line above the mound. The garden now fills the height it is given and every part stands on the mound.
const scene = (parts: Scene["parts"]): Scene => ({ parts: [{ kind: "soil" }, ...parts], unrevealed: 0, wateredToday: false });
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
});
