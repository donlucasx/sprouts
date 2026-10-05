import { describe, it, expect } from "vitest";
import { mandarin } from "@/model/geometry/mandarin";
import { branchFlags, alongAtY, SWELL_SEPAL } from "@/model/geometry/common";
import { NUB, FURL_ROT, FURL_S, FURL_X, FURL_LEAN, UNFURL_STEM, UNFURL_PAIR, sproutState, unfurlParts, unfurlLayout, twigAxis, isClosedPart } from "@/model/sprout";
import type { LayoutOpts, Placed, ShootIn } from "@/model/species";

// R351 (10-05, approved "new art looks good"): the mandarin's closed shoot is the twig it will become, folded: its own stem cut to a
// nub, its two leaves furled; watering eases every number to the open twig, so the last frame IS the static leaf pair.
const O: LayoutOpts = { pending: 0, fruit: 0, ripening: 0, blossom: false, pups: 0, head: false };
const shoots = (ages: number[], closed: number[]): ShootIn[] => {
  const raw = ages.map((age, i) => ({ id: `s${i}`, ageDays: age, band: 1 as const, opened: !closed.includes(i) }));
  const br = branchFlags(raw); return raw.map((s, i) => ({ ...s, branch: br[i] }));
};
type Stem = Extract<Placed, { kind: "stem" }>; type Sprite = Extract<Placed, { kind: "sprite" }>;
const of = (parts: Placed[], shoot: string) => parts.filter((p) => p.shoot === shoot);
const strip = (ps: Placed[]) => ps.map((p) => { const { part: _p, ...rest } = p as Placed & { part: string }; void _p; return rest; });

describe("R351: the sprout's motion (sprout_state, gen13_sprout.py)", () => {
  it("closed is the approved draft's numbers; open is the twig's", () => {
    expect([NUB, FURL_ROT, FURL_S, FURL_X, FURL_LEAN]).toEqual([0.28, 8, 0.74, 0.62, 0.6]);
    expect(sproutState(0)).toEqual({ stem: NUB, rot: FURL_ROT, scale: FURL_S, xs: FURL_X, lean: FURL_LEAN });
    expect(sproutState(1)).toEqual({ stem: 1, rot: 38, scale: 1, xs: 1, lean: 1 });
  });
  it("the stem grows over the first ~40%, the pair opens across the rest, overlapping it; every number only moves one way", () => {
    expect(UNFURL_STEM[0]).toBe(0); expect(UNFURL_STEM[1]).toBeGreaterThanOrEqual(0.35); expect(UNFURL_STEM[1]).toBeLessThanOrEqual(0.45);
    expect(UNFURL_PAIR[0]).toBeLessThan(UNFURL_STEM[1]); expect(UNFURL_PAIR[1]).toBe(1);
    expect(sproutState(UNFURL_STEM[1]).stem).toBeCloseTo(1, 9);
    expect(sproutState(UNFURL_PAIR[0])).toMatchObject({ rot: FURL_ROT, scale: FURL_S });
    let prev = sproutState(0);
    for (let i = 1; i <= 200; i++) {
      const s = sproutState(i / 200);
      for (const k of ["stem", "rot", "scale", "xs", "lean"] as const) expect(s[k]).toBeGreaterThanOrEqual(prev[k] - 1e-12);
      prev = s;
    }
    // eased, not linear: slow at both ends of each phase
    expect(sproutState(0.02).stem - NUB).toBeLessThan((1 - NUB) * 0.02 / UNFURL_STEM[1]);
  });
});

describe("R351: the mandarin's closed shoot is its own twig folded (no new art, no bud sprite)", () => {
  for (const [name, ages, closed] of [
    ["a first planting", [0], [0]],
    ["the third node, two open below", [5, 1, 0], [2]],
    ["a shoot on a branch (past twelve)", Array.from({ length: 16 }, (_, i) => 45 - i * 3), [15]],
    ["an older closed shoot, stage 1", [6, 4], [1]],
  ] as [string, number[], number[]][]) {
    it(`${name}: the closed parts equal the opened twig at u = 0, and the nub starts where that twig's stem starts`, () => {
      const id = `s${closed[0]}`;
      const c = mandarin(shoots(ages, closed), O, 1.3), o = mandarin(shoots(ages, []), O, 1.3);
      const cl = of(c.parts, id), op = of(o.parts, id);
      expect(cl.some((p) => p.kind === "sprite" && p.name.startsWith("bud-"))).toBe(false);
      expect(cl.map((p) => p.part).sort()).toEqual(["furl", "furl", "nub"]);
      expect(cl.every(isClosedPart)).toBe(true);
      expect(strip(cl)).toEqual(strip(unfurlParts(op, 0)));
      const nub = cl.find((p): p is Stem => p.kind === "stem")!, tw = op.find((p): p is Stem => p.kind === "stem")!;
      expect([nub.x0, nub.y0]).toEqual([tw.x0, tw.y0]);
      expect(Math.hypot(nub.x1 - nub.x0, nub.y1 - nub.y0)).toBeCloseTo(NUB * Math.hypot(tw.x1 - tw.x0, tw.y1 - tw.y0), 9);
      const ang = twigAxis(tw);
      for (const l of cl.filter((p): p is Sprite => p.kind === "sprite")) {
        expect(Math.abs(l.rot - ang * FURL_LEAN)).toBeCloseTo(FURL_ROT, 9);
        expect([l.x, l.y]).toEqual([nub.x1, nub.y1]);
      }
      // the tips (where tokens hang) are the open twigs' only
      expect(c.tips.length).toBe(o.tips.length - 1);
    });
  }
  it("a trunk node's sprout sits ON the trunk: its node on the bowed trunk's centreline (today's bud floated 3k off it)", () => {
    const l = mandarin(shoots([5, 1, 0], [2]), O, 1.3);
    const trunk = l.parts.find((p): p is Stem => p.kind === "stem" && p.part === "trunk")!;
    const nub = l.parts.find((p): p is Stem => p.kind === "stem" && p.part === "nub")!;
    expect(nub.x0).toBeCloseTo(alongAtY(trunk.x0, trunk.y0, trunk.x1, trunk.y1, trunk.bend, nub.y0), 9);
  });
  it("the hand-off: the unfurl's last frame is the static leaf pair exactly; just before it is not", () => {
    const o = mandarin(shoots([5, 1, 0], []), O, 1.3);
    expect(unfurlLayout(o, "s2", 1)).toEqual(o.parts);
    expect(unfurlLayout(o, "s2", 0.97)).not.toEqual(o.parts);
    expect(unfurlLayout(o, "s1", 0.5).filter((p) => p.shoot !== "s1")).toEqual(o.parts.filter((p) => p.shoot !== "s1"));
  });
  it("the pending swelling rides above a sprout near the trunk's tip, clear of its leaves", () => {
    const l = mandarin(shoots([5, 1, 0], [2]), { ...O, pending: 0.5 }, 1.3);
    const sw = l.parts.find((p): p is Sprite => p.kind === "sprite" && p.part === "swelling")!;
    const tips = l.parts.filter((p): p is Sprite => p.kind === "sprite" && p.part === "furl").map((p) => p.y - Math.cos((p.rot * Math.PI) / 180) * 12 * p.scale);
    expect(sw.y + SWELL_SEPAL * sw.scale).toBeLessThan(Math.min(...tips));   // R358: the droplet's base, its sepals under it, clear of the pair
  });
});
