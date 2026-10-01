import type { Asset } from "@/lib/coins";

export type GardenInput = {
  now: Date; wateredAt: Date | null;
  plantings: { id: string; ts: Date; asset: Asset; amountOutRaw: bigint }[];
  picks: { ts: Date; asset: Asset; amountRaw: bigint }[];
  skrPutInRaw: bigint; skrEarnedRaw: bigint; skrFruit: number; skrNextFruitProgress: number;
  skrPickedRaw: bigint; skrPrincipalPickedRaw: bigint;   // principal withdrawn prunes; fruit picked does not [A13]
  pendingCents: number;                                    // change waiting to be planted: seeds before the first planting (R54), then a bud forming (R89) [A23]
  thresholdCents: number;                                  // the planting threshold the forming bud swells toward
  nextAsset?: Asset;                                      // the coin the next planting buys (/api/me), so the bud forms on that plant
  storePutInRaw: bigint; storePups: number; storeNextPupProgress: number;
  joinedValueRaw: bigint;
  basket: { amountRaw: bigint; readyAt: Date } | null;
};

/** One plant per coin (R108), fixed order (spec 10). */
export type PlantId = "skr" | "ore" | "hsol" | "jitosol" | "jupsol" | "cbbtc";
export const PLANT_ORDER: readonly PlantId[] = ["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"] as const;
export const PLANT_OF: Record<Asset, PlantId> = { SKR: "skr", stORE: "ore", hSOL: "hsol", JitoSOL: "jitosol", JupSOL: "jupsol", cbBTC: "cbbtc" };

/**
 * Where each present plant stands, as a fraction of the scene's width: one alone at 0.4 (today), n spaced evenly about 0.52
 * with step min(0.24, 0.72 / (n - 1)), so two land at 0.4 and 0.64 and six fit a 320-wide scene 46 px apart.
 */
export function plantX(present: PlantId[]): Partial<Record<PlantId, number>> {
  const ids = PLANT_ORDER.filter((p) => present.includes(p));
  const out: Partial<Record<PlantId, number>> = {};
  if (ids.length === 1) out[ids[0]] = 0.4;
  else if (ids.length > 1) {
    const step = Math.min(0.24, 0.72 / (ids.length - 1));
    const first = 0.52 - (step * (ids.length - 1)) / 2;
    ids.forEach((p, i) => { out[p] = first + i * step; });
  }
  return out;
}

/** ORE pups by the SKR fruit rule's steps (spec 10): the first at 0.25% of put in, then one per further 1%, at most 12. */
export function pupLadder(earnedUsd: number, putInCents: number): { count: number; progress: number } {
  if (putInCents <= 0 || earnedUsd <= 0) return { count: 0, progress: 0 };
  const ratio = earnedUsd / (putInCents / 100);
  if (ratio < 0.0025) return { count: 0, progress: ratio / 0.0025 };
  // An epsilon keeps 1.25% from reading as "just under" the second step in binary floating point.
  const steps = Math.floor((ratio - 0.0025) / 0.01 + 1e-9);
  const count = Math.min(12, 1 + steps);
  if (count >= 12) return { count: 12, progress: 0 };
  const into = Math.max(0, (ratio - 0.0025) - (count - 1) * 0.01);
  return { count, progress: Math.min(1, into / 0.01) };
}

export type Part =
  | { kind: "soil" }
  | { kind: "plant"; plant: PlantId; x: number; shoots: number }   // R89: one plant per coin; shoots = the plantings it carries
  | { kind: "forming"; plant: PlantId; progress: number }          // R89: waiting change after the first planting, 0 to 1 of the threshold
  | { kind: "seed"; id: string; x: number }
  | { kind: "sprout"; id: string; plant: PlantId; x: number; y: number; stage: 0 | 1 | 2 | 3; bud: boolean; sizeRaw: bigint }
  | { kind: "transplant"; plant: "skr"; sizeRaw: bigint }
  | { kind: "fruit"; index: number; plant: PlantId; ripe: true; bud: boolean; on: string | null }   // on: the sprout it hangs from; ORE pups sit on the soil (null)
  | { kind: "ripening"; plant: PlantId; progress: number; on: string | null }   // on: the sprout it hangs from; the ORE pup forms on the soil (null)
  | { kind: "basket"; amountRaw: bigint; readyAt: Date }
  | { kind: "wetSpot"; age: number; x: number }   // x: under the newest OPENED sprout, the one the last watering revealed (0.5 with none)
  | { kind: "pruned"; count: number };

/** R96: `canReady` is the can. It is ready when a bud waits and resting otherwise; there is no clock. */
export type Scene = { parts: Part[]; unrevealed: number; canReady: boolean };

const DAY = 86_400_000;

/** A sprout's stage by age: it grows for a month, then holds; the plant reads as history, oldest largest. */
function stageOf(ageMs: number): 0 | 1 | 2 | 3 {
  const days = ageMs / DAY;
  return days < 3 ? 0 : days < 10 ? 1 : days < 30 ? 2 : 3;
}

/**
 * The scene from the user's own history (R55: parts assembled from history, never a fixed set of paintings).
 * Everything that happened after the last watering is a bud (the reveal); watering opens it all and leaves a wet spot for a day.
 * A principal withdrawal prunes sprouts in proportion to the share of the pot taken, oldest last (RECONCILED rule 6).
 * Nothing falls or rots; a price drop changes dollar numbers, never the plant.
 */
export function buildScene(g: GardenInput): Scene {
  const parts: Part[] = [{ kind: "soil" }];
  const wateredAt = g.wateredAt;
  const isUnrevealed = (ts: Date) => wateredAt === null || ts.getTime() > wateredAt.getTime();
  let unrevealed = 0;

  if (g.joinedValueRaw > 0n) parts.push({ kind: "transplant", plant: "skr", sizeRaw: g.joinedValueRaw });

  // Pruning [A13]: a principal withdrawal removes sprouts in proportion to the share of what was put in, at least one, never the
  // last one, oldest last (RECONCILED rule 6). Fruit picked prunes nothing. Put in after a principal pick is the lowered value,
  // so the share is taken over put in plus principal picked: what the plant was before.
  const skrPlantings = g.plantings.filter((p) => p.asset === "SKR");
  let prune = 0;
  if (g.skrPrincipalPickedRaw > 0n && g.skrPutInRaw + g.skrPrincipalPickedRaw > 0n && skrPlantings.length > 1) {
    const share = Number((g.skrPrincipalPickedRaw * 10_000n) / (g.skrPutInRaw + g.skrPrincipalPickedRaw)) / 10_000;
    prune = Math.min(skrPlantings.length - 1, Math.max(1, Math.ceil(share * skrPlantings.length)));
  }
  const kept = new Set(skrPlantings.slice(0, skrPlantings.length - prune).map((p) => p.id));
  if (prune > 0) parts.push({ kind: "pruned", count: prune });

  // R89: one plant per coin, every planting a shoot on it, the oldest lowest (y is the shoot's place on the stem, 0 at the bottom).
  const growing = [...g.plantings].filter((p) => p.asset !== "SKR" || kept.has(p.id)).sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const coin = (a: Asset): PlantId => PLANT_OF[a];
  const shootsOf = (c: PlantId) => growing.filter((p) => coin(p.asset) === c);
  // Spec 10: the present plants are every coin with a shoot, plus SKR for the transplant; their places are computed once.
  const present = PLANT_ORDER.filter((c) => shootsOf(c).length > 0 || (c === "skr" && g.joinedValueRaw > 0n));
  const hasPlant = (c: PlantId) => present.includes(c);
  const xs = plantX([...present]);
  for (const c of present) parts.push({ kind: "plant", plant: c, x: xs[c] ?? 0.4, shoots: shootsOf(c).length });

  if (present.length === 0) {
    // Before the first planting, waiting change is seeds at the plant's base (R54): one per 25 cents, up to eight.
    const seeds = Math.min(8, Math.floor(g.pendingCents / 25));
    for (let i = 0; i < seeds; i++) parts.push({ kind: "seed", id: `seed${i}`, x: (xs.skr ?? 0.4) + (i % 2 ? 1 : -1) * (0.015 + 0.012 * Math.floor(i / 2)) });
  } else if (g.pendingCents > 0) {
    // After it, one bud forms at the top of the plant and swells toward the threshold (R89, and his note: one thing filling up).
    const next = g.nextAsset ? PLANT_OF[g.nextAsset] : null;
    const plant = next && hasPlant(next) ? next : hasPlant("skr") ? "skr" : present[0];
    parts.push({ kind: "forming", plant, progress: Math.min(1, g.pendingCents / Math.max(1, g.thresholdCents)) });
  }

  for (const c of present) {
    shootsOf(c).forEach((p, slot) => {
      const bud = isUnrevealed(p.ts);
      if (bud) unrevealed++;
      parts.push({ kind: "sprout", id: p.id, plant: c, x: xs[c] ?? 0.4, y: slot, stage: stageOf(g.now.getTime() - p.ts.getTime()), bud, sizeRaw: p.amountOutRaw });
    });
  }

  // Fruit come from the pot's count (never from a market price); the next one swells with each reward event. A fruit that appeared
  // since the last watering is drawn as a fruit in this plan and the ripening bud carries the reveal (RECONCILED rule 4; Plan 3 refines it
  // with the fruit's appearance times from the daily reads). Fruit and the ripening bud hang on an open sprout, the largest first; a
  // closed bud or the transplant (R82) holds none, so with no open sprout they wait for the watering (09-29: it floated mid-air).
  const hosts = (plant: PlantId) => parts
    .filter((p): p is Extract<Part, { kind: "sprout" }> => p.kind === "sprout" && p.plant === plant && !p.bud)
    .sort((a, b) => b.stage - a.stage)
    .map((p) => p.id);
  const skrHosts = hosts("skr");
  if (skrHosts.length > 0) {
    for (let i = 0; i < g.skrFruit; i++) parts.push({ kind: "fruit", index: i, plant: "skr", ripe: true, bud: false, on: skrHosts[i % skrHosts.length] });
    if (g.skrPutInRaw > 0n) parts.push({ kind: "ripening", plant: "skr", progress: g.skrNextFruitProgress, on: skrHosts[0] });
  }
  // ORE pups sit on the soil beside the succulent, and the next one forms there too (09-30, the Saga: hung off a leaf, it floated);
  // it waits for the watering like the fruit, since the plant it belongs to is still a bud until then.
  for (let i = 0; i < g.storePups; i++) parts.push({ kind: "fruit", index: i, plant: "ore", ripe: true, bud: false, on: null });
  if (g.storePutInRaw > 0n && hosts("ore").length > 0) parts.push({ kind: "ripening", plant: "ore", progress: g.storeNextPupProgress, on: null });

  if (g.basket) parts.push({ kind: "basket", amountRaw: g.basket.amountRaw, readyAt: g.basket.readyAt });

  if (wateredAt !== null) {
    const age = Math.min(1, (g.now.getTime() - wateredAt.getTime()) / DAY);
    // At the foot of the newest OPENED sprout, the one the last watering revealed; never under a bud that landed after it
    // (09-29: it was always the centre; 09-30, the Saga: it sat under the closed ORE bud). With no open sprout, the SKR plant's foot.
    const opened = growing.filter((p) => !isUnrevealed(p.ts));
    const newest = opened[opened.length - 1];
    const x = newest ? xs[coin(newest.asset)] ?? 0.4 : hasPlant("skr") ? xs.skr ?? 0.4 : present.length > 0 ? xs[present[0]] ?? 0.4 : 0.5;
    if (age < 1) parts.push({ kind: "wetSpot", age, x });
  }
  // R96 (09-30): the can is ready when a bud waits, resting otherwise. The once-a-day lock was the build's reading of R55, never a
  // ruling, and it collided with the 14:00 UTC cron (watered before 7 AM PT, then that morning's planting: stuck all day).
  return { parts, unrevealed, canReady: unrevealed > 0 };
}
