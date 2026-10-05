import { describe, it, expect } from "vitest";
import { mandarin } from "@/model/geometry/mandarin";
import { branchFlags, SWELL_LIFT, SWELL_TUCK } from "@/model/geometry/common";
import type { ShootIn, LayoutOpts } from "@/model/species";
import { BAKED_L } from "@/model/species";

const O: LayoutOpts = { pending: 0, fruit: 0, ripening: 0, blossom: false, pups: 0, head: false };
const shoots = (ages: number[], buds = 0): ShootIn[] => {
  const raw = ages.map((age, i) => ({ id: `s${i}`, ageDays: age, band: 1 as const, opened: i < ages.length - buds }));
  const br = branchFlags(raw); return raw.map((s, i) => ({ ...s, branch: br[i] }));
};
const sprites = (l: ReturnType<typeof mandarin>) => l.parts.filter((p) => p.kind === "sprite") as Extract<ReturnType<typeof mandarin>["parts"][number], { kind: "sprite" }>[];
const stems = (l: ReturnType<typeof mandarin>) => l.parts.filter((p) => p.kind === "stem") as Extract<ReturnType<typeof mandarin>["parts"][number], { kind: "stem" }>[];

describe("the mandarin (spec 4, gen04:70-110)", () => {
  it("his Oct 8 plant: five shoots, the last a bud, branches at its lowest two nodes (RG19)", () => {
    const l = mandarin(shoots([10.8, 8.4, 6, 3.6, 1.2], 1), O, 1);
    expect(stems(l).filter((s) => s.part === "branch")).toHaveLength(2);
    expect(stems(l).find((s) => s.part === "trunk")).toMatchObject({ x1: 1.5, y1: -(16 + 10 * 5), bend: -2, color: "#236F47" });
    expect(sprites(l).filter((s) => s.part === "bud")).toHaveLength(0);   // R351: the bud is a sprout on a nub
    expect(stems(l).filter((s) => s.part === "nub")).toHaveLength(1); expect(sprites(l).filter((s) => s.part === "furl")).toHaveLength(2);
    expect(l.growthPoint).toEqual({ x: 1.5, y: -66 });
  });
  it("a trunk of twelve nodes caps at 146.52 and goes woody past eight shoots", () => {
    const l = mandarin(shoots(Array.from({ length: 12 }, (_, i) => 400 - i * 30)), O, 1);
    expect(stems(l).find((s) => s.part === "trunk")).toMatchObject({ y1: -Math.min(222 * 0.66, 136), color: "#6E5A3C" });
  });
  it("overflow past the eighth branch's fifteenth twig returns to the trunk; nothing is dropped (Review Focus 2)", () => {
    const l = mandarin(shoots(Array.from({ length: 140 }, (_, i) => 400 - i * 2)), O, 1);
    expect(sprites(l).filter((s) => s.part === "leaf" || s.part === "furl").map((s) => s.shoot).filter((v, i, a) => a.indexOf(v) === i)).toHaveLength(140);
    expect(stems(l).filter((s) => s.part === "branch").length).toBeGreaterThanOrEqual(8);
    expect(l.top).toBeLessThan(240);
  });
  it("with no branch node (the lowest node still a bud) the extras return to the trunk's top as twigs; nothing is dropped", () => {
    const sh = shoots(Array.from({ length: 14 }, (_, i) => 60 - i * 4)); sh[0] = { ...sh[0], opened: false, branch: false };
    for (let i = 1; i < 12; i++) sh[i] = { ...sh[i], branch: false };
    const l = mandarin(sh, O, 1);
    expect(sprites(l).filter((s) => s.part === "leaf" || s.part === "furl").map((s) => s.shoot).filter((v, i, a) => a.indexOf(v) === i)).toHaveLength(14);
    expect(stems(l).filter((s) => s.part === "branch")).toHaveLength(0);
  });
  it("tokens hang on 4 px stalks at the highest twig tips, the blossom last; the swelling sits on the trunk's tip", () => {
    const l = mandarin(shoots([40, 30, 20, 12, 6]), { ...O, fruit: 2, ripening: 0.5, pending: 0.5 }, 1);
    expect(sprites(l).filter((s) => s.name === "token-skr")).toHaveLength(2);
    expect(stems(l).filter((s) => s.part === "stalk")).toHaveLength(2);
    expect(sprites(l).find((s) => s.name === "blossom-mandarin")?.scale).toBeCloseTo(0.8, 5);
    const sw = sprites(l).find((s) => s.part === "swelling")!, trunk = stems(l).find((s) => s.part === "trunk")!;
    // R358: the droplet bud stands on the trunk's tip (66 up), on a leader that is the trunk itself grown on into it
    expect(sw).toMatchObject({ name: "swell-mandarin" }); expect(sw.scale).toBeCloseTo(1, 9); expect(sw.y).toBeCloseTo(-66 - SWELL_LIFT, 9);
    expect(sw.x).toBeCloseTo(1.5, 0); expect(trunk.y1).toBeCloseTo(sw.y - SWELL_TUCK, 9);
  });
  it("the back-row scale k multiplies every position", () => {
    const a = mandarin(shoots([20, 10, 5]), O, 1), b = mandarin(shoots([20, 10, 5]), O, 0.8);
    expect(stems(b)[0].y1).toBeCloseTo(stems(a)[0].y1 * 0.8, 5);
  });
  it("RG29: the day-0-to-3 sprout at twice gen01's size: its twig 14 long, its two blades 10.2 (gen12_ground.py:19-23)", () => {
    const l = mandarin(shoots([1]), O, 1);
    const tw = stems(l).find((s) => s.part === "twig")!;
    expect(Math.hypot(tw.x1 - tw.x0, tw.y1 - tw.y0)).toBeCloseTo(14, 5);   // gen04:102's 7, times 2
    const blades = sprites(l).filter((s) => s.name === "leaf-mandarin-s0");
    expect(blades.map((s) => BAKED_L["leaf-mandarin"][0] * s.scale)).toEqual([expect.closeTo(10.2, 5), expect.closeTo(10.2, 5)]);   // baked 12, times 0.85 off the centre
  });
});
