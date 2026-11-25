import { ASSETS, isLend, VENUE_NAME, type LiveAsset } from './coins'
import type { LendingPosition, MeResponse } from './api'
import { arrivalParts, COIN_NAME, formatSkr, holdingAmount, positionAmount } from './format'
import { t } from '@/i18n'
import { livePositions } from './me-state'

/** `label` (R171): what the row does. `position`: a lending position; its row opens its own withdraw screen like SKR's (R359). */
export type WithdrawRow = { key: string; asset: LiveAsset; label?: string; amount: string; note: string; opens: boolean; position?: LendingPosition }

/**
 * Withdraw's list (R159, named R171): SKR first (staked under the Seeker's key, the program's 48 hours), then each lending position with
 * a row that opens its own screen (R359: all or an amount, back to the wallet as USDC or SOL; a full pool says so), then every wallet coin with where it sits.
 */
export function withdrawRows(me: Pick<MeResponse, 'pot' | 'basket' | 'holdings' | 'positions'>, now: Date = new Date()): WithdrawRow[] {
  const staked = BigInt(me.pot.skrStakedRaw)
  const rows: WithdrawRow[] = []
  if (me.basket) {
    const a = arrivalParts(me.basket.readyAt, now)
    rows.push({ key: 'SKR', asset: 'SKR', label: t('withdraw.skr'), amount: formatSkr(BigInt(me.basket.amountRaw), me.pot.skrUsd), note: a.today ? t('withdraw.row.basket.today') : t('withdraw.row.basket.arrives', { when: a.when }), opens: true })
  }
  else if (staked > 0n) rows.push({ key: 'SKR', asset: 'SKR', label: t('withdraw.skr'), amount: formatSkr(staked, me.pot.skrUsd), note: t('withdraw.row.locked'), opens: true })
  for (const asset of ASSETS) {
    const positions = isLend(asset) ? livePositions(me, asset) : []
    if (positions.length > 0) {
      for (const p of positions)
        rows.push({ key: `${asset}:${p.venue}`, asset, label: t('withdraw.row.lend', { coin: COIN_NAME[asset], venue: VENUE_NAME[p.venue] }), amount: positionAmount(p), note: p.poolFull ? t('lend.poolFull') : t('withdraw.row.backAs', { coin: COIN_NAME[asset] }), opens: true, position: p })
      continue
    }
    const h = me.holdings.find((x) => x.asset === asset)
    if (h && asset !== 'SKR') rows.push({ key: asset, asset, amount: holdingAmount(h), note: t('withdraw.row.wallet'), opens: false })
  }
  return rows
}
