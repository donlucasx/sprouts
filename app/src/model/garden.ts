import type { LiveAsset, Split } from "@/lib/coins";
import { ROW_OF, signSide, slotsFor } from "./layout";
import { branchFlags, pupsByCount, stageOf } from "./plant-geometry";
import { PLANT_SPECIES, type Band, type PlantId, type Species, type Stage } from "./species";
export type { PlantId } from "./species";

export type GardenInput = {
  now: Date; wateredAt: Date | null;
  /** R249: the plants the last watering opened (the app records them as it waters, lib/last-watering.ts); absent (another phone's
   * watering, the widget before a record), the plants planted in the week before it stand for them (a bud seldom waits longer). */
  wateredPlants?: PlantId[] | null;
  plantings: { id: string; ts: Date; asset: LiveAsset; amountOutRaw: bigint; usdcInCents: number }[];
  picks: { ts: Date; asset: LiveAsset; amountRaw: bigint }[];
  skrPutInRaw: bigint; skrEarnedRaw: bigint; skrPickedRaw: bigint; skrPrincipalPickedRaw: bigint;   // principal withdrawn prunes; fruit picked does not [A13]
  pendingCents: number;              // change waiting: seeds beside the next coin's sign before its first planting, then the swelling on its plant (RG9)
  thresholdCents: number;
  nextAsset?: LiveAsset;                 // the coin the next planting buys (/api/me nextPlanting.asset)
  allocation: Split;                 // today's split, rules.allocation in both manager modes (spec 5): a coin with a share gets a sign
  earned: Partial<Record<LiveAsset, { count: number; progress: number }>>;   // token-fruit per coin (RG16): the count on the ladder and the next one's progress
  storePutInRaw: bigint; joinedValueRaw: bigint;
  basket: { amountRaw: bigint; readyAt: Date } | null;
};

export const PLANT_ORDER: readonly PlantId[] = ["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"] as const;
export const PLANT_OF: Record<LiveAsset, PlantId> = { SKR: "skr", stORE: "ore", USDC_LEND: "jitosol", SOL_LEND: "jupsol", hSOL: "hsol", cbBTC: "cbbtc" };
export const ASSET_OF: Record<PlantId, LiveAsset> = { skr: "SKR", ore: "stORE", hsol: "hSOL", jitosol: "USDC_LEND", jupsol: "SOL_LEND", cbbtc: "cbBTC" };

/** RG4: small under $1, usual $1 to $5, large over $5; a 0 (a legacy row with no leg) reads usual, never small. */
export const bandOf = (usdcInCents: number): Band => (usdcInCents <= 0 ? 1 : usdcInCents < 100 ? 0 : usdcInCents <= 500 ? 1 : 2);

/** The earned ladder every coin shares (R59, spec 10): the first token at 0.25% of put in, then one per further 1%, at most 12. */
export function fruitLadder(earnedUsd: number, putInCents: number): { count: number; progress: number } {
  if (putInCents <= 0 || earnedUsd <= 0) return { count: 0, progress: 0 };
  const ratio = earnedUsd / (putInCents / 100);
  if (ratio < 0.0025) return { count: 0, progress: ratio / 0.0025 };
  const steps = Math.floor((ratio - 0.0025) / 0.01 + 1e-9);   // an epsilon keeps 1.25% from reading as just under the second step
  const count = Math.min(12, 1 + steps);
  if (count >= 12) return { count: 12, progress: 0 };
  const into = Math.max(0, (ratio - 0.0025) - (count - 1) * 0.01);
  return { count, progress: Math.min(1, into / 0.01) };
}

export type Part =
  | { kind: "soil" }
  | { kind: "plant"; plant: PlantId; species: Species; row: "front" | "back"; x: number; shoots: number }
  | { kind: "sign"; plant: PlantId; row: "front" | "back"; x: number; side: -1 | 1 }
  | { kind: "seed"; id: string; plant: PlantId; index: number }
  | { kind: "sprout"; id: string; plant: PlantId; slot: number; stage: Stage; bud: boolean; band: Band; branch: boolean; ageDays: number }   // branch = RG19's state over the full history; the geometry decides what is drawn (the mandarin draws the eight lowest)
  | { kind: "swelling"; plant: PlantId; progress: number }
  | { kind: "fruit"; plant: PlantId; index: number }
  | { kind: "ripening"; plant: PlantId; progress: number }
  | { kind: "ring"; plant: PlantId; age: number }
  | { kind: "pup"; plant: "ore"; index: number }
  | { kind: "transplant"; plant: "skr"; sizeRaw: bigint }
  | { kind: "basket"; amountRaw: bigint; readyAt: Date }
  | { kind: "pruned"; count: number };
/** R96: `canReady` is the can. It is ready when a bud waits and resting otherwise; there is no clock. */
export type Scene = { parts: Part[]; unrevealed: number; canReady: boolean };

const DAY = 86_400_000;

/**
 * The scene from the user's own history (R55: parts assembled from history, never a fixed set of paintings). Two rows with the
 * locked slots (RG6, RG17, RG22), a sign per coin with a planting or a share (RG7), seeds beside the next coin's sign before its
 * first planting and then a swelling on its plant (RG9), every kept planting a shoot with its band (RG4) and its branch flag from the
 * FULL history (RG19, never un-branched by a prune), token fruit per coin (RG16), stORE's pups by count (RG20), one ring per present
 * plant after a watering (RG11). Nothing falls or rots; a price drop changes dollar numbers, never the plant.
 */
export function buildScene(g: GardenInput): Scene {
  const parts: Part[] = [{ kind: "soil" }];
  const wateredAt = g.wateredAt;
  const isUnrevealed = (ts: Date) => wateredAt === null || ts.getTime() > wateredAt.getTime();
  let unrevealed = 0;
  if (g.joinedValueRaw > 0n) parts.push({ kind: "transplant", plant: "skr", sizeRaw: g.joinedValueRaw });

  // Pruning [A13]: a principal withdrawal removes SKR sprouts in proportion to the share of what was put in, at least one, never the
  // last one, oldest last (RECONCILED rule 6). Fruit picked prunes nothing.
  const sorted = [...g.plantings].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const skrPlantings = sorted.filter((p) => p.asset === "SKR");
  let prune = 0;
  if (g.skrPrincipalPickedRaw > 0n && g.skrPutInRaw + g.skrPrincipalPickedRaw > 0n && skrPlantings.length > 1) {
    const share = Number((g.skrPrincipalPickedRaw * 10_000n) / (g.skrPutInRaw + g.skrPrincipalPickedRaw)) / 10_000;
    prune = Math.min(skrPlantings.length - 1, Math.max(1, Math.ceil(share * skrPlantings.length)));
  }
  const kept = new Set(skrPlantings.slice(0, skrPlantings.length - prune).map((p) => p.id));
  if (prune > 0) parts.push({ kind: "pruned", count: prune });

  const coin = (a: LiveAsset): PlantId => PLANT_OF[a];
  const fullOf = (c: PlantId) => sorted.filter((p) => coin(p.asset) === c);                       // the full history (RG19's flags)
  const keptOf = (c: PlantId) => fullOf(c).filter((p) => p.asset !== "SKR" || kept.has(p.id));     // what is drawn
  const present = PLANT_ORDER.filter((c) => keptOf(c).length > 0 || (c === "skr" && g.joinedValueRaw > 0n));
  const withSign = PLANT_ORDER.filter((c) => present.includes(c) || (g.allocation[ASSET_OF[c]] ?? 0) > 0);
  const xs = slotsFor([...withSign]);
  // R237 fix (10-04): a stake takes the side with more room in ITS OWN row; a front plant never meets a back stake (the rows pass in
  // front of each other), and counting it put JitoSOL's stake into the narrow JitoSOL to JupSOL gap beside JupSOL's
  const rowX = (c: PlantId) => withSign.filter((o) => ROW_OF[o] === ROW_OF[c]).map((o) => xs[o]!);
  for (const c of present) parts.push({ kind: "plant", plant: c, species: PLANT_SPECIES[c], row: ROW_OF[c], x: xs[c]!, shoots: keptOf(c).length });
  for (const c of withSign) parts.push({ kind: "sign", plant: c, row: ROW_OF[c], x: xs[c]!, side: signSide(xs[c]!, rowX(c), 1) });

  // RG9, R89: change waiting is seeds beside the NEXT coin's sign while that coin has no plant, else a swelling on its plant. The
  // API always serves nextPlanting.asset (me/route.ts:83); with it absent (a fixture) pending change draws nothing.
  const next = g.nextAsset ? coin(g.nextAsset) : null;
  if (g.pendingCents > 0 && next) {
    if (present.includes(next)) parts.push({ kind: "swelling", plant: next, progress: Math.min(1, g.pendingCents / Math.max(1, g.thresholdCents)) });
    else if (withSign.includes(next)) { const seeds = Math.min(8, Math.floor(g.pendingCents / 25)); for (let i = 0; i < seeds; i++) parts.push({ kind: "seed", id: `seed${i}`, plant: next, index: i }); }
  }

  const hostsOf = new Map<PlantId, number>();   // open shoots per plant (fruit waits for the watering, R82)
  for (const c of present) {
    const full = fullOf(c), flags = branchFlags(full.map((p) => ({ opened: !isUnrevealed(p.ts) })));
    let slot = 0;
    full.forEach((p, i) => {
      if (p.asset === "SKR" && !kept.has(p.id)) return;
      const bud = isUnrevealed(p.ts); if (bud) unrevealed++; else hostsOf.set(c, (hostsOf.get(c) ?? 0) + 1);
      const ageDays = (g.now.getTime() - p.ts.getTime()) / DAY;
      parts.push({ kind: "sprout", id: p.id, plant: c, slot: slot++, stage: stageOf(ageDays), bud, band: bandOf(p.usdcInCents), branch: flags[i], ageDays });
    });
  }
  // RG16: token fruit per coin from its ladder, on a plant with an open shoot; the next one ripens. RG20: stORE's pups by count.
  for (const c of present) {
    const e = g.earned[ASSET_OF[c]];
    if (!e || (hostsOf.get(c) ?? 0) === 0) continue;
    for (let i = 0; i < e.count; i++) parts.push({ kind: "fruit", plant: c, index: i });
    if (e.progress > 0) parts.push({ kind: "ripening", plant: c, progress: e.progress });
  }
  if (present.includes("ore")) for (let i = 0; i < pupsByCount(keptOf("ore").length); i++) parts.push({ kind: "pup", plant: "ore", index: i });
  if (g.basket) parts.push({ kind: "basket", amountRaw: g.basket.amountRaw, readyAt: g.basket.readyAt });
  // RG11: one ring under every present plant after a watering, fading over the day.
  // R249 (10-04, "should ONLY the plants who need the watering / have a bud ready get the soil wet underneath?", ruled yes): only
  // under the plants that watering opened, not every present plant
  if (wateredAt !== null) {
    const age = (g.now.getTime() - wateredAt.getTime()) / DAY;
    const opened = g.wateredPlants ?? [...new Set(sorted.filter((p) => p.ts.getTime() <= wateredAt.getTime() && p.ts.getTime() > wateredAt.getTime() - 7 * DAY).map((p) => coin(p.asset)))];
    if (age < 1) for (const c of present) if (opened.includes(c)) parts.push({ kind: "ring", plant: c, age });
  }
  // R96: the can is ready when a bud waits, resting otherwise; there is no clock.
  return { parts, unrevealed, canReady: unrevealed > 0 };
}
