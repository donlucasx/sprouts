import { describe, it, expect } from "vitest";
import { FOOT_Y, PLANT_SCALE, frameFor, signPlacement, signX, stakeSpots } from "@/model/layout";
import { packScene } from "@/model/spread";
import { plantLayouts, type PlantOnStage } from "@/model/scene-to-layout";
import { buildScene, type GardenInput, type Scene } from "@/model/garden";
import { frameGround } from "@/model/soil-clip";
import { SPRITE_META } from "@/garden/sprite-meta";
import { widgetGardenSvg } from "@/model/widget-svg";

// R356 (10-05, his words: "the USDC Kamino stake should not be over the SKR plant (its behind), so maybe nudge it around so its not
// covered by it? same with the SOL Jupiter stake.. should not be in front of the stORE"): depth stays true (a back-row stake draws
// behind the front plants), so each back-row stake moves along its row to where no front plant part covers its board.
const NOW = new Date("2026-10-08T12:00:00-07:00");
type Asset = GardenInput["plantings"][number]["asset"];
const p = (id: string, d: number, asset: Asset) => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: 300 });
const many = (asset: Asset, n: number, every: number) => Array.from({ length: n }, (_, i) => p(`${asset}${i}`, 1 + i * every, asset));
/** A grown garden like the demo: a wide SKR mandarin left and a full stORE succulent right in front, USDC and SOL lending behind. */
const GROWN: GardenInput = {
  now: NOW, wateredAt: NOW, picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n,
  pendingCents: 0, thresholdCents: 200, allocation: { SKR: 40, stORE: 20, USDC_LEND: 20, SOL_LEND: 20, hSOL: 0, cbBTC: 0 },
  earned: { SKR: { count: 6, progress: 0.5 }, stORE: { count: 4, progress: 0 }, SOL_LEND: { count: 3, progress: 0 }, USDC_LEND: { count: 2, progress: 0 } },
  storePutInRaw: 0n, joinedValueRaw: 0n, basket: null, lendSigns: { USDC_LEND: { line2: "Kamino 4.4%" }, SOL_LEND: { line2: "Jupiter 3.9%" } },
  plantings: [...many("SKR", 14, 2), ...many("stORE", 10, 3), ...many("USDC_LEND", 5, 4), ...many("SOL_LEND", 5, 4)],
};
type Box = { x0: number; x1: number; y0: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** Every drawn part's box (canvas px), still, at PLANT_SCALE about its foot: a sprite's rotated baked box, a stem's ends padded by its
 * half width. Computed here from the sprite manifest, not through layout.ts's own span code. */
function partBoxes(pl: PlantOnStage, width: number): Box[] {
  const fx = pl.x * width, fy = FOOT_Y(pl.row), at = (x: number, y: number) => [fx + x * PLANT_SCALE, fy + y * PLANT_SCALE] as const;
  return pl.layout.parts.flatMap((q) => {
    let pts: (readonly [number, number])[], pad = 0;
    if (q.kind === "stem") { pts = [at(q.x0, q.y0), at(q.x1, q.y1)]; pad = (Math.max(q.w0, q.w1) * PLANT_SCALE) / 2; }
    else {
      const m = SPRITE_META[q.name]; if (!m) return [];
      const r = (q.rot * Math.PI) / 180, sx = q.xScale ?? q.scale, sy = q.scale;
      pts = [[0, 0], [m.w, 0], [0, m.h], [m.w, m.h]].map(([u, v]) => { const lx = (u - m.ax) * sx, ly = (v - m.ay) * sy; return at(q.x + lx * Math.cos(r) - ly * Math.sin(r), q.y + lx * Math.sin(r) + ly * Math.cos(r)); });
    }
    const xs = pts.map((t) => t[0]), ys = pts.map((t) => t[1]);
    return [{ x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad }];
  });
}
function boards(scene: Scene, width: number) {
  const plants = plantLayouts(scene), f = frameFor(scene, plants, width), spots = stakeSpots(scene, plants, width, f.zoom, { lo: 0, hi: width }), ground = frameGround(width, f);
  const out = scene.parts.flatMap((q) => (q.kind === "sign" ? [q] : [])).map((s) => {
    const a = signPlacement(s, width, f.zoom, ground, spots), h = 15 * a.scale * a.boardX;
    const home = signX(s.x * width, s.side, width, a.scale, a.boardX);   // R237's spot, before any move
    return { plant: s.plant, row: s.row, x0: a.x - h, x1: a.x + h, y0: a.y - 12 * a.scale, y1: a.y - a.scale, home: { x0: home - h, x1: home + h, y0: a.y - 12 * a.scale, y1: a.y - a.scale } };
  });
  return { plants, out };
}
const SCENES = (width: number) => [buildScene(GROWN), packScene(buildScene(GROWN)), packScene(buildScene(GROWN), width)];

/** How much of a board's breadth front-plant boxes cover (the union of their x overlaps with it). */
function covered(b: Box, front: Box[]): number {
  const xs = front.filter((q) => hit(q, b)).map((q) => [Math.max(q.x0, b.x0), Math.min(q.x1, b.x1)] as const).sort((u, v) => u[0] - v[0]);
  let t = 0, end = -Infinity;
  for (const [l, h] of xs) { if (h > end) { t += h - Math.max(l, end); end = h; } }
  return t;
}

describe("back-row stakes stand where no front plant covers them (R356)", () => {
  it("where its own stretch of the row holds a clear spot the board takes it: USDC's at 353 and 372 (the unpacked garden)", () => {
    for (const [width, plants] of [[372, ["jitosol"]], [353, ["jitosol"]]] as const) for (const scene of SCENES(width).slice(0, 1)) {
      const { plants: pl, out } = boards(scene, width);
      const front = pl.filter((q) => q.row === "front").flatMap((q) => partBoxes(q, width));
      for (const b of out.filter((x) => (plants as readonly string[]).includes(x.plant))) expect(covered(b, front), `${b.plant} at ${width}`).toBeLessThanOrEqual(0.5);
    }
  });
  it("at every width a back-row board is no more covered than at its R237 spot, and less in all from 320 wide", () => {
    for (const width of [280, 320, 353, 372]) for (const scene of SCENES(width)) {
      const { plants, out } = boards(scene, width);
      const front = plants.filter((pl) => pl.row === "front").flatMap((pl) => partBoxes(pl, width));
      for (const b of out.filter((x) => x.row === "back")) expect(covered(b, front), `${b.plant} at ${width}`).toBeLessThanOrEqual(covered(b.home, front) + 1e-6);
      const before = out.filter((x) => x.row === "back").reduce((t, b) => t + covered(b.home, front), 0), after = out.filter((x) => x.row === "back").reduce((t, b) => t + covered(b, front), 0);
      expect(after, `${width}`).toBeLessThanOrEqual(before + 1e-6);
      // measured 10-05 after R357 (R237's spots: 86 to 96 px of the two boards by the box measure, which counts a whole baked box,
      // margins included): the boards, kept by their own plants, at most this much
      if (width >= 320) expect(after, `${width}`).toBeLessThanOrEqual(({ 320: 80, 353: 65, 372: 55 } as Record<number, number>)[width]);
    }
  });
  it("the boards stay apart and inside the garden", () => {
    for (const width of [280, 320, 353, 372]) for (const scene of SCENES(width)) {
      const { out } = boards(scene, width);
      for (const b of out) { expect(b.x0).toBeGreaterThanOrEqual(0); expect(b.x1).toBeLessThanOrEqual(width); }
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(hit(out[i], out[j]), `${out[i].plant} and ${out[j].plant} at ${width}`).toBe(false);
    }
  });
  it("depth stays true: the widget draws the back-row stakes before any front plant, the front stakes after them", () => {
    for (const width of [300, 340, 380]) {
      const svg = widgetGardenSvg(buildScene(GROWN), width, 260);
      const signs = [...svg.matchAll(/#s-sign"/g)].map((m) => m.index!), skrFruit = svg.indexOf("#s-token-skr"), lastFront = svg.lastIndexOf("#s-token-skr");
      expect(signs).toHaveLength(4);
      expect(skrFruit).toBeGreaterThan(0);
      expect(signs[1]).toBeLessThan(skrFruit);   // the two back-row boards (USDC, SOL) before the front row's mandarin
      expect(signs[2]).toBeGreaterThan(lastFront);   // SKR's and stORE's after it
    }
  });
  // R357 (10-05, his note on the Saga: "the USDC/kamino is legible but its too far from the plant and cant tell what it belongs to"): a
  // back-row stake stays by its own plant: its board's centre within 0.6 of a board's width past the plant's own drawn edge, either
  // side of its stem, and never past the nearest other back-row stem.
  it("every back-row sign stays by its own plant (R357)", () => {
    const SIX: GardenInput = { ...GROWN, allocation: { SKR: 20, stORE: 20, USDC_LEND: 15, SOL_LEND: 15, hSOL: 15, cbBTC: 15 },
      plantings: [...GROWN.plantings, ...many("hSOL", 6, 4), ...many("cbBTC", 6, 4)] };
    for (const width of [280, 320, 353, 372]) for (const scene of [...SCENES(width), buildScene(SIX), packScene(buildScene(SIX))]) {
      const { plants, out } = boards(scene, width);
      const backFeet = out.filter((b) => b.row === "back").map((b) => ({ plant: b.plant, x: scene.parts.flatMap((q) => (q.kind === "sign" && q.plant === b.plant ? [q.x * width] : []))[0] }));
      for (const b of out.filter((x) => x.row === "back")) {
        const foot = backFeet.find((f) => f.plant === b.plant)!.x, own = plants.find((pl) => pl.plant === b.plant);
        const parts = own ? partBoxes(own, width) : [], left = Math.min(foot, ...parts.map((q) => q.x0)), right = Math.max(foot, ...parts.map((q) => q.x1));
        const c = (b.x0 + b.x1) / 2, reach = 0.6 * (b.x1 - b.x0), tag = `${b.plant} at ${width}`;
        expect(c, tag).toBeGreaterThanOrEqual(left - reach - 1e-6);
        expect(c, tag).toBeLessThanOrEqual(right + reach + 1e-6);
        for (const f of backFeet) if (f.plant !== b.plant) expect(Math.sign(c - f.x), `${tag} past ${f.plant}`).toBe(Math.sign(foot - f.x));
      }
    }
  });
  // KNOWN (R356, measured 10-05): at 280 and 320 the widest stretch of the back row no front part's box crosses, at the boards' height,
  // is 14 to 32 px; a lending board is 48 to 52 px. No x holds both boards, or even one, wholly clear by the box measure, so they take
  // the least covered. it.fails records it; a smaller board or a higher one (a ruling) turns it red.
  it.fails("KNOWN: at 280 and 320 no back-row board is wholly clear of the front plants' boxes", () => {
    for (const width of [280, 320]) {
      const { plants, out } = boards(SCENES(width)[0], width);
      const front = plants.filter((pl) => pl.row === "front").flatMap((pl) => partBoxes(pl, width));
      for (const b of out.filter((x) => x.row === "back")) expect(covered(b, front)).toBe(0);
    }
  });
});
