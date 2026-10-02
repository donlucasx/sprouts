import { describe, it, expect } from "vitest";
import { succulent } from "@/model/geometry/succulent";
import { pupsByCount } from "@/model/geometry/common";
import type { ShootIn, LayoutOpts } from "@/model/species";

const O: LayoutOpts = { pending: 0, fruit: 0, ripening: 0, blossom: false, pups: 0, head: false };
const sh = (ages: number[], buds = 0): ShootIn[] => ages.map((age, i) => ({ id: `o${i}`, ageDays: age, band: 1, opened: i < ages.length - buds, branch: false }));
const sprites = (l: ReturnType<typeof succulent>) => l.parts.filter((p) => p.kind === "sprite") as Extract<ReturnType<typeof succulent>["parts"][number], { kind: "sprite" }>[];

describe("the succulent (RG13, gen06:26-50)", () => {
  it("rings at 24, 40, 56 degrees, the centre blade upright, drawn outer first", () => {
    const l = succulent(sh([60, 50, 40, 30, 20, 10, 5]), O, 1);
    const blades = sprites(l).filter((s) => s.part === "blade");
    // gen06:30-33: i = 6 draws first with side +1 (odd i is the left side); the centre blade i = 0 sits 1.5 px right at 0 degrees
    expect(blades.map((b) => b.rot)).toEqual([56, -56, 40, -40, 24, -24, 0]);
    expect(blades.map((b) => b.x)).toEqual([1.5 + 3.2 * 3, -(1.5 + 3.2 * 3), 1.5 + 3.2 * 2, -(1.5 + 3.2 * 2), 1.5 + 3.2, -(1.5 + 3.2), 1.5]);
    expect(blades[6].xScale).toBeCloseTo(12.74 / 11.3, 5);   // the centre blade is stage 3 on ring 0: L = 40 + 4 · 3 = 52, bladeXScale(52 / 40) = bladeWidth(52) / bladeWidth(40)
  });
  it("blade lengths follow stage, ring and the plantings past seven, capped 78 / 58 / 40; the width is fixed by the cap, never a ring", () => {
    const young = succulent(sh([2]), O, 1), year = succulent(sh(Array.from({ length: 12 }, (_, i) => 365 - i * 30)), O, 1), old = succulent(sh(Array.from({ length: 40 }, (_, i) => 1000 - i * 20)), O, 1);
    const L = (l: ReturnType<typeof succulent>) => sprites(l).filter((s) => s.part === "blade").map((b) => b.scale * 40);
    expect(L(young)).toEqual([12 + 12]);                       // base 12 at stage 0, plus 4 · 3 for ring 0
    expect(Math.max(...L(year))).toBeCloseTo(Math.min(78, 40 + 12 + 6 * 5), 5);
    expect(Math.max(...L(old))).toBe(78); expect(sprites(old).filter((s) => s.part === "blade")).toHaveLength(7);
  });
  it("the stalk stands at four plantings and a 30-day shoot: 62 plus 5 per extra planting, at most 96; three gold dots until the first token (RG20)", () => {
    const l = succulent(sh([35, 20, 10, 5]), O, 1);
    expect(l.parts.find((p) => p.kind === "stem" && p.part === "stalk")).toMatchObject({ x0: 1, y0: -14, x1: 4, y1: -62 });
    expect(sprites(l).filter((s) => s.part === "dot")).toHaveLength(3);
    const tall = succulent(sh(Array.from({ length: 20 }, (_, i) => 400 - i * 10)), { ...O, fruit: 6 }, 1);
    expect(tall.parts.find((p) => p.kind === "stem" && p.part === "stalk")).toMatchObject({ y1: -96 });
    expect(sprites(tall).filter((s) => s.name === "token-ore")).toHaveLength(4);
    expect(succulent(sh([20, 10, 5]), O, 1).parts.some((p) => p.kind === "stem" && p.part === "stalk")).toBe(false);
  });
  it("pups come by count: one per six plantings past seven, at most four, beside the rosette (RG20)", () => {
    expect([7, 12, 13, 19, 25, 31, 40].map(pupsByCount)).toEqual([0, 0, 1, 2, 3, 4, 4]);
    const l = succulent(sh([5, 4]), { ...O, pups: 3 }, 1);
    expect(sprites(l).filter((s) => s.part === "pup").map((s) => s.x)).toEqual([-20, 20, -26]);
  });
  it("the swelling sits at the rosette's centre, 6 px up", () => {
    expect(sprites(succulent(sh([5]), { ...O, pending: 1 }, 1)).find((s) => s.part === "swelling")).toMatchObject({ x: 0, y: -6, scale: 4.6 });
  });
});
