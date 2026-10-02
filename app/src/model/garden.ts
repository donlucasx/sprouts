import type { Asset, Split } from "@/lib/coins";
import { PLANT_SPECIES, type Band, type PlantId, type Species, type Stage } from "./species";
export type { PlantId } from "./species";

export type GardenInput = {
  now: Date; wateredAt: Date | null;
  plantings: { id: string; ts: Date; asset: Asset; amountOutRaw: bigint; usdcInCents: number }[];
  picks: { ts: Date; asset: Asset; amountRaw: bigint }[];
  skrPutInRaw: bigint; skrEarnedRaw: bigint; skrPickedRaw: bigint; skrPrincipalPickedRaw: bigint;   // principal withdrawn prunes; fruit picked does not [A13]
  pendingCents: number;              // change waiting: seeds beside the next coin's sign before its first planting, then the swelling on its plant (RG9)
  thresholdCents: number;
  nextAsset?: Asset;                 // the coin the next planting buys (/api/me nextPlanting.asset)
  allocation: Split;                 // today's split, rules.allocation in both manager modes (spec 5): a coin with a share gets a sign
  earned: Partial<Record<Asset, { count: number; progress: number }>>;   // token-fruit per coin (RG16): the count on the ladder and the next one's progress
  storePutInRaw: bigint; joinedValueRaw: bigint;
  basket: { amountRaw: bigint; readyAt: Date } | null;
};

export const PLANT_ORDER: readonly PlantId[] = ["skr", "ore", "hsol", "jitosol", "jupsol", "cbbtc"] as const;
export const PLANT_OF: Record<Asset, PlantId> = { SKR: "skr", stORE: "ore", hSOL: "hsol", JitoSOL: "jitosol", JupSOL: "jupsol", cbBTC: "cbbtc" };
export const ASSET_OF: Record<PlantId, Asset> = { skr: "SKR", ore: "stORE", hsol: "hSOL", jitosol: "JitoSOL", jupsol: "JupSOL", cbbtc: "cbBTC" };

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

/** Task C2 rewrites this against the new input and Part union; until then it returns the bare soil. */
export function buildScene(_g: GardenInput): Scene {
  void PLANT_SPECIES;   // kept imported for Task C2
  return { parts: [{ kind: "soil" }], unrevealed: 0, canReady: false };
}
