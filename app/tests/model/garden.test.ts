import { describe, it, expect } from "vitest";
import { buildScene, plantX, PLANT_OF, pupLadder, type GardenInput } from "@/model/garden";
import type { Asset } from "@/lib/coins";

const NOW = new Date("2026-10-04T12:00:00-07:00");
const base: GardenInput = {
  now: NOW, wateredAt: null, plantings: [], picks: [], skrPutInRaw: 0n, skrEarnedRaw: 0n, skrFruit: 0, skrNextFruitProgress: 0,
  skrPickedRaw: 0n, skrPrincipalPickedRaw: 0n, pendingCents: 0, thresholdCents: 200,
  storePutInRaw: 0n, storePups: 0, storeNextPupProgress: 0, joinedValueRaw: 0n, basket: null,
};
const planting = (id: string, daysAgo: number, raw: bigint, asset: Asset = "SKR") => ({ id, ts: new Date(NOW.getTime() - daysAgo * 86_400_000), asset, amountOutRaw: raw });
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
    expect(after.canReady).toBe(false);
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

// Plan v2: the ORE succulent from a stORE leg, and the forming bud on the coin the next planting buys (audits/ore-plan, finding 14).
describe("the ORE plant", () => {
  const ore = planting("o", 2, 2_150_000_000n, "stORE");
  it("a stORE planting grows the ORE succulent with one shoot", () => {
    const s = buildScene({ ...base, plantings: [ore], wateredAt: NOW });
    expect(s.parts.filter((p) => p.kind === "plant")).toEqual([{ kind: "plant", plant: "ore", x: expect.any(Number), shoots: 1 }]);
    expect(s.parts.filter((p) => p.kind === "sprout" && p.plant === "ore").length).toBe(1);
  });
  // 09-30, the Saga after watering: the ORE plant's ripening pup hung 8 px off its leaf as a floating green dot. Pups live on the
  // soil beside the succulent (on: null, like the pups themselves), so the next one forms there; it still waits for the watering.
  it("the next pup ripens at the soil beside the succulent, never on a leaf", () => {
    const open = buildScene({ ...base, plantings: [ore], wateredAt: NOW, storePutInRaw: 100n, storeNextPupProgress: 0.1 });
    expect(open.parts.find((p) => p.kind === "ripening")).toEqual({ kind: "ripening", plant: "ore", progress: 0.1, on: null });
    const closed = buildScene({ ...base, plantings: [ore], wateredAt: null, storePutInRaw: 100n, storeNextPupProgress: 0.1 });
    expect(kinds(closed)).not.toContain("ripening");
  });
  it("the forming bud sits on the plant the next planting will grow", () => {
    const both = { ...base, plantings: [planting("a", 30, 266_000_000n), ore], wateredAt: NOW, pendingCents: 100 };
    const forming = (s: ReturnType<typeof buildScene>) => s.parts.find((p) => p.kind === "forming") as { plant: string } | undefined;
    expect(forming(buildScene({ ...both, nextAsset: "stORE" }))?.plant).toBe("ore");
    expect(forming(buildScene({ ...both, nextAsset: "SKR" }))?.plant).toBe("skr");
    expect(forming(buildScene(both))?.plant).toBe("skr");
  });
});

// R96 (09-30): the can is ready when a bud waits and resting otherwise; there is no clock (the once-a-day lock was the build's, never
// a ruling, and it collided with the 14:00 UTC cron: watered before 7 AM PT, then that morning's planting, stuck all day).
describe("the watering can (R96)", () => {
  it("is ready when a bud waits, whatever the time of day", () => {
    // watered at 07:00, the cron planted at 07:40: under the old rule the can stayed dead until tomorrow
    const watered = new Date(NOW.getTime() - 5 * 3_600_000);
    const s = buildScene({ ...base, wateredAt: watered, plantings: [planting("a", 8, 1n), planting("b", 0.18, 1n)] });
    expect(s.unrevealed).toBe(1);
    expect(s.canReady).toBe(true);
  });
  it("rests when nothing waits, even if it has not been used today", () => {
    const s = buildScene({ ...base, wateredAt: new Date(NOW.getTime() - 3 * 86_400_000), plantings: [planting("a", 8, 1n)] });
    expect(s.canReady).toBe(false);
  });
  it("is ready before the first watering, as soon as the first planting lands", () => {
    expect(buildScene({ ...base, wateredAt: null, plantings: [planting("a", 0.1, 1n)] }).canReady).toBe(true);
  });
  it("rests on bare soil", () => {
    expect(buildScene(base).canReady).toBe(false);
  });
  // 09-30, the Saga photo: watered at 10:10, the stORE planting landed at 11:40, and the wet spot sat under the closed ORE bud.
  it("the wet spot lands under the newest OPENED sprout, never under a bud that landed after the watering", () => {
    const watered = new Date(NOW.getTime() - 3_600_000);
    const s = buildScene({ ...base, wateredAt: watered, plantings: [planting("old", 20, 1n), planting("o", 0.01, 1n, "stORE")] });
    expect((s.parts.find((p) => p.kind === "wetSpot") as { x: number }).x).toBe(0.4);
  });
  it("with only buds and a transplant the wet spot sits at the SKR plant's foot", () => {
    const watered = new Date(NOW.getTime() - 3_600_000);
    const s = buildScene({ ...base, wateredAt: watered, joinedValueRaw: 5n, plantings: [planting("o", 0.01, 1n, "stORE")] });
    expect((s.parts.find((p) => p.kind === "wetSpot") as { x: number }).x).toBe(0.4);
  });
});

// Spec 10: one plant per coin, fixed order, spaced about 0.52; one alone at 0.4; two at today's 0.4 and 0.64.
describe("plantX", () => {
  it("one plant sits at 0.4", () => expect(plantX(["skr"])).toEqual({ skr: 0.4 }));
  it("two plants land at 0.4 and 0.64", () => expect(plantX(["skr", "ore"])).toEqual({ skr: 0.4, ore: 0.64 }));
  it("six plants are spaced evenly from 0.16 to 0.88", () => {
    const x = plantX(["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"]);
    expect(Object.values(x).map((v) => Math.round(v * 1000) / 1000)).toEqual([0.16, 0.304, 0.448, 0.592, 0.736, 0.88]);
  });
  it("keeps the fixed order whatever order the ids arrive in", () => {
    expect(Object.keys(plantX(["cbbtc", "skr"]))).toEqual(["skr", "cbbtc"]);
  });
});

describe("six plants in the scene", () => {
  it("a planting of each coin grows its own plant, in order, and the forming bud sits on nextAsset's plant", () => {
    const s = buildScene({
      ...base, wateredAt: NOW, pendingCents: 100, thresholdCents: 200, nextAsset: "cbBTC",
      plantings: [planting("a", 5, 1n, "SKR"), planting("b", 4, 1n, "hSOL"), planting("c", 3, 1n, "JitoSOL"), planting("d", 2, 1n, "JupSOL"), planting("e", 1, 1n, "cbBTC"), planting("f", 1, 1n, "stORE")],
    });
    const plants = s.parts.filter((p) => p.kind === "plant") as { plant: string; x: number }[];
    expect(plants.map((p) => p.plant)).toEqual(["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"]);
    expect(plants.map((p) => Math.round(p.x * 1000) / 1000)).toEqual([0.16, 0.304, 0.448, 0.592, 0.736, 0.88]);
    expect((s.parts.find((p) => p.kind === "forming") as { plant: string }).plant).toBe("cbbtc");
  });

  // Review Focus 4: the new plants carry no fruit in this build.
  it("fruit stays on SKR; a cbBTC plant with earned has none", () => {
    const s = buildScene({ ...base, wateredAt: NOW, plantings: [planting("a", 5, 1n, "cbBTC")], skrPutInRaw: 0n, skrFruit: 0 });
    expect(s.parts.filter((p) => p.kind === "fruit" || p.kind === "ripening").length).toBe(0);
  });

  it("PLANT_OF maps every asset", () => {
    expect(PLANT_OF).toEqual({ SKR: "skr", stORE: "ore", hSOL: "hsol", JitoSOL: "jitosol", JupSOL: "jupsol", cbBTC: "cbbtc" });
  });
});

// Spec 10: ORE pups follow the SKR fruit rule's steps: the first at 0.25% of put in, then one per further 1%, at most 12.
describe("pupLadder", () => {
  it("nothing below a quarter percent, the first at it, then one per percent, capped at 12", () => {
    // putInCents 200 is $2.00; earnedUsd is dollars.
    expect(pupLadder(0, 200)).toEqual({ count: 0, progress: 0 });
    expect(pupLadder(0.004, 200).count).toBe(0);
    expect(pupLadder(0.004, 200).progress).toBeCloseTo(0.8, 6);      // 0.2% of 0.25%
    expect(pupLadder(0.005, 200).count).toBe(1);                      // exactly 0.25%
    expect(pupLadder(0.005, 200).progress).toBeCloseTo(0, 6);
    expect(pupLadder(0.025, 200).count).toBe(2);                      // 1.25%: the first at 0.25%, one more at 1.25%
    expect(pupLadder(0.025, 200).progress).toBeCloseTo(0, 6);
    expect(pupLadder(0.03, 200).count).toBe(2);                       // 1.5%: a quarter of the way to the third
    expect(pupLadder(0.03, 200).progress).toBeCloseTo(0.25, 6);
    expect(pupLadder(10, 200).count).toBe(12);
  });
  it("is nothing when nothing was put in", () => expect(pupLadder(1, 0)).toEqual({ count: 0, progress: 0 }));
});

// Review fix: ORE pups wait for the watering like the fruit; no open ORE shoot, no pups and no ripening pup.
describe("ORE pups wait for an open ORE shoot", () => {
  const ore = (s: ReturnType<typeof buildScene>) => s.parts.filter((p) => (p.kind === "fruit" || p.kind === "ripening") && p.plant === "ore");
  it("a closed ORE bud hides the pups; once watered they show", () => {
    const watered = new Date(NOW.getTime() - 3 * 86_400_000);
    const closed = buildScene({ ...base, wateredAt: watered, plantings: [planting("o", 1, 1n, "stORE")], storePups: 2, storePutInRaw: 1n });
    expect(ore(closed).length).toBe(0);
    const open = buildScene({ ...base, wateredAt: NOW, plantings: [planting("o", 1, 1n, "stORE")], storePups: 2, storePutInRaw: 1n });
    expect(open.parts.filter((p) => p.kind === "fruit" && p.plant === "ore").length).toBe(2);
    expect(open.parts.filter((p) => p.kind === "ripening" && p.plant === "ore").length).toBe(1);
  });
});
