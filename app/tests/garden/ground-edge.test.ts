import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { SPRITE_META } from "@/garden/sprite-meta";
import { CANVAS, frameFor } from "@/model/layout";
import { plantLayouts } from "@/model/scene-to-layout";
import { previewInputAt } from "@/model/fixtures/median-year";
import { buildScene } from "@/model/garden";

// Round 3, item 9 (10-02): "the bottom of the soil is cropped- not irregular like we stipulated". RG28: dried washes in a vignette
// that does NOT fill the canvas, so the ground's bottom edge is painted and irregular, with paper under it, and the view shows it.
const png = PNG.sync.read(readFileSync("assets/garden/ground@3x.png"));
const alpha = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
const opaqueShare = (y: number) => { let n = 0; for (let x = 0; x < png.width; x++) if (alpha(x, y) > 20) n++; return n / png.width; };
/** The lowest row (3x px) where the wash still reads (alpha over 128) in column x. */
const lowestPainted = (x: number) => { for (let y = png.height - 1; y >= 0; y--) if (alpha(x, y) > 128) return y; return -1; };

describe("the ground's bottom edge (RG28, round 3 item 9)", () => {
  it("is not cut by the bake: the last rows are paper (under 5 percent opaque)", () => {
    for (let y = png.height - 3; y < png.height; y++) expect(opaqueShare(y)).toBeLessThan(0.05);
  });
  it("is irregular: its lowest painted row varies across the width by at least 2 px at 1x, with at least 3 px of paper under it", () => {
    const lows = Array.from({ length: 40 }, (_, i) => lowestPainted(Math.round(((i + 0.5) / 40) * (png.width - 1)))).filter((y) => y >= 0);
    expect((Math.max(...lows) - Math.min(...lows)) / 3).toBeGreaterThanOrEqual(2);
    expect((png.height - 1 - Math.max(...lows)) / 3).toBeGreaterThanOrEqual(3);
  });
  it.each([1, 30, 120, 240, 365])("day %i: the view holds the whole ground sprite, its painted bottom and the paper under it", (day) => {
    const s = buildScene(previewInputAt(day)), f = frameFor(s, plantLayouts(s), 320), g = SPRITE_META["ground"];
    expect(f.y + f.h).toBeCloseTo(CANVAS.height, 9);   // the view's bottom is the bed's bottom, where the sprite's bottom sits (parts.tsx Soil)
    expect(f.y).toBeLessThanOrEqual(CANVAS.height - g.h + 1e-9);   // and its top is at or above the sprite's top
  });
});
