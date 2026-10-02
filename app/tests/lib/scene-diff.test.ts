import { describe, it, expect } from "vitest";
import { diffScenes, sceneKey, gateDiff, NO_CHANGE } from "@/lib/scene-diff";
import type { Scene } from "@/model/garden";
const sc = (parts: Scene["parts"]): Scene => ({ parts: [{ kind: "soil" }, ...parts], unrevealed: 0, canReady: false });
const sprout = (id: string, bud: boolean, branch = false): Scene["parts"][number] => ({ kind: "sprout", id, plant: "skr", slot: 0, stage: 1, bud, band: 1, branch, ageDays: 4 });
describe("what changed between two scenes (spec 6 and 7: the renderer fires moments from the diff, never from the tap)", () => {
  it("a new bud, a bud that opened, a node that became a branch, a new seed, a new token", () => {
    const prev = sc([sprout("a", true), { kind: "seed", id: "seed0", plant: "hsol", index: 0 }]);
    const next = sc([sprout("a", false, true), sprout("b", true), { kind: "seed", id: "seed0", plant: "hsol", index: 0 }, { kind: "seed", id: "seed1", plant: "hsol", index: 1 }, { kind: "fruit", plant: "skr", index: 0 }]);
    expect(diffScenes(prev, next)).toEqual({ seeds: ["seed1"], buds: ["b"], opened: ["a"], branches: ["a"], tokens: [{ plant: "skr", index: 0 }] });
  });
  it("from no scene, nothing animates (the first paint is still)", () => expect(diffScenes(null, sc([sprout("a", true)]))).toEqual({ seeds: [], buds: [], opened: [], branches: [], tokens: [] }));
  it("the same scene again fires nothing (a refetch with no change)", () => {
    const s = sc([sprout("a", false, true), { kind: "fruit", plant: "skr", index: 0 }]);
    expect(diffScenes(s, s)).toEqual({ seeds: [], buds: [], opened: [], branches: [], tokens: [] });
  });
});

describe("what may move (I4 fix round 1, ruling b: an app open never hides or replays anything)", () => {
  const prev = sc([sprout("a", true)]);
  const next = sc([sprout("a", false, true), sprout("b", true), { kind: "seed", id: "seed1", plant: "hsol", index: 1 }, { kind: "fruit", plant: "skr", index: 0 }]);
  const all = diffScenes(prev, next);
  it("the key is the scene's content: a re-parse of the same read is no change; any part that differs is", () => {
    expect(sceneKey(sc([sprout("a", true)]))).toBe(sceneKey(prev));
    expect(sceneKey({ ...prev, parts: [...prev.parts, { kind: "transplant", plant: "skr", sizeRaw: 5n }] })).not.toBe(sceneKey(prev));
    expect(sceneKey(next)).not.toBe(sceneKey(prev));
  });
  it("opens and new branches move only for a watering made here; tokens for a watering or a live change", () => {
    expect(gateDiff(all, { watered: true, arrivals: false })).toEqual({ seeds: [], buds: [], opened: ["a"], branches: ["a"], tokens: [{ plant: "skr", index: 0 }] });
  });
  it("new buds and seeds move only for a change between two live reads while Home is open", () => {
    expect(gateDiff(all, { watered: false, arrivals: true })).toEqual({ seeds: ["seed1"], buds: ["b"], opened: [], branches: [], tokens: [{ plant: "skr", index: 0 }] });
  });
  it("neither (the cached read giving way to the first live one, an app open): nothing moves", () => {
    expect(gateDiff(all, { watered: false, arrivals: false })).toEqual(NO_CHANGE);
  });
});
