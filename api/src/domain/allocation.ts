export type Asset = "SKR" | "stORE";

export type Ledger = { SKR: number; stORE: number };

/**
 * One asset per planting. The ledger holds the cents delivered per asset so far; the target is the user's split in percent.
 * Always plant the asset whose delivered share sits furthest below its target, so the split is honored over time.
 */
export function pickAsset(ledger: Ledger, target: Ledger): Asset {
  if (target.stORE <= 0) return "SKR";
  if (target.SKR <= 0) return "stORE";
  const total = ledger.SKR + ledger.stORE;
  if (total === 0) return target.SKR >= target.stORE ? "SKR" : "stORE";
  const gapSKR = target.SKR / 100 - ledger.SKR / total;
  const gapStORE = target.stORE / 100 - ledger.stORE / total;
  return gapStORE > gapSKR ? "stORE" : "SKR";
}
