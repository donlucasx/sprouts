import { ASSETS, isLend, VENUE_NAME, type LiveAsset } from './coins'
import type { LendingPosition, MeResponse } from './api'
import { arrivalLine, COIN_NAME, formatSkr, holdingAmount, positionAmount } from './format'
import { livePositions } from './me-state'
import { POOL_FULL_LINE } from './lend-withdraw'

/** `label` (R171): what the row does. `position`: a lending position; its row opens its own withdraw screen like SKR's (R359). */
export type WithdrawRow = { key: string; asset: LiveAsset; label?: string; amount: string; note: string; opens: boolean; position?: LendingPosition }

/**
 * Withdraw's list (R159, named R171): SKR first (staked under the Seeker's key, the program's 48 hours), then each lending position with
 * a row that opens its own screen (R359: all or an amount, back to the wallet as USDC or SOL; a full pool says so), then every wallet coin with where it sits.
 */
export function withdrawRows(me: Pick<MeResponse, 'pot' | 'basket' | 'holdings' | 'positions'>, now: Date = new Date()): WithdrawRow[] {
  const staked = BigInt(me.pot.skrStakedRaw)
  const rows: WithdrawRow[] = []
  if (me.basket) rows.push({ key: 'SKR', asset: 'SKR', label: 'Withdraw SKR', amount: formatSkr(BigInt(me.basket.amountRaw), me.pot.skrUsd), note: `in the basket, ${arrivalLine(me.basket.readyAt, now)}`, opens: true })
  else if (staked > 0n) rows.push({ key: 'SKR', asset: 'SKR', label: 'Withdraw SKR', amount: formatSkr(staked, me.pot.skrUsd), note: 'locked to your Seeker, 48 hours to leave', opens: true })
  for (const asset of ASSETS) {
    const positions = isLend(asset) ? livePositions(me, asset) : []
    if (positions.length > 0) {
      for (const p of positions)
        rows.push({ key: `${asset}:${p.venue}`, asset, label: `Withdraw ${COIN_NAME[asset]} from ${VENUE_NAME[p.venue]}`, amount: positionAmount(p), note: p.poolFull ? POOL_FULL_LINE : `Back to your wallet as ${COIN_NAME[asset]}.`, opens: true, position: p })
      continue
    }
    const h = me.holdings.find((x) => x.asset === asset)
    if (h && asset !== 'SKR') rows.push({ key: asset, asset, amount: holdingAmount(h), note: 'in your wallet. Trade or send it from your wallet app.', opens: false })
  }
  return rows
}
