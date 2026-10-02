import { ASSETS, type Asset } from './coins'
import type { MeResponse } from './api'
import { arrivalLine, formatSkr, holdingAmount } from './format'

/** `label` (R171): what the row does, on the rows that open the Withdraw flow ("Withdraw SKR"). */
export type WithdrawRow = { asset: Asset; label?: string; amount: string; note: string; opens: boolean }

/** A holding's amount with its value: the unit price is the value over the amount. */

/**
 * Withdraw's list (R159, named R171): SKR first, the only coin that leaves through Sprouts (staked under the Seeker's key, the program's
 * 48 hours), then every wallet coin with where it sits; those rows open nothing, the user trades them from any wallet app.
 */
export function withdrawRows(me: Pick<MeResponse, 'pot' | 'basket' | 'holdings'>, now: Date = new Date()): WithdrawRow[] {
  const staked = BigInt(me.pot.skrStakedRaw)
  const rows: WithdrawRow[] = []
  if (me.basket) rows.push({ asset: 'SKR', label: 'Withdraw SKR', amount: formatSkr(BigInt(me.basket.amountRaw), me.pot.skrUsd), note: `in the basket, ${arrivalLine(me.basket.readyAt, now)}`, opens: true })
  else if (staked > 0n) rows.push({ asset: 'SKR', label: 'Withdraw SKR', amount: formatSkr(staked, me.pot.skrUsd), note: 'locked to your Seeker, 48 hours to leave', opens: true })
  for (const asset of ASSETS) {
    const h = me.holdings.find((x) => x.asset === asset)
    if (h) rows.push({ asset, amount: holdingAmount(h), note: 'in your Seeker wallet. Trade or send it from your wallet app.', opens: false })
  }
  return rows
}
