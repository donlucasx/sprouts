import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { openingPlan, openingPlants, arrivalsOf, releaseGroups, stripOf, STRIP_FOR, endOf, drawnBy, type PlantItem, type OpeningItem, PACE, LEAF_MS, PART_GAP_MS, STEM_MS, BUD_FADE_MS, BUD_FADE_AFTER_MS, PART_FADE_MS, OPEN_BEAT_MS, BUD_ARRIVE_MS, TOKEN_ARRIVE_MS, SEED_MS, SEED_GAP_MS, REDUCED_MS } from "@/model/opening";
import { buildScene, type Scene } from "@/model/garden";
import { plantLayouts } from "@/model/scene-to-layout";
import { previewInputAt } from "@/model/fixtures/median-year";
import { diffScenes, gateDiff } from "@/lib/scene-diff";
import { frameAt } from "@/model/motion";
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
  it("the timings are G11's, the opening's slowed by R202 (each leaf ~5 s, the gaps in proportion; arrivals and seeds as G11)", () => {
    expect(PACE).toBeCloseTo(5 / 3, 12);
    // G11: leaf 3000, gap 800, stem 600, bud fade 1400 from 250, part fade 1050, token 1500; all times 5/3
    expect([LEAF_MS, PART_GAP_MS, STEM_MS, BUD_FADE_MS, BUD_FADE_AFTER_MS, PART_FADE_MS, TOKEN_ARRIVE_MS]).toEqual([5000, 1333, 1000, 2333, 417, 1750, 2500]);
    expect([OPEN_BEAT_MS, BUD_ARRIVE_MS, SEED_MS, SEED_GAP_MS, REDUCED_MS]).toEqual([800, 1050, 900, 120, 300]);
  });
  it("after the beat, the target plant first; a twig's stem, then its leaves a gap apart; the bud fades from just after its first leaf; tokens after", () => {
    const { items, endMs } = openingPlan({ scene, plants, before, diff, first: "hsol", reduced: false, tempo: 1 });
    const at = (plant: string, part: number, kind?: string) => items.find((i) => i.kind !== "seed" && i.plant === plant && i.part === part && (!kind || i.kind === kind));
    // hSOL from the beat (800); SKR's shoot a a gap later (2133): its stem, its leaves at 3133 and 4466, its bud from 3550
    expect(at("hsol", 1)).toEqual({ kind: "strip", plant: "hsol", shoot: "c", part: 1, leaf: 0, strip: "hsol-broad", delay: 800, ms: LEAF_MS });
    expect(at("hsol", 1, "bud")).toEqual({ kind: "bud", plant: "hsol", shoot: "c", part: 1, delay: 1217, ms: BUD_FADE_MS });
    expect(at("skr", 1)).toEqual({ kind: "stem", plant: "skr", shoot: "a", part: 1, delay: 2133, ms: STEM_MS });
    expect(at("skr", 2)).toEqual({ kind: "strip", plant: "skr", shoot: "a", part: 2, leaf: 0, strip: "skr-blade", delay: 3133, ms: LEAF_MS });
    expect(at("skr", 3)).toEqual({ kind: "strip", plant: "skr", shoot: "a", part: 3, leaf: 1, strip: "skr-blade", delay: 4466, ms: LEAF_MS });
    expect(at("skr", 1, "bud")).toEqual({ kind: "bud", plant: "skr", shoot: "a", part: 1, delay: 3550, ms: BUD_FADE_MS });
    expect(at("skr", 6)).toEqual({ kind: "fade", plant: "skr", shoot: null, part: 6, delay: 9466, ms: TOKEN_ARRIVE_MS });   // the last leaf ends at 9.466 s
    expect(items.find((i) => i.kind === "seed")).toEqual({ kind: "seed", id: "seed1", delay: 0, ms: SEED_MS });
    expect(endMs).toBe(11966);
    // shoot b was already open: nothing of it moves, and the trunk never does
    expect(items.some((i) => i.kind !== "seed" && i.plant === "skr" && (i.part === 0 || i.part === 4 || i.part === 5))).toBe(false);
  });
  it("a tap opens in garden order (SKR before hSOL)", () => {
    const { items } = openingPlan({ scene, plants, before, diff, first: null, reduced: false, tempo: 1 });
    const strip = (plant: string) => items.find((i) => i.kind === "strip" && i.plant === plant)!;
    expect(strip("skr").delay).toBe(800 + 1000);              // the beat, then SKR's stem
    expect(strip("hsol").delay).toBe(800 + 1000 + 2 * 1333);   // after SKR's two leaves' gaps
  });
  it("tempo scales every time; reduced motion is one 300 ms fade with no order", () => {
    const slow = openingPlan({ scene, plants, before, diff, first: "hsol", reduced: false, tempo: 8 });
    expect(slow.endMs).toBe(11966 * 8);
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
      { kind: "stem", plant: "skr", shoot: "b", part: 4, delay: 800, ms: STEM_MS },
      { kind: "strip", plant: "skr", shoot: "b", part: 5, leaf: 0, strip: "skr-blade", delay: 1800, ms: LEAF_MS },
    ]);
    expect(openingPlan({ scene, plants, before, diff: { seeds: [], buds: [], opened: [], branches: [], tokens: [] }, first: null, reduced: false, tempo: 1 })).toEqual({ items: [], endMs: 0 });
  });
  it("which baked strip a leaf opens with (coloured per species and shape, ruling a); tiers and the rest fade", () => {
    expect(stripOf("leaf-mandarin-s2")).toBe("skr-blade");
    expect(stripOf("leaf-sunflower-s0")).toBe("hsol-broad");
    expect(stripOf("leaf-blueberry-s3")).toBe("jupsol-small");
    expect(stripOf("blade-snake-s1")).toBe("jitosol-blade");
    expect(stripOf("blade-succulent-2")).toBe("ore-blade");
    expect(stripOf("tier-spruce-s1")).toBeUndefined();
  });
  it("every strip the plan can name is one the bake wrote (strips.ts)", () => {
    const keys = [...readFileSync("src/garden/strips.ts", "utf8").matchAll(/^\s+"([a-z-]+)": \{ src:/gm)].map((m) => m[1]).sort();
    expect([...new Set(Object.values(STRIP_FOR))].sort()).toEqual(keys);
  });
});

describe("R201: a drag's openings released per plant, as the can reaches each one", () => {
  it("the plants a watering opens: an opened or branched shoot, or an earned token, in garden order", () => {
    expect(openingPlants(scene, diff)).toEqual(["skr", "hsol"]);
    expect(openingPlants(scene, { ...diff, opened: ["c"], tokens: [] })).toEqual(["hsol"]);
    expect(openingPlants(scene, { ...diff, opened: [], tokens: [] })).toEqual([]);
    expect(arrivalsOf(diff)).toEqual({ seeds: ["seed1"], buds: [], opened: [], branches: [], tokens: [] });
  });
  it("a group opens only its plants, in its order, from its own release: the beat, its openings, its tokens; no arrivals or seeds", () => {
    const skr = openingPlan({ scene, plants, before, diff, first: null, reduced: false, tempo: 1, order: ["skr"] });
    expect(skr.items).toEqual([
      { kind: "stem", plant: "skr", shoot: "a", part: 1, delay: 800, ms: STEM_MS },
      { kind: "strip", plant: "skr", shoot: "a", part: 2, leaf: 0, strip: "skr-blade", delay: 1800, ms: LEAF_MS },
      { kind: "strip", plant: "skr", shoot: "a", part: 3, leaf: 1, strip: "skr-blade", delay: 3133, ms: LEAF_MS },
      { kind: "bud", plant: "skr", shoot: "a", part: 1, delay: 2217, ms: BUD_FADE_MS },
      { kind: "fade", plant: "skr", shoot: null, part: 6, delay: 8133, ms: TOKEN_ARRIVE_MS },
    ]);
    expect(skr.endMs).toBe(10633);
    const hsol = openingPlan({ scene, plants, before, diff, first: null, reduced: false, tempo: 2, order: ["hsol"] });
    expect(hsol.items.map((i) => (i.kind === "seed" ? i.kind : `${i.kind}:${i.plant}:${i.delay}`))).toEqual(["strip:hsol:1600", "bud:hsol:2434"]);
    expect(hsol.endMs).toBe((800 + 5000) * 2);
    // both groups together hold every opening item of the whole plan, none twice
    const whole = openingPlan({ scene, plants, before, diff, first: null, reduced: false, tempo: 1 }).items.filter((i) => i.kind !== "seed");
    const keyOf = (i: OpeningItem) => (i.kind === "seed" ? i.id : `${i.kind}:${i.plant}:${i.part}`);
    const both = [...skr.items, ...hsol.items].map(keyOf).sort();
    expect(both).toEqual(whole.map(keyOf).sort());
    expect(openingPlan({ scene, plants, before, diff, first: null, reduced: true, tempo: 1, order: ["skr"] }).items.every((i) => i.delay === 0 && i.ms === REDUCED_MS)).toBe(true);
  });
  it("each plant reached is its own group; the drop releases every plant still held, in garden order; nothing new is the same list", () => {
    const openers = ["skr", "ore", "cbbtc"] as const;
    const g0: ("skr" | "ore" | "cbbtc")[][] = [];
    const g1 = releaseGroups(g0, ["cbbtc"], false, [...openers]);
    expect(g1).toEqual([["cbbtc"]]);
    expect(releaseGroups(g1, ["cbbtc"], false, [...openers])).toBe(g1);                       // the can back over cbBTC: nothing new
    expect(releaseGroups(g1, ["cbbtc", "jupsol"], false, [...openers])).toBe(g1);             // a plant the watering does not open
    const g2 = releaseGroups(g1, ["cbbtc", "skr"], false, [...openers]);
    expect(g2).toEqual([["cbbtc"], ["skr"]]);
    expect(releaseGroups(g2, ["cbbtc", "skr"], true, [...openers])).toEqual([["cbbtc"], ["skr"], ["ore"]]);
    // reached before the read arrived, then dropped: one group, the reached first, then the rest in garden order
    expect(releaseGroups([], ["cbbtc"], true, [...openers])).toEqual([["cbbtc", "skr", "ore"]]);
    expect(releaseGroups([], [], false, [...openers])).toEqual([]);
  });
});

describe("every animation ends visible (I4 fix round 1, ruling c)", () => {
  // a real garden: the median year on day 240 with every planting still a bud, then the same day just watered
  const input = previewInputAt(240);
  const closed = buildScene({ ...input, wateredAt: null });
  const watered = buildScene({ ...input, wateredAt: input.now });
  const plants = plantLayouts(watered), before = plantLayouts(closed);
  const diff = gateDiff(diffScenes(closed, watered), { watered: true, arrivals: true });
  for (const reduced of [false, true]) {
    const { items } = openingPlan({ scene: watered, plants, before, diff, first: "skr", reduced, tempo: 1 });
    it(`${reduced ? "reduced motion: " : ""}every part present is drawn static or by an item that ends it fully shown; once settled, all static`, () => {
      expect(diff.opened.length).toBeGreaterThan(10);
      expect(items.filter((i) => i.kind === "strip").length).toBeGreaterThan(5);
      for (const pl of plants) {
        const mine = items.filter((i): i is PlantItem => i.kind !== "seed" && i.plant === pl.plant);
        const during = drawnBy(pl.layout.parts.length, mine, false);
        expect(during.length).toBe(pl.layout.parts.length);
        for (const d of during) if (d !== "static") expect(endOf(d).opacity).toBe(1);
        expect(drawnBy(pl.layout.parts.length, mine, true).every((d) => d === "static")).toBe(true);
        for (const it of mine) if (it.kind === "bud") expect(before.find((b) => b.plant === pl.plant)!.layout.parts[it.part]).toMatchObject({ part: "bud" });
        else expect(pl.layout.parts[it.part]).toBeDefined();
      }
      for (const it of items) expect(Number.isFinite(it.delay + it.ms)).toBe(true);
    });
  }
  it("a strip's last frame is its end picture", () => { expect(frameAt(1, 16)).toBe(15); expect(endOf({ kind: "strip", plant: "skr", shoot: "a", part: 0, leaf: 0, strip: "skr-blade", delay: 0, ms: 1 })).toEqual({ opacity: 1, frame: "last" }); });
});
