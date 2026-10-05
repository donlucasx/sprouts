import { describe, it, expect } from "vitest";
import { FOOT_Y, PLANT_SCALE, frameFor, signPlacement, signX, stakeSpots } from "@/model/layout";
import { packScene } from "@/model/spread";
import { plantLayouts, type PlantOnStage } from "@/model/scene-to-layout";
import { buildScene, type GardenInput, type Scene } from "@/model/garden";
import { frameGround } from "@/model/soil-clip";
import { SPRITE_META } from "@/garden/sprite-meta";

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
  const plants = plantLayouts(scene), f = frameFor(scene, plants, width), spots = stakeSpots(scene, plants, width, f.zoom), ground = frameGround(width, f);
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
  it("where the row holds a clear spot the board takes it: both lending boards wholly clear at 372, USDC's at 353", () => {
    for (const [width, plants] of [[372, ["jitosol", "jupsol"]], [353, ["jitosol"]]] as const) for (const scene of SCENES(width).slice(0, 2)) {
      const { plants: pl, out } = boards(scene, width);
      const front = pl.filter((q) => q.row === "front").flatMap((q) => partBoxes(q, width));
      for (const b of out.filter((x) => (plants as readonly string[]).includes(x.plant))) expect(front.filter((q) => hit(q, b)), `${b.plant} at ${width}`).toEqual([]);
    }
  });
  it("at every width a back-row board is no more covered than at its R237 spot, and less in all", () => {
    for (const width of [280, 320, 353, 372]) for (const scene of SCENES(width)) {
      const { plants, out } = boards(scene, width);
      const front = plants.filter((pl) => pl.row === "front").flatMap((pl) => partBoxes(pl, width));
      for (const b of out.filter((x) => x.row === "back")) expect(covered(b, front), `${b.plant} at ${width}`).toBeLessThanOrEqual(covered(b.home, front) + 1e-6);
      const before = out.filter((x) => x.row === "back").reduce((t, b) => t + covered(b.home, front), 0), after = out.filter((x) => x.row === "back").reduce((t, b) => t + covered(b, front), 0);
      expect(after, `${width}`).toBeLessThan(before);
    }
  });
  it("the boards stay apart and inside the garden", () => {
    for (const width of [280, 320, 353, 372]) for (const scene of SCENES(width)) {
      const { out } = boards(scene, width);
      for (const b of out) { expect(b.x0).toBeGreaterThanOrEqual(0); expect(b.x1).toBeLessThanOrEqual(width); }
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(hit(out[i], out[j]), `${out[i].plant} and ${out[j].plant} at ${width}`).toBe(false);
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
