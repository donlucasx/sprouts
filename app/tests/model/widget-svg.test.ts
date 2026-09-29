import { describe, it, expect } from "vitest";
import { widgetGardenSvg, WIDGET_SOIL_BAND } from "@/model/widget-svg";
import { soilSurface } from "@/model/soil";
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

  it("roots a sprout at the mound's surface", () => {
    const svg = widgetGardenSvg(scene([{ kind: "sprout", id: "p1", plant: "skr", x: 0.5, y: 0, stage: 2, bud: false, sizeRaw: 1n }]), 300, 140);
    const m = svg.match(/<path d="M150 ([\d.]+) q/);
    expect(Number(m![1])).toBeCloseTo(140 - WIDGET_SOIL_BAND + soilSurface(0.5) / 2, 5);
  });
});
