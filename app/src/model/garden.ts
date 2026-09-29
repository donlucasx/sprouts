export type GardenInput = {
  now: Date; wateredAt: Date | null;
  plantings: { id: string; ts: Date; asset: "SKR" | "stORE"; amountOutRaw: bigint }[];
  picks: { ts: Date; asset: "SKR" | "stORE"; amountRaw: bigint }[];
  skrPutInRaw: bigint; skrEarnedRaw: bigint; skrFruit: number; skrNextFruitProgress: number;
  skrPickedRaw: bigint; skrPrincipalPickedRaw: bigint;   // principal withdrawn prunes; fruit picked does not [A13]
  pendingCents: number;                                    // change waiting to be planted: seeds on the soil (R54) [A23]
  storePutInRaw: bigint; storePups: number; storeNextPupProgress: number;
  joinedValueRaw: bigint;
  basket: { amountRaw: bigint; readyAt: Date } | null;
};

export type Part =
  | { kind: "soil" }
  | { kind: "seed"; id: string; x: number }
  | { kind: "sprout"; id: string; plant: "skr" | "ore"; x: number; y: number; stage: 0 | 1 | 2 | 3; bud: boolean; sizeRaw: bigint }
  | { kind: "transplant"; plant: "skr"; sizeRaw: bigint }
  | { kind: "fruit"; index: number; plant: "skr" | "ore"; ripe: true; bud: boolean; on: string | null }   // on: the sprout it hangs from; ORE pups sit on the soil (null)
  | { kind: "ripening"; plant: "skr" | "ore"; progress: number; on: string }
  | { kind: "basket"; amountRaw: bigint; readyAt: Date }
  | { kind: "wetSpot"; age: number }
  | { kind: "pruned"; count: number };

export type Scene = { parts: Part[]; unrevealed: number; wateredToday: boolean };

const DAY = 86_400_000;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** A sprout's stage by age: it grows for a month, then holds; the plant reads as history, oldest largest. */
function stageOf(ageMs: number): 0 | 1 | 2 | 3 {
  const days = ageMs / DAY;
  return days < 3 ? 0 : days < 10 ? 1 : days < 30 ? 2 : 3;
}

/** A deterministic spread along the soil from the planting id, so the same garden always draws the same way. */
function hashX(id: string): number {
  let h = 7;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return 0.08 + (h / 1000) * 0.84;
}

/**
 * The scene from the user's own history (R55: parts assembled from history, never a fixed set of paintings).
 * Everything that happened after the last watering is a bud (the reveal); watering today opens it all and leaves a wet spot.
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

  // Change waiting to be planted shows as seeds on the soil (R54): one per 25 cents, up to eight.
  const seeds = Math.min(8, Math.floor(g.pendingCents / 25));
  for (let i = 0; i < seeds; i++) parts.push({ kind: "seed", id: `seed${i}`, x: 0.15 + i * 0.09 });

  for (const p of g.plantings) {
    if (p.asset === "SKR" && !kept.has(p.id)) continue;
    const bud = isUnrevealed(p.ts);
    if (bud) unrevealed++;
    parts.push({ kind: "sprout", id: p.id, plant: p.asset === "SKR" ? "skr" : "ore", x: hashX(p.id), y: 0, stage: stageOf(g.now.getTime() - p.ts.getTime()), bud, sizeRaw: p.amountOutRaw });
  }

  // Fruit come from the pot's count (never from a market price); the next one swells with each reward event. A fruit that appeared
  // since the last watering is drawn as a fruit in this plan and the ripening bud carries the reveal (RECONCILED rule 4; Plan 3 refines it
  // with the fruit's appearance times from the daily reads). Fruit and the ripening bud hang on an open sprout, the largest first; a
  // closed bud or the transplant (R82) holds none, so with no open sprout they wait for the watering (09-29: it floated mid-air).
  const hosts = (plant: "skr" | "ore") => parts
    .filter((p): p is Extract<Part, { kind: "sprout" }> => p.kind === "sprout" && p.plant === plant && !p.bud)
    .sort((a, b) => b.stage - a.stage)
    .map((p) => p.id);
  const skrHosts = hosts("skr");
  if (skrHosts.length > 0) {
    for (let i = 0; i < g.skrFruit; i++) parts.push({ kind: "fruit", index: i, plant: "skr", ripe: true, bud: false, on: skrHosts[i % skrHosts.length] });
    if (g.skrPutInRaw > 0n) parts.push({ kind: "ripening", plant: "skr", progress: g.skrNextFruitProgress, on: skrHosts[0] });
  }
  for (let i = 0; i < g.storePups; i++) parts.push({ kind: "fruit", index: i, plant: "ore", ripe: true, bud: false, on: null });
  const oreHosts = hosts("ore");
  if (g.storePutInRaw > 0n && oreHosts.length > 0) parts.push({ kind: "ripening", plant: "ore", progress: g.storeNextPupProgress, on: oreHosts[0] });

  if (g.basket) parts.push({ kind: "basket", amountRaw: g.basket.amountRaw, readyAt: g.basket.readyAt });

  const wateredToday = wateredAt !== null && sameDay(wateredAt, g.now);
  if (wateredAt !== null) {
    const age = Math.min(1, (g.now.getTime() - wateredAt.getTime()) / DAY);
    if (age < 1) parts.push({ kind: "wetSpot", age });
  }
  return { parts, unrevealed, wateredToday };
}
