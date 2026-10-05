import { describe, it, expect } from "vitest";
import { DRAW_ORDER, frameFor, signPlacement, stakeSpots } from "@/model/layout";
import { packScene } from "@/model/spread";
import { plantLayouts } from "@/model/scene-to-layout";
import { buildScene, type GardenInput } from "@/model/garden";
import { frameGround } from "@/model/soil-clip";
import { widgetGardenSvg } from "@/model/widget-svg";

// R355 (10-05, his eye: "the USDC plant is hidden behind the SKR tree"): every stake's board is drawn above every plant, front and back
// rows alike, so a grown front plant (the SKR mandarin, the stORE succulent) never hides a back-row lending sign's words.
const NOW = new Date("2026-10-08T12:00:00-07:00");
const LEND = { USDC_LEND: { line2: "Kamino 4.4%" }, SOL_LEND: { line2: "Jupiter 3.9%" } };
type Asset = GardenInput["plantings"][number]["asset"];
const p = (id: string, d: number, asset: Asset, cents = 300) => ({ id, ts: new Date(NOW.getTime() - d * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: cents });
const many = (asset: Asset, n: number, every: number) => Array.from({ length: n }, (_, i) => p(`${asset}${i}`, 1 + i * every, asset));
/** A grown garden: a tall SKR mandarin and a full stORE succulent in front, USDC and SOL lending behind them. */
export const GROWN: GardenInput = {
  now: NOW, wateredAt: NOW, picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n,
  pendingCents: 0, thresholdCents: 200, allocation: { SKR: 40, stORE: 20, USDC_LEND: 20, SOL_LEND: 20, hSOL: 0, cbBTC: 0 },
  earned: { SKR: { count: 6, progress: 0.5 }, stORE: { count: 4, progress: 0 }, SOL_LEND: { count: 3, progress: 0 }, USDC_LEND: { count: 2, progress: 0 } },
  storePutInRaw: 0n, joinedValueRaw: 0n, basket: null, lendSigns: LEND,
  plantings: [...many("SKR", 14, 2), ...many("stORE", 10, 3), ...many("USDC_LEND", 5, 4), ...many("SOL_LEND", 5, 4)],
};

describe("the stake signs draw above every plant (R355)", () => {
  it("the draw order puts every sign layer after every plant layer", () => {
    const at = (layer: "plants" | "signs") => DRAW_ORDER.flatMap((l, i) => (l.layer === layer ? [i] : []));
    expect(at("plants")).toHaveLength(2);
    expect(at("signs")).toHaveLength(2);
    expect(Math.min(...at("signs"))).toBeGreaterThan(Math.max(...at("plants")));
    // both rows of each layer, the back row first
    expect(DRAW_ORDER.map((l) => `${l.layer}:${l.row}`)).toEqual(["plants:back", "plants:front", "signs:back", "signs:front"]);
  });

  it("the widget's SVG, drawn in that order, places no plant part after any sign board", () => {
    const scene = buildScene(GROWN);
    for (const width of [300, 340, 380]) {
      const svg = widgetGardenSvg(scene, width, 260);
      const marks = [...svg.matchAll(/<use xlink:href="#s-([\w-]+)"|<path d=|<circle /g)].map((m) => ({ at: m.index!, name: m[1] ?? "shape" }));
      const signs = marks.filter((m) => m.name === "sign");
      const plantParts = marks.filter((m) => !["ground", "ring", "seed", "sign", "grain"].includes(m.name));
      expect(signs).toHaveLength(4);
      expect(plantParts.length).toBeGreaterThan(20);
      expect(Math.min(...signs.map((m) => m.at))).toBeGreaterThan(Math.max(...plantParts.map((m) => m.at)));
    }
  });

  it("with the boards on top, no two boards overlap in a grown garden (the walk keeps them apart)", () => {
    for (const width of [280, 320, 353, 372]) for (const scene of [buildScene(GROWN), packScene(buildScene(GROWN), width)]) {
      const plants = plantLayouts(scene), f = frameFor(scene, plants, width), spots = stakeSpots(scene, plants, width, f.zoom), ground = frameGround(width, f);
      const boards = scene.parts.flatMap((q) => (q.kind === "sign" ? [q] : [])).map((s) => {
        const a = signPlacement(s, width, f.zoom, ground, spots), h = 15 * a.scale * a.boardX;
        return { plant: s.plant, x0: a.x - h, x1: a.x + h, y0: a.y - 12 * a.scale, y1: a.y - a.scale };
      });
      expect(boards).toHaveLength(4);
      for (let i = 0; i < boards.length; i++) for (let j = i + 1; j < boards.length; j++) {
        const a = boards[i], b = boards[j];
        const hit = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        expect(hit, `${a.plant} and ${b.plant} at ${width}`).toBe(false);
      }
    }
  });
});
