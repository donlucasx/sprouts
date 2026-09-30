import { describe, it, expect } from "vitest";
import { buildScene, type GardenInput } from "@/model/garden";

const NOW = new Date("2026-10-04T12:00:00-07:00");
const base: GardenInput = {
  now: NOW, wateredAt: null, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrFruit: 0, skrNextFruitProgress: 0,
  skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200,
  storePutInRaw: 0n, storePups: 0, storeNextPupProgress: 0, joinedValueRaw: 0n, basket: null,
};
const planting = (id: string, daysAgo: number, raw: bigint, asset: "SKR" | "stORE" = "SKR") => ({ id, ts: new Date(NOW.getTime() - daysAgo * 86_400_000), asset, amountOutRaw: raw });
const kinds = (s: ReturnType<typeof buildScene>) => s.parts.map((p) => p.kind);

describe("buildScene", () => {
  it("zero is soil (R54)", () => {
    expect(kinds(buildScene(base))).toEqual(["soil"]);
  });

  it("one growth event per planting: three plantings are three sprouts, oldest largest (R55)", () => {
    const s = buildScene({ ...base, plantings: [planting("a", 30, 266_000_000n), planting("b", 8, 12_000_000n), planting("c", 1, 266_000_000n)], wateredAt: NOW });
    const sprouts = s.parts.filter((p) => p.kind === "sprout");
    expect(sprouts.length).toBe(3);
    expect(sprouts.map((p) => (p as { stage: number }).stage)).toEqual([3, 1, 0]);
  });

  // Review Focus 5: growth since the last watering is buds until watered.
  it("unwatered plantings are buds; watering today opens them", () => {
    const watered = new Date(NOW.getTime() - 5 * 86_400_000);
    const before = buildScene({ ...base, wateredAt: watered, plantings: [planting("a", 8, 1n), planting("b", 2, 1n), planting("c", 1, 1n)] });
    expect(before.unrevealed).toBe(2);
    expect(before.parts.filter((p) => p.kind === "sprout" && (p as { bud: boolean }).bud).length).toBe(2);
    const after = buildScene({ ...base, wateredAt: NOW, plantings: [planting("a", 8, 1n), planting("b", 2, 1n), planting("c", 1, 1n)] });
    expect(after.unrevealed).toBe(0);
    expect(after.wateredToday).toBe(true);
    expect(kinds(after)).toContain("wetSpot");
  });

  it("fruit are drawn from the count, the next one ripens, and a bud hides a fruit that appeared since watering", () => {
    const s = buildScene({ ...base, wateredAt: new Date(NOW.getTime() - 3 * 86_400_000), plantings: [planting("a", 8, 1n)], skrPutInRaw: 100n, skrEarnedRaw: 2n, skrFruit: 2, skrNextFruitProgress: 0.4 });
    expect(s.parts.filter((p) => p.kind === "fruit").length).toBe(2);
    expect((s.parts.find((p) => p.kind === "ripening") as { progress: number }).progress).toBe(0.4);
  });

  // 09-29 Saga: the ripening bud was drawn at a fixed spot mid-air over a garden whose only sprout was still a closed bud.
  // Fruit and the ripening bud hang on an open plant, the largest first; with no open plant they wait for the watering.
  it("fruit and the ripening bud hang on the largest open sprout", () => {
    const s = buildScene({ ...base, wateredAt: new Date(NOW.getTime() - 3 * 86_400_000), plantings: [planting("small", 4, 1n), planting("big", 20, 1n)], skrPutInRaw: 100n, skrFruit: 1, skrNextFruitProgress: 0.3 });
    expect((s.parts.find((p) => p.kind === "ripening") as { on: string }).on).toBe("big");
    expect((s.parts.find((p) => p.kind === "fruit") as { on: string }).on).toBe("big");
  });

  it("a garden of closed buds shows no fruit and no ripening bud until it is watered", () => {
    const s = buildScene({ ...base, wateredAt: null, plantings: [planting("a", 0, 1n)], skrPutInRaw: 100n, skrFruit: 1, skrNextFruitProgress: 0 });
    expect(kinds(s)).not.toContain("ripening");
    expect(kinds(s)).not.toContain("fruit");
  });

  it("a transplanted plant never holds the fruit (R82): with no open sprout the ripening bud waits", () => {
    const s = buildScene({ ...base, wateredAt: NOW, joinedValueRaw: 5n, skrPutInRaw: 100n, skrFruit: 0, skrNextFruitProgress: 0.5 });
    expect(kinds(s)).not.toContain("ripening");
  });

  // 09-29 Saga: the soil was watered at the centre while the sprout that opened stood at the side.
  it("the wet spot lands under the newest sprout, the one the watering just opened", () => {
    const s = buildScene({ ...base, wateredAt: NOW, plantings: [planting("old", 20, 1n), planting("new", 0.1, 1n)] });
    const newest = s.parts.find((p) => p.kind === "sprout" && p.id === "new") as { x: number };
    expect((s.parts.find((p) => p.kind === "wetSpot") as { x: number }).x).toBe(newest.x);
  });

  it("with no sprout the wet spot stays at the centre", () => {
    const s = buildScene({ ...base, wateredAt: NOW });
    expect((s.parts.find((p) => p.kind === "wetSpot") as { x: number }).x).toBe(0.5);
  });

  // R89 (09-29): one plant per coin; every planting is a new shoot on it, oldest lowest.
  it("every SKR planting is a shoot on the one SKR plant, oldest lowest (R89)", () => {
    const s = buildScene({ ...base, wateredAt: NOW, plantings: [planting("c", 1, 1n), planting("a", 30, 1n), planting("b", 8, 1n)] });
    const plants = s.parts.filter((p) => p.kind === "plant") as { plant: string; x: number; shoots: number }[];
    expect(plants).toEqual([{ kind: "plant", plant: "skr", x: 0.4, shoots: 3 }]);
    const shoots = s.parts.filter((p) => p.kind === "sprout") as { id: string; x: number; y: number }[];
    expect(shoots.every((p) => p.x === 0.4)).toBe(true);
    expect(shoots.sort((p, q) => p.y - q.y).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("ORE grows its own plant beside the SKR one (R89)", () => {
    const s = buildScene({ ...base, wateredAt: NOW, plantings: [planting("s", 3, 1n), planting("o", 2, 1n, "stORE")] });
    expect((s.parts.filter((p) => p.kind === "plant") as { plant: string; x: number }[]).map((p) => [p.plant, p.x])).toEqual([["skr", 0.4], ["ore", 0.64]]);
  });

  it("after the first planting, waiting change is one bud forming on the plant, not seeds (R89)", () => {
    const s = buildScene({ ...base, wateredAt: NOW, plantings: [planting("a", 3, 1n)], pendingCents: 57, thresholdCents: 200 });
    expect(kinds(s)).not.toContain("seed");
    expect(s.parts.find((p) => p.kind === "forming")).toEqual({ kind: "forming", plant: "skr", progress: 0.285 });
  });

  it("before the first planting the seeds gather at the plant's base", () => {
    const seeds = buildScene({ ...base, pendingCents: 62 }).parts.filter((p) => p.kind === "seed") as { x: number }[];
    expect(seeds.length).toBe(2);
    expect(seeds.every((p) => Math.abs(p.x - 0.4) <= 0.06)).toBe(true);
  });

  it("a pre-existing position is a transplanted plant with no fruit (R61)", () => {
    const s = buildScene({ ...base, joinedValueRaw: 10_000_000_000n, wateredAt: NOW });
    expect(kinds(s)).toEqual(["soil", "transplant", "plant", "wetSpot"]);   // R89: the transplant is the SKR plant's base
    expect(kinds(s)).not.toContain("fruit");
  });

  it("a principal pick prunes sprouts in proportion, oldest last; a fruit-only pick prunes nothing (rule 6)", () => {
    const plantings = [planting("a", 30, 100n), planting("b", 20, 100n), planting("c", 10, 100n), planting("d", 5, 100n)];
    const fruitOnly = buildScene({ ...base, wateredAt: NOW, plantings, skrPutInRaw: 400n, skrEarnedRaw: 0n, skrPickedRaw: 4n, picks: [{ ts: NOW, asset: "SKR", amountRaw: 4n }] });
    expect(fruitOnly.parts.filter((p) => p.kind === "sprout").length).toBe(4);
    // 200 of the 400 that was put in: put in is now 200, principal picked 200, half the sprouts go, the newest first
    const principal = buildScene({ ...base, wateredAt: NOW, plantings, skrPutInRaw: 200n, skrEarnedRaw: 0n, skrPickedRaw: 200n, skrPrincipalPickedRaw: 200n, picks: [{ ts: NOW, asset: "SKR", amountRaw: 200n }] });
    expect(principal.parts.filter((p) => p.kind === "sprout").map((p) => (p as { id: string }).id)).toEqual(["a", "b"]);
    expect((principal.parts.find((p) => p.kind === "pruned") as { count: number }).count).toBe(2);
    // a small principal pick still removes one sprout, and the last sprout is never removed
    const small = buildScene({ ...base, wateredAt: NOW, plantings, skrPutInRaw: 380n, skrPrincipalPickedRaw: 20n, skrPickedRaw: 20n });
    expect(small.parts.filter((p) => p.kind === "sprout").length).toBe(3);
    const almostAll = buildScene({ ...base, wateredAt: NOW, plantings, skrPutInRaw: 10n, skrPrincipalPickedRaw: 390n, skrPickedRaw: 390n });
    expect(almostAll.parts.filter((p) => p.kind === "sprout").length).toBe(1);
  });

  it("change waiting to be planted shows as seeds on the soil, one per 25 cents, at most eight (R54)", () => {
    expect(buildScene({ ...base, pendingCents: 20 }).parts.filter((p) => p.kind === "seed").length).toBe(0);
    expect(buildScene({ ...base, pendingCents: 140 }).parts.filter((p) => p.kind === "seed").length).toBe(5);
    expect(buildScene({ ...base, pendingCents: 900 }).parts.filter((p) => p.kind === "seed").length).toBe(8);
  });

  it("the basket is drawn while a pick ripens; the succulent grows pups by the same rule", () => {
    const s = buildScene({ ...base, wateredAt: NOW, plantings: [planting("o", 3, 1n, "stORE")], storePutInRaw: 100n, storePups: 1, storeNextPupProgress: 0.1, basket: { amountRaw: 5n, readyAt: new Date(NOW.getTime() + 86_400_000) } });
    expect(kinds(s)).toContain("basket");
    expect(s.parts.filter((p) => p.kind === "sprout" && (p as { plant: string }).plant === "ore").length).toBe(1);
    expect(s.parts.filter((p) => p.kind === "fruit" && (p as { plant: string }).plant === "ore").length).toBe(1);
  });
});
