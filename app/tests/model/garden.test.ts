import { describe, it, expect } from "vitest";
import { buildScene, PLANT_OF, fruitLadder, type GardenInput, type Part } from "@/model/garden";
import type { Asset } from "@/lib/coins";

const NOW = new Date("2026-10-08T12:00:00-07:00");
const SPLIT = { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 };
const BALANCED = { SKR: 45, stORE: 0, hSOL: 20, JitoSOL: 15, JupSOL: 10, cbBTC: 10 };
const base: GardenInput = {
  now: NOW, wateredAt: null, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n,
  pendingCents: 0, thresholdCents: 200, allocation: SPLIT, earned: {}, storePutInRaw: 0n, joinedValueRaw: 0n, basket: null,
};
const planting = (id: string, daysAgo: number, asset: Asset = "SKR", cents = 200) => ({ id, ts: new Date(NOW.getTime() - daysAgo * 86_400_000), asset, amountOutRaw: 1n, usdcInCents: cents });
const of = <K extends Part["kind"]>(s: { parts: Part[] }, kind: K) => s.parts.filter((p): p is Extract<Part, { kind: K }> => p.kind === kind);

describe("buildScene: plants, rows and signs (RG6, RG7, RG22)", () => {
  it("bare soil for a user with no plantings and no share: soil alone, the can resting (R54)", () => {
    const s = buildScene({ ...base, allocation: { ...SPLIT, SKR: 0 } });
    expect(s.parts.map((p) => p.kind)).toEqual(["soil"]); expect(s.canReady).toBe(false);
  });
  it("one plant per coin with a kept shoot, on its row at its slot, with a sign on the roomier side", () => {
    const s = buildScene({ ...base, wateredAt: NOW, allocation: BALANCED, plantings: [planting("a", 5), planting("b", 4, "stORE"), planting("c", 3, "hSOL"), planting("d", 2, "JitoSOL"), planting("e", 1, "JupSOL"), planting("f", 1, "cbBTC")] });
    expect(of(s, "plant").map((p) => [p.plant, p.row, p.x, p.species])).toEqual([["skr", "front", 0.3, "mandarin"], ["ore", "front", 0.8, "succulent"], ["hsol", "back", 0.09, "sunflower"], ["jitosol", "back", 0.5, "snake"], ["jupsol", "back", 0.67, "blueberry"], ["cbbtc", "back", 0.92, "spruce"]]);
    expect(of(s, "sign")).toHaveLength(6);
    expect(of(s, "sign").find((p) => p.plant === "hsol")?.side).toBe(1);     // the edge counts double: more room on the right
  });
  it("signs for every coin with a share; seeds beside nextAsset's sign only, while it has no plant (Review Focus 1)", () => {
    const s = buildScene({ ...base, wateredAt: NOW, allocation: BALANCED, plantings: [planting("a", 5), planting("b", 4)], pendingCents: 150, nextAsset: "hSOL" });
    expect(of(s, "plant").map((p) => p.plant)).toEqual(["skr"]);
    expect(of(s, "sign").map((p) => p.plant)).toEqual(["skr", "hsol", "jitosol", "jupsol", "cbbtc"]);
    expect(of(s, "seed").map((p) => p.plant)).toEqual(["hsol", "hsol", "hsol", "hsol", "hsol", "hsol"]);
    expect(of(s, "swelling")).toHaveLength(0);
  });
  it("a lone front plant centres at 0.40 and a bare sign occupies its slot (RG22)", () => {
    expect(of(buildScene({ ...base, plantings: [planting("a", 2)] }), "plant")[0].x).toBe(0.4);
    expect(of(buildScene({ ...base, plantings: [planting("a", 2)], allocation: { ...SPLIT, SKR: 60, stORE: 40 } }), "plant")[0].x).toBe(0.3);
  });
});

describe("buildScene: shoots, bands, the branch flag, the swelling (RG3, RG4, RG9, RG19)", () => {
  it("every kept planting is a shoot with its slot, stage, band and age; unwatered ones are buds and the can is ready", () => {
    const s = buildScene({ ...base, wateredAt: new Date(NOW.getTime() - 2 * 86_400_000), plantings: [planting("a", 30, "SKR", 50), planting("b", 8, "SKR", 200), planting("c", 1, "SKR", 900)] });
    expect(of(s, "sprout").map((p) => [p.id, p.slot, p.stage, p.band, p.bud])).toEqual([["a", 0, 3, 0, false], ["b", 1, 1, 1, false], ["c", 2, 0, 2, true]]);
    expect(s.unrevealed).toBe(1); expect(s.canReady).toBe(true);
  });
  it("the branch flag follows RG19 over the full history: the lowest opened node with three newer plantings above it", () => {
    const s = buildScene({ ...base, wateredAt: NOW, plantings: [10.8, 8.4, 6, 3.6, 1.2].map((d, i) => planting(`s${i}`, d)) });
    expect(of(s, "sprout").map((p) => p.branch)).toEqual([true, true, false, false, false]);
  });
  it("pruning never un-branches (Review Focus 3): flags come from the full history, leaves from the kept set", () => {
    const g = { ...base, wateredAt: NOW, plantings: [40, 30, 20, 10, 5].map((d, i) => planting(`s${i}`, d)), skrPutInRaw: 400n, skrPrincipalPickedRaw: 300n };
    const s = buildScene(g);
    expect(of(s, "pruned")[0].count).toBe(3);   // ceil(300 / 700 · 5)
    expect(of(s, "sprout").map((p) => p.id)).toEqual(["s0", "s1"]);
    expect(of(s, "sprout")[0]).toMatchObject({ id: "s0", branch: true });
  });
  it("a principal pick prunes in proportion, at least one, never the last; a fruit-only pick prunes nothing (RECONCILED rule 6, carried from HEAD)", () => {
    const five = [40, 30, 20, 10, 5].map((d, i) => planting(`s${i}`, d));
    expect(of(buildScene({ ...base, wateredAt: NOW, plantings: five, skrPutInRaw: 1000n, skrPrincipalPickedRaw: 1n }), "pruned")[0].count).toBe(1);
    expect(of(buildScene({ ...base, wateredAt: NOW, plantings: five, skrPutInRaw: 1n, skrPrincipalPickedRaw: 1000n }), "sprout")).toHaveLength(1);
    expect(of(buildScene({ ...base, wateredAt: NOW, plantings: five, skrPutInRaw: 400n, skrPickedRaw: 300n }), "pruned")).toHaveLength(0);
  });
  it("after the next coin's first planting its change is a swelling on that plant; with a fresh bud at the growth point the swelling still shows (the renderer seats it above)", () => {
    const s = buildScene({ ...base, wateredAt: NOW, plantings: [planting("a", 3)], pendingCents: 57, nextAsset: "SKR" });
    expect(of(s, "seed")).toHaveLength(0);
    expect(of(s, "swelling")[0]).toEqual({ kind: "swelling", plant: "skr", progress: 0.285 });
  });
});

describe("buildScene: earned, pups, rings, the basket (RG16, RG20, RG11)", () => {
  it("token fruit per coin from its ladder, only once the plant has an open shoot; the next one ripens", () => {
    const s = buildScene({ ...base, wateredAt: NOW, plantings: [planting("a", 9), planting("b", 8, "cbBTC")], earned: { SKR: { count: 2, progress: 0.3 }, cbBTC: fruitLadder(0.03, 200) } });
    expect(of(s, "fruit").map((f) => [f.plant, f.index])).toEqual([["skr", 0], ["skr", 1], ["cbbtc", 0], ["cbbtc", 1]]);   // 1.5 percent is two steps
    expect(of(s, "ripening").map((r) => r.plant)).toEqual(["skr", "cbbtc"]);
  });
  it("a garden of closed buds shows no fruit until it is watered; a transplant alone holds none (R82)", () => {
    expect(of(buildScene({ ...base, plantings: [planting("a", 1)], earned: { SKR: { count: 1, progress: 0 } } }), "fruit")).toHaveLength(0);
    expect(of(buildScene({ ...base, joinedValueRaw: 5n, earned: { SKR: { count: 1, progress: 0 } } }), "fruit")).toHaveLength(0);
  });
  it("stORE's pups come by count (RG20): one per six plantings past seven, at most four", () => {
    const many = Array.from({ length: 20 }, (_, i) => planting(`o${i}`, 300 - i * 10, "stORE"));
    expect(of(buildScene({ ...base, wateredAt: NOW, plantings: many }), "pup").map((p) => p.index)).toEqual([0, 1]);
    expect(of(buildScene({ ...base, wateredAt: NOW, plantings: many.slice(0, 7) }), "pup")).toHaveLength(0);
  });
  it("one ring per present plant after a watering, fading over the day (Review Focus 5)", () => {
    const s = buildScene({ ...base, wateredAt: new Date(NOW.getTime() - 6 * 3_600_000), plantings: [planting("a", 2), planting("b", 2, "hSOL")], allocation: BALANCED });
    expect(of(s, "ring").map((r) => [r.plant, r.age])).toEqual([["skr", 0.25], ["hsol", 0.25]]);
    expect(of(buildScene({ ...base, wateredAt: new Date(NOW.getTime() - 2 * 86_400_000), plantings: [planting("a", 3)] }), "ring")).toHaveLength(0);
  });
  it("the basket and the transplant are drawn as today", () => {
    const s = buildScene({ ...base, joinedValueRaw: 7n, basket: { amountRaw: 3n, readyAt: NOW } });
    expect(of(s, "transplant")).toHaveLength(1); expect(of(s, "basket")).toHaveLength(1); expect(of(s, "plant")[0]).toMatchObject({ plant: "skr", x: 0.4 });
  });
  it("PLANT_OF maps every asset", () => expect(Object.values(PLANT_OF)).toEqual(["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"]));
});
