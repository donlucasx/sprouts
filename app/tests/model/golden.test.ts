import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { layoutPlant, branchFlags, stageOf, leafLen } from "@/model/plant-geometry";
import type { Species, ShootIn, Placed } from "@/model/species";

const PATH = "tests/fixtures/garden-golden.json";
const SPECIES: Record<string, Species> = { skr: "mandarin", ore: "succulent", hsol: "sunflower", jito: "snake", jup: "blueberry", cbbtc: "spruce" };
type Rec = { part: string; x?: number; y?: number; rot?: number; L?: number; x0?: number; y0?: number; x1?: number; y1?: number };
type Golden = Record<string, Record<string, { shoots: { age: number; band: 0 | 1 | 2; opened: boolean }[]; extras: Record<string, number | boolean>; placed: Rec[] }>>;
const TOL = 3, ATOL = 2, JUP_TOL = 6.5;   // px, degrees: the G10 seating moves a mandarin twig's root onto the bowed trunk, within 3 px of gen04's fixed offset

function matchAll(gen: Rec[], ours: { x: number; y: number; rot?: number; L?: number }[], what: string, tol = TOL) {
  const left = [...ours];
  for (const g of gen) {
    let best = -1, bd = Infinity;
    left.forEach((o, i) => { const d = Math.hypot(o.x - g.x!, o.y - g.y!) + (g.rot !== undefined && o.rot !== undefined ? Math.min(Math.abs(o.rot - g.rot), Math.abs(Math.abs(o.rot - g.rot) - 360)) / ATOL * TOL : 0) + (g.L !== undefined && o.L !== undefined ? Math.abs(o.L - g.L) : 0); if (d < bd) { bd = d; best = i; } });
    expect(best, `${what}: no match for ${JSON.stringify(g)}`).toBeGreaterThanOrEqual(0);
    const o = left.splice(best, 1)[0];
    expect(Math.hypot(o.x - g.x!, o.y - g.y!), `${what} position ${JSON.stringify(g)} vs ${JSON.stringify(o)}`).toBeLessThanOrEqual(tol);
    if (g.L !== undefined && o.L !== undefined) expect(Math.abs(o.L - g.L), `${what} length`).toBeLessThanOrEqual(TOL);
    if (g.rot !== undefined && o.rot !== undefined) { const dr = Math.abs(o.rot - g.rot) % 360; expect(Math.min(dr, 360 - dr), `${what} rotation ${JSON.stringify(g)} vs ${JSON.stringify(o)}`).toBeLessThanOrEqual(ATOL); }
  }
  expect(left, `${what}: ours has extra parts`).toHaveLength(0);
}

describe.skipIf(!existsSync(PATH))("the TypeScript geometry draws what the generators drew (RG17, RG19)", () => {
  const golden = JSON.parse(readFileSync(PATH, "utf8")) as Golden;
  for (const [hist, plants] of Object.entries(golden)) for (const [coin, rec] of Object.entries(plants)) {
    it(`${hist}: ${coin}`, () => {
      const raw = rec.shoots.map((s, i) => ({ id: `g${i}`, ageDays: s.age, band: s.band, opened: s.opened }));
      const br = branchFlags(raw); const shoots: ShootIn[] = raw.map((s, i) => ({ ...s, branch: br[i] }));
      const ex = rec.extras; const species = SPECIES[coin];
      const l = layoutPlant(species, shoots, { pending: 0, fruit: 0, ripening: 0, blossom: false, pups: Number(ex.pups ?? 0), head: Boolean(ex.head) }, 1);
      const sprites = l.parts.filter((p): p is Extract<Placed, { kind: "sprite" }> => p.kind === "sprite");
      const stems = l.parts.filter((p): p is Extract<Placed, { kind: "stem" }> => p.kind === "stem");
      const leafLike = (r: Rec) => r.part === "leaf" || r.part === "blade";
      // R290 (10-04): gen04's blueberry twigs rise from the cane's CHORD (lean times t), up to 6 px off its bowed paint; ours leave the paint
      const tol = coin === "jup" ? JUP_TOL : TOL;
      matchAll(rec.placed.filter(leafLike), sprites.filter((p) => p.part === "leaf" || p.part === "blade").map((p) => ({ x: p.x, y: p.y, rot: p.rot, L: leafLen(p) })), `${coin} leaves`, tol);
      matchAll(rec.placed.filter((r) => r.part === "bud"), sprites.filter((p) => p.part === "bud").map((p) => ({ x: p.x, y: p.y })), `${coin} buds`, tol);
      const genStems = rec.placed.filter((r) => r.part === "stem").map((r) => ({ x: r.x1!, y: r.y1!, x0: r.x0!, y0: r.y0! }));
      matchAll(genStems.map((s) => ({ part: "stem", x: s.x, y: s.y })), stems.map((s) => ({ x: s.x1, y: s.y1 })), `${coin} stem ends`, tol);   // every stem, the succulent's stalk included: the recorder records it too
      void stageOf;
    });
  }
});
