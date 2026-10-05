import { describe, it, expect } from "vitest";
import { FOOT_Y, PLANT_SCALE, SIGN_GAP, STAKE_WALK, frameFor, signPlacement, stakeSpots } from "@/model/layout";
import { packScene } from "@/model/spread";
import { gapScene } from "@/model/gaps";
import { plantLayouts, type PlantOnStage } from "@/model/scene-to-layout";
import { buildScene, type GardenInput, type Scene } from "@/model/garden";
import { frameGround } from "@/model/soil-clip";
import { widgetGardenSvg } from "@/model/widget-svg";
import { SPRITE_META } from "@/garden/sprite-meta";

// R357 (10-05, his ruling "Back plants move to the gaps"): a back-row plant and its sign slide together into open space between the
// front canopies, so both are seen and seen together; a back plant never stands straight behind a front one.
const NOW = new Date("2026-10-08T12:00:00-07:00");
type Asset = GardenInput["plantings"][number]["asset"];
const p = (id: string, d: number, asset: Asset) => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: 300 });
const many = (asset: Asset, n: number, every: number) => Array.from({ length: n }, (_, i) => p(`${asset}${i}`, 1 + i * every, asset));
const LEND = { USDC_LEND: { line2: "Kamino 4.4%" }, SOL_LEND: { line2: "Jupiter 3.9%" } };
const base = (plantings: GardenInput["plantings"], allocation: GardenInput["allocation"] = { SKR: 40, stORE: 20, USDC_LEND: 20, SOL_LEND: 20, hSOL: 0, cbBTC: 0 }): GardenInput => ({
  now: NOW, wateredAt: NOW, picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200,
  allocation, earned: { SKR: { count: 6, progress: 0.5 }, stORE: { count: 4, progress: 0 } }, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null, lendSigns: LEND, plantings,
});
/** The demo's shape: a wide SKR mandarin left, a full stORE succulent right, USDC and SOL lending behind. */
const grown = (skr = 14, store = 10) => base([...many("SKR", skr, 2), ...many("stORE", store, 3), ...many("USDC_LEND", 5, 4), ...many("SOL_LEND", 5, 4)]);
const WIDTHS = [280, 320, 353, 372];

type Box = { x0: number; x1: number; y0: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
/** Each part's still box, from the sprite manifest (not gaps.ts's own). */
function boxes(pl: PlantOnStage, width: number): Box[] {
  const fx = pl.x * width, fy = FOOT_Y(pl.row), at = (x: number, y: number) => [fx + x * PLANT_SCALE, fy + y * PLANT_SCALE] as const;
  return pl.layout.parts.flatMap((q) => {
    let pts: (readonly [number, number])[], pad = 0;
    if (q.kind === "stem") { pts = [at(q.x0, q.y0), at(q.x1, q.y1)]; pad = (Math.max(q.w0, q.w1) * PLANT_SCALE) / 2; }
    else { const m = SPRITE_META[q.name]; if (!m) return []; const r = (q.rot * Math.PI) / 180, sx = q.xScale ?? q.scale, sy = q.scale;
      pts = [[0, 0], [m.w, 0], [0, m.h], [m.w, m.h]].map(([u, v]) => { const lx = (u - m.ax) * sx, ly = (v - m.ay) * sy; return at(q.x + lx * Math.cos(r) - ly * Math.sin(r), q.y + lx * Math.sin(r) + ly * Math.cos(r)); }); }
    const xs = pts.map((t) => t[0]), ys = pts.map((t) => t[1]);
    return [{ x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad }];
  });
}
/** The garden as Garden.tsx draws it at `width`: packed, moved into the gaps, framed, its stakes placed. */
function drawn(input: GardenInput, width: number) {
  const scene: Scene = gapScene(packScene(buildScene(input)), width), plants = plantLayouts(scene), f = frameFor(scene, plants, width);
  const spots = stakeSpots(scene, plants, width, f.zoom), ground = frameGround(width, f);
  const signs = scene.parts.flatMap((q) => (q.kind === "sign" ? [q] : [])).map((s) => {
    const a = signPlacement(s, width, f.zoom, ground, spots), h = 15 * a.scale * a.boardX;
    return { plant: s.plant, row: s.row, foot: s.x * width, h, scale: a.scale, board: { x0: a.x - h, x1: a.x + h, y0: a.y - 12 * a.scale, y1: a.y - a.scale } };
  });
  return { scene, plants, f, signs, front: plants.filter((pl) => pl.row === "front").flatMap((pl) => boxes(pl, width)) };
}

describe("back plants move to the gaps (R357)", () => {
  it("at 372 no front part covers a back sign board in the grown SKR + stORE + USDC + SOL garden", () => {
    for (const width of [372]) {
      const d = drawn(grown(), width);
      for (const s of d.signs.filter((x) => x.row === "back")) expect(d.front.filter((q) => hit(q, s.board)), `${s.plant} at ${width}`).toEqual([]);
    }
  });
  it("each back sign stands at its plant's offset (beside its own stem; R326's reach at most)", () => {
    for (const width of WIDTHS) for (const input of [grown(), grown(8, 6), grown(20, 14)]) {
      const d = drawn(input, width);
      for (const s of d.signs.filter((x) => x.row === "back")) {
        const c = (s.board.x0 + s.board.x1) / 2;
        expect(Math.abs(c - s.foot), `${s.plant} at ${width}`).toBeLessThanOrEqual(s.h + SIGN_GAP + STAKE_WALK / d.f.zoom + 1e-6);
      }
    }
  });
  it("back plants stay apart: stems at least 14 px apart, no board over another back stem or board", () => {
    for (const width of WIDTHS) for (const input of [grown(), grown(8, 6), grown(20, 14)]) {
      const back = drawn(input, width).signs.filter((x) => x.row === "back");
      for (const a of back) for (const b of back) if (a !== b) {
        expect(Math.abs(a.foot - b.foot), `${a.plant}/${b.plant} at ${width}`).toBeGreaterThanOrEqual(14 - 1e-6);
        expect(a.board.x0 < b.foot + 3 && a.board.x1 > b.foot - 3, `${a.plant} board over ${b.plant} stem at ${width}`).toBe(false);
        expect(hit(a.board, b.board), `${a.plant}/${b.plant} boards at ${width}`).toBe(false);
      }
    }
  });
  it("the words are less covered than at the locked slots at every width, and the garden keeps at least 0.85 of its zoom", () => {
    for (const width of WIDTHS) {
      const moved = drawn(grown(), width);
      const scene0 = packScene(buildScene(grown())), pl0 = plantLayouts(scene0), f0 = frameFor(scene0, pl0, width), spots0 = stakeSpots(scene0, pl0, width, f0.zoom), g0 = frameGround(width, f0);
      const front0 = pl0.filter((pl) => pl.row === "front").flatMap((pl) => boxes(pl, width));
      const cover = (b: Box, fr: Box[]) => fr.filter((q) => hit(q, b)).reduce((t, q) => t + Math.min(q.x1, b.x1) - Math.max(q.x0, b.x0), 0);
      const before = scene0.parts.flatMap((q) => (q.kind === "sign" && q.row === "back" ? [q] : [])).reduce((t, s) => { const a = signPlacement(s, width, f0.zoom, g0, spots0), h = 15 * a.scale * a.boardX; return t + cover({ x0: a.x - h, x1: a.x + h, y0: a.y - 12 * a.scale, y1: a.y - a.scale }, front0); }, 0);
      const after = moved.signs.filter((x) => x.row === "back").reduce((t, s) => t + cover(s.board, moved.front), 0);
      if (width >= 320) expect(after, `${width}`).toBeLessThan(before); else expect(after, `${width}`).toBeLessThanOrEqual(before + 1e-6);
      expect(moved.f.zoom, `${width}`).toBeGreaterThanOrEqual(0.85 * f0.zoom - 1e-6);   // GAP_ZOOM: the zoom-out is capped
    }
  });
  it("stable as the garden grows: stepping SKR 4 to 20 plantings, each back plant changes gap (which front stems it stands between) at most twice", () => {
    for (const width of [280, 320, 372]) {
      const gaps = new Map<string, number[]>();
      for (let n = 4; n <= 20; n++) {
        const d = drawn(grown(n, Math.round(n * 0.7)), width), fronts = d.plants.filter((pl) => pl.row === "front").map((pl) => pl.x * width);
        for (const s of d.signs.filter((x) => x.row === "back")) gaps.set(s.plant, [...(gaps.get(s.plant) ?? []), fronts.filter((f) => f < s.foot).length]);
      }
      for (const [plant, seq] of gaps) expect(seq.slice(1).filter((g, i) => g !== seq[i]).length, `${plant} at ${width}: ${seq.join("")}`).toBeLessThanOrEqual(2);
    }
  });
  it("depth stays true: the widget draws the back stakes before the front plants, the front stakes after", () => {
    const svg = widgetGardenSvg(buildScene(grown()), 340, 260), signs = [...svg.matchAll(/#s-sign"/g)].map((m) => m.index!);
    expect(signs).toHaveLength(4);
    expect(signs[1]).toBeLessThan(svg.indexOf("#s-token-skr"));
    expect(signs[2]).toBeGreaterThan(svg.lastIndexOf("#s-token-skr"));
  });
});
