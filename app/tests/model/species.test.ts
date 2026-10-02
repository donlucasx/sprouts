import { describe, it, expect } from "vitest";
import { COLORS, CAPS, BAKED_L, BAND_SCALE, PLANT_SPECIES } from "@/model/species";
import { stageOf, branchFlags, twig, sprite, swelling, pupsByCount, type Acc } from "@/model/geometry/common";

describe("the species constants (spec 4 and 9)", () => {
  it("maps every plant to its species in order", () => {
    expect(Object.values(PLANT_SPECIES)).toEqual(["mandarin", "succulent", "sunflower", "snake", "blueberry", "spruce"]);
  });
  it("keeps the mark's green out of the garden and gives JitoSOL its mint disc (RG21)", () => {
    for (const c of Object.values(COLORS)) for (const v of Object.values(c)) expect(v).not.toBe("#1E6B44");
    expect(COLORS.skr.deep).toBe("#236F47"); expect(COLORS.jitosol.token).toBe("#A8D8C2"); expect(COLORS.hsol.token).toBe("#C7391F");
  });
  it("carries the generators' caps", () => {
    expect(CAPS).toEqual({ mandarinTrunk: 146.52, sunflower: 222, spruce: 199.8, blueberry: 161.5, snakeBlade: 64, succulent: [78, 58, 40], stalk: 96 });
    expect(BAKED_L["leaf-blueberry"]).toEqual([10.8, 10.8, 10.8, 12.6]);   // RG29: stage 0 at 2x; RG33: stage 1 never smaller
    expect(BAND_SCALE).toEqual({ 0: 0.78, 1: 1.0, 2: 1.28 });
  });
});

describe("the grammar's helpers", () => {
  it("stages by age: under 3, 10, 30 days, then 3", () => expect([0, 2.9, 3, 9.9, 10, 29.9, 30, 400].map(stageOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]));
  it("RG19: an opened shoot with three newer plantings above it branches, open or closed, the lowest node included", () => {
    const o = (opened: boolean) => ({ opened });
    expect(branchFlags([o(true), o(true), o(true), o(true), o(false)])).toEqual([true, true, false, false, false]);
    expect(branchFlags([o(false), o(true), o(true), o(true), o(true)])).toEqual([false, true, false, false, false]);
    expect(branchFlags([o(true), o(true), o(true)])).toEqual([false, false, false]);
  });
  it("a twig fans two, three or four leaves at its tip and returns the tip", () => {
    const acc: Acc = { parts: [], tips: [] };
    const tip = twig(acc, "leaf-mandarin", 0, -20, 58, 7, 1, 3, 2, 1, "#236F47", "a");
    expect(tip.x).toBeCloseTo(Math.sin((58 * Math.PI) / 180) * 7 * 2, 5); expect(tip.y).toBeCloseTo(-20 - Math.cos((58 * Math.PI) / 180) * 7 * 2, 5);   // RG29 + RG33: every twig stem doubled (SPROUT_X)
    const leaves = acc.parts.filter((p) => p.kind === "sprite");
    expect(leaves.map((l) => (l.kind === "sprite" ? l.rot : 0))).toEqual([10, 58, 106]);
    expect(leaves.map((l) => (l.kind === "sprite" ? l.scale : 0))).toEqual([0.85, 1, 0.85]);
    expect(acc.parts[0]).toMatchObject({ kind: "stem", part: "twig", w0: 1.6, w1: 0.9, shoot: "a" });
  });
  it("a fresh bud wins the growth point: the swelling rides 2 px above its top (spec 5, Review Focus 5)", () => {
    const acc: Acc = { parts: [], tips: [] };
    sprite(acc, "bud", "bud-mandarin", 1.5, -66, 35, 0.9, 2, "e"); swelling(acc, 1.5, -67.2, 0.5, 1);
    const sw = acc.parts.find((p) => p.kind === "sprite" && p.part === "swelling") as { y: number; scale: number };
    expect(sw.scale).toBeCloseTo(3.8, 9); expect(sw.y).toBeCloseTo(-66 - 9.6 * 0.9 - 2 - 3.8, 5);
    const free: Acc = { parts: [], tips: [] }; swelling(free, 0, -40, 1, 0.8);
    expect(free.parts[0]).toMatchObject({ y: -40, scale: 4.6 * 0.8 });
  });
  it("pups by count (RG20): one per six plantings past seven, at most four", () => expect([7, 12, 13, 19, 25, 31, 40].map(pupsByCount)).toEqual([0, 0, 1, 2, 3, 4, 4]));
});
