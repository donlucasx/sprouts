import { describe, it, expect } from "vitest";
import { openingPlan, stripShapeOf, LEAF_MS, PART_GAP_MS, STEM_MS, BUD_FADE_MS, BUD_FADE_AFTER_MS, BUD_ARRIVE_MS, TOKEN_ARRIVE_MS, SEED_MS, SEED_GAP_MS, REDUCED_MS } from "@/model/opening";
import type { Scene } from "@/model/garden";
import type { Placed, PlantLayout } from "@/model/species";

const stem = (part: "trunk" | "twig" | "stalk", shoot?: string): Placed => ({ kind: "stem", part, x0: 0, y0: 0, x1: 0, y1: -10, w0: 2, w1: 1, bend: 0, color: "#000", z: 1, shoot });
const sprite = (part: "leaf" | "bud" | "token", name: string, shoot?: string): Placed => ({ kind: "sprite", part, name, x: 0, y: -10, rot: 0, scale: 1, z: 2, shoot });
const lay = (parts: Placed[]): PlantLayout => ({ parts, top: 40, growthPoint: { x: 0, y: -10 }, tips: [] });
const sprout = (id: string, plant: "skr" | "hsol", slot: number): Scene["parts"][number] => ({ kind: "sprout", id, plant, slot, stage: 1, bud: false, band: 1, branch: false, ageDays: 3 });
const scene: Scene = { parts: [{ kind: "soil" }, sprout("a", "skr", 0), sprout("b", "skr", 1), sprout("c", "hsol", 0), { kind: "seed", id: "seed0", plant: "ore", index: 0 }, { kind: "seed", id: "seed1", plant: "ore", index: 1 }], unrevealed: 0, canReady: false };
// SKR: the trunk (no shoot), shoot a's twig and two leaves, shoot b's twig and leaf (already open), one token. hSOL: the stalk, shoot c's leaf.
const plants = [
  { plant: "skr" as const, layout: lay([stem("trunk"), stem("twig", "a"), sprite("leaf", "leaf-mandarin-s1", "a"), sprite("leaf", "leaf-mandarin-s1", "a"), stem("twig", "b"), sprite("leaf", "leaf-mandarin-s1", "b"), sprite("token", "token-skr")]) },
  { plant: "hsol" as const, layout: lay([stem("stalk"), sprite("leaf", "leaf-sunflower-s1", "c")]) },
];
const before = [
  { plant: "skr" as const, layout: lay([stem("trunk"), sprite("bud", "bud-mandarin", "a"), stem("twig", "b"), sprite("leaf", "leaf-mandarin-s1", "b")]) },
  { plant: "hsol" as const, layout: lay([stem("stalk"), sprite("bud", "bud-sunflower", "c")]) },
];
const diff = { seeds: ["seed1"], buds: [], opened: ["a", "c"], branches: [], tokens: [{ plant: "skr" as const, index: 0 }] };

describe("the order the garden opens in (spec 6, gen11_motion.py:32-35, :153-178; RG25: the plant the can was dropped on first)", () => {
  it("the timings are G11's", () => {
    expect([LEAF_MS, PART_GAP_MS, STEM_MS, BUD_FADE_MS, BUD_FADE_AFTER_MS, BUD_ARRIVE_MS, TOKEN_ARRIVE_MS, SEED_MS, SEED_GAP_MS, REDUCED_MS]).toEqual([3000, 800, 600, 1400, 250, 1050, 1500, 900, 120, 300]);
  });
  it("the target plant first; a twig's stem, then its leaves 0.8 s apart; the bud fades from 0.25 s after its first leaf; tokens after", () => {
    const { items, endMs } = openingPlan({ scene, plants, before, diff, first: "hsol", reduced: false, tempo: 1 });
    const at = (plant: string, part: number, kind?: string) => items.find((i) => i.kind !== "seed" && i.plant === plant && i.part === part && (!kind || i.kind === kind));
    expect(at("hsol", 1)).toEqual({ kind: "strip", plant: "hsol", shoot: "c", part: 1, leaf: 0, shape: "broad", delay: 0, ms: LEAF_MS });
    expect(at("hsol", 1, "bud")).toEqual({ kind: "bud", plant: "hsol", shoot: "c", part: 1, delay: 250, ms: BUD_FADE_MS });
    expect(at("skr", 1)).toEqual({ kind: "stem", plant: "skr", shoot: "a", part: 1, delay: 800, ms: STEM_MS });
    expect(at("skr", 2)).toEqual({ kind: "strip", plant: "skr", shoot: "a", part: 2, leaf: 0, shape: "blade", delay: 1400, ms: LEAF_MS });
    expect(at("skr", 3)).toEqual({ kind: "strip", plant: "skr", shoot: "a", part: 3, leaf: 1, shape: "blade", delay: 2200, ms: LEAF_MS });
    expect(at("skr", 1, "bud")).toEqual({ kind: "bud", plant: "skr", shoot: "a", part: 1, delay: 1650, ms: BUD_FADE_MS });
    expect(at("skr", 6)).toEqual({ kind: "fade", plant: "skr", shoot: null, part: 6, delay: 5200, ms: TOKEN_ARRIVE_MS });   // the last leaf ends at 5.2 s
    expect(items.find((i) => i.kind === "seed")).toEqual({ kind: "seed", id: "seed1", delay: 0, ms: SEED_MS });
    expect(endMs).toBe(6700);
    // shoot b was already open: nothing of it moves, and the trunk never does
    expect(items.some((i) => i.kind !== "seed" && i.plant === "skr" && (i.part === 0 || i.part === 4 || i.part === 5))).toBe(false);
  });
  it("a tap opens in garden order (SKR before hSOL)", () => {
    const { items } = openingPlan({ scene, plants, before, diff, first: null, reduced: false, tempo: 1 });
    const strip = (plant: string) => items.find((i) => i.kind === "strip" && i.plant === plant)!;
    expect(strip("skr").delay).toBe(600);
    expect(strip("hsol").delay).toBe(600 + 2 * 800);
  });
  it("tempo scales every time; reduced motion is one 300 ms fade with no order", () => {
    const slow = openingPlan({ scene, plants, before, diff, first: "hsol", reduced: false, tempo: 8 });
    expect(slow.endMs).toBe(6700 * 8);
    const still = openingPlan({ scene, plants, before, diff, first: "hsol", reduced: true, tempo: 1 });
    expect(still.items.every((i) => i.delay === 0 && i.ms === REDUCED_MS)).toBe(true);
    expect(still.endMs).toBe(REDUCED_MS);
  });
  it("a new bud swells in, a new branch replays its node's stem then leaf, and nothing new is nothing", () => {
    const budScene = { ...scene };
    const { items } = openingPlan({ scene: budScene, plants: before, before: null, diff: { seeds: [], buds: ["a"], opened: [], branches: [], tokens: [] }, first: null, reduced: false, tempo: 1 });
    expect(items).toEqual([{ kind: "fade", plant: "skr", shoot: "a", part: 1, delay: 0, ms: BUD_ARRIVE_MS }]);
    const br = openingPlan({ scene, plants, before, diff: { seeds: [], buds: [], opened: [], branches: ["b"], tokens: [] }, first: null, reduced: false, tempo: 1 });
    expect(br.items).toEqual([
      { kind: "stem", plant: "skr", shoot: "b", part: 4, delay: 0, ms: STEM_MS },
      { kind: "strip", plant: "skr", shoot: "b", part: 5, leaf: 0, shape: "blade", delay: 600, ms: LEAF_MS },
    ]);
    expect(openingPlan({ scene, plants, before, diff: { seeds: [], buds: [], opened: [], branches: [], tokens: [] }, first: null, reduced: false, tempo: 1 })).toEqual({ items: [], endMs: 0 });
  });
  it("which strip a leaf opens with (gen03's shapes); tiers and the rest fade", () => {
    expect(stripShapeOf("leaf-mandarin-s2")).toBe("blade");
    expect(stripShapeOf("leaf-sunflower-s0")).toBe("broad");
    expect(stripShapeOf("leaf-blueberry-s3")).toBe("small");
    expect(stripShapeOf("blade-snake-s1")).toBe("blade");
    expect(stripShapeOf("blade-succulent-2")).toBe("blade");
    expect(stripShapeOf("tier-spruce-s1")).toBeUndefined();
  });
});
