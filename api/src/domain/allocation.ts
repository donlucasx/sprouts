import { ASSETS, type Asset, type Split } from "./coins";

export type { Asset, Split } from "./coins";
export { DECIMALS } from "./coins";

/** Cents delivered per asset so far (the wallet's ledger); a missing key is zero. */
export type Ledger = Partial<Record<Asset, number>>;

/**
 * One asset per planting (spec 7.2). Among the coins the target wants, plant the one whose delivered share sits furthest below
 * its target, so the split is honored over time. From an empty ledger the largest target wins, SKR on ties.
 */
export function pickAsset(ledger: Ledger, target: Split): Asset {
  const wanted = ASSETS.filter((a) => target[a] > 0);
  if (wanted.length === 0) return "SKR";
  const total = wanted.reduce((s, a) => s + (ledger[a] ?? 0), 0);
  let best: Asset = wanted[0];
  let bestGap = -Infinity;
  for (const a of wanted) {
    const gap = total === 0 ? target[a] : target[a] / 100 - (ledger[a] ?? 0) / total;
    if (gap > bestGap) {
      best = a;
      bestGap = gap;
    }
  }
  return best;
}
