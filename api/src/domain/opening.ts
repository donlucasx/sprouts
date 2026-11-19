import { ASSETS, type LiveAsset, type Split } from "./coins";
import type { Ledger } from "./allocation";

/**
 * Season 11-23, slow opening: a user's first planting of a coin opens an account the puller pays rent for, so a user may hold at
 * most 1 + floor(plantedCents / 500) coin kinds, counted per USER across all wallets. A kind is open when any wallet's ledger has
 * its key (the key, whatever its value: it never closes). Users who already hold their coins change nothing.
 */
export const OPEN_STEP_CENTS = 500;

export type Opening = { open: LiveAsset[]; plantedCents: number; waiting: { asset: LiveAsset; afterCents: number }[] };

const has = (l: Ledger, k: string) => Object.prototype.hasOwnProperty.call(l, k);

/** open = live assets whose key exists in any ledger; plantedCents = sum of every value in every ledger (retired keys included);
 *  candidates = assets with target > 0 that are not open, sorted by target desc then ASSETS order; candidate i waits when
 *  (open.length + i) * 500 > plantedCents, with afterCents = (open.length + i) * 500. When no open asset has target > 0, the first
 *  candidate never waits (a user is never stalled) and the rest shift by one. */
export function coinOpening(ledgers: readonly Ledger[], target: Split): Opening {
  const open = ASSETS.filter((c) => ledgers.some((l) => has(l, c)));
  const plantedCents = ledgers.reduce((sum, l) => sum + Object.values(l).reduce<number>((s, v) => s + (Number.isFinite(v) ? (v as number) : 0), 0), 0);
  const candidates = ASSETS.filter((c) => target[c] > 0 && !open.includes(c)).sort((p, q) => target[q] - target[p] || ASSETS.indexOf(p) - ASSETS.indexOf(q));
  // Every open coin switched off or out today: the first candidate opens anyway. The rest keep their place behind it, so the
  // amount each waits for is the same before and after it opens (its open slot replaces its candidate slot).
  const stalled = !open.some((c) => target[c] > 0);
  const waiting = candidates.flatMap((asset, i) => {
    if (stalled && i === 0) return [];
    const afterCents = (open.length + i) * OPEN_STEP_CENTS;
    return afterCents > plantedCents ? [{ asset, afterCents }] : [];
  });
  return { open, plantedCents, waiting };
}
