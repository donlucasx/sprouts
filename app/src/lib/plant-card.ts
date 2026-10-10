import type { MeResponse } from './api'
import type { LiveAsset } from './coins'
import { COIN_FULL_NAME } from './coin-names'
import { earnedLabel } from './coin-sheet'
import { formatUsd } from './format'
import { coinRows, type CoinRow } from './me-state'

/** What a tapped plant's card shows (Garden2 draws it, Home adds the coin's logo): Home's coin row in small, plus the next planting
 * when it is this coin's. */
export type PlantCard = {
  title: string
  /** Where the coin is: locked to the Seed Vault, the venue and rate, stORE's growth, in the wallet; or that nothing is planted yet. */
  where: string | null
  value: string | null
  earned: { text: string; positive: boolean } | null
  /** "Next planting: $0.40 of $1.00" while this coin's change builds up. */
  next: string | null
  /** The row the card's Details opens in the coin sheet; null for a coin with nothing in it. */
  row: CoinRow | null
}

/**
 * R587 (10-10, his note: cards should "have information the user actually cares about"): the coin's own numbers from the read Home's
 * list is drawn from (coinRows): its value and what it earned, where it is, and the change waiting for its next planting. Replaces
 * R250's label lines (the next fruit token is gone with R584, the bud to water with Garden2).
 */
export function plantCard(me: Pick<MeResponse, 'pot' | 'holdings' | 'positions' | 'nextPlanting'>, asset: LiveAsset): PlantCard {
  const row = coinRows(me).find((r) => r.asset === asset) ?? null
  const n = me.nextPlanting
  return {
    title: COIN_FULL_NAME[asset],
    where: row ? row.where : 'Nothing planted here yet',
    value: row ? (row.usd ?? row.qty) : null,
    earned: row ? earnedLabel(row.earnedUsd) : null,
    next: n.asset === asset && n.pendingCents > 0 ? `Next planting: ${formatUsd(n.pendingCents)} of ${formatUsd(n.thresholdCents)}` : null,
    row,
  }
}
