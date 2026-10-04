import { describe, it, expect } from "vitest";
import { layoutPlant } from "@/model/plant-geometry";
import { branchFlags } from "@/model/geometry/common";
import type { Band, LayoutOpts, Placed, ShootIn, Species } from "@/model/species";

/** R290 (10-04, his note on Hammer's lone SKR: "the very top two look like they are not well connected to the main plant stem"): every
 * stem that does not rise from the foot leaves another stem's painted CENTRELINE (gen01's quadratic: control point at the middle plus
 * the bend in x, paint.ts ribbon), for every species, growth stage, band and row scale. */
type Stem = Extract<Placed, { kind: "stem" }>;
const centre = (s: Stem, t: number) => {
  const mx = (s.x0 + s.x1) / 2 + s.bend, my = (s.y0 + s.y1) / 2;
  return { x: (1 - t) ** 2 * s.x0 + 2 * t * (1 - t) * mx + t * t * s.x1, y: (1 - t) ** 2 * s.y0 + 2 * t * (1 - t) * my + t * t * s.y1 };
};
const distTo = (s: Stem, x: number, y: number) => {
  let best = 0, d = Infinity;   // coarse, then a fine pass about the best sample
  for (let i = 0; i <= 100; i++) { const p = centre(s, i / 100), e = Math.hypot(p.x - x, p.y - y); if (e < d) { d = e; best = i / 100; } }
  for (let i = -100; i <= 100; i++) { const t = Math.min(1, Math.max(0, best + i / 10000)), p = centre(s, t); d = Math.min(d, Math.hypot(p.x - x, p.y - y)); }
  return d;
};
const O: LayoutOpts = { pending: 0.5, fruit: 2, ripening: 0.5, blossom: false, pups: 0, head: false };
const shoots = (n: number, age: number, band: Band): ShootIn[] => {
  const raw = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, ageDays: age + (n - i) * 3, band, opened: i < n - 1 || n % 3 !== 0 }));
  const br = branchFlags(raw); return raw.map((s, i) => ({ ...s, branch: br[i] }));
};
const SPECIES: Species[] = ["mandarin", "succulent", "sunflower", "snake", "blueberry", "spruce"];
/** A stem's base is a root when it stands on the foot; the succulent's gold stalk rises from inside the rosette of blades (gen06). */
const isRoot = (sp: Species, s: Stem, k: number) => Math.hypot(s.x0, s.y0) <= 0.01 * k || (sp === "succulent" && s.part === "stalk");
const TOL = 0.1;   // 1x px (times k); a joint 0.1 px off is 0.1 x 1.25 x 1.3 x 2 x 3 = about 1 device px on the Seeker

describe("R290: every branch, twig and stalk leaves its parent stem's centreline", () => {
  for (const sp of SPECIES) it(sp, () => {
    const bad: string[] = [];
    for (const k of [0.8, 1, 1.3]) for (const band of [0, 1, 2] as Band[]) for (const age of [0, 4, 15, 40]) for (const n of [1, 2, 3, 4, 5, 6, 7, 9, 12, 14, 20, 33, 60]) {
      const stems = layoutPlant(sp, shoots(n, age, band), O, k).parts.filter((p): p is Stem => p.kind === "stem");
      stems.forEach((s, i) => {
        if (isRoot(sp, s, k)) return;
        const d = Math.min(...stems.filter((_, j) => j !== i).map((o) => distTo(o, s.x0, s.y0)));
        if (!(d <= TOL * k)) bad.push(`k${k} b${band} age${age} n${n} ${s.part}#${i} off by ${d.toFixed(2)}`);
      });
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
