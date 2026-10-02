import { ASSETS, type Asset } from './coins'
import type { Holding, MeResponse } from './api'
import { DECIMALS, formatAmount, formatSkr } from './format'

export type TakeOutRow = { asset: Asset; amount: string; note: string; opens: boolean }

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })
/** A holding's amount with its value: the unit price is the value over the amount. */
const heldAmount = (h: Holding) => formatAmount(h.asset, BigInt(h.heldRaw), h.valueUsd === null ? null : h.valueUsd / (Number(h.heldRaw) / 10 ** DECIMALS[h.asset]))

/**
 * Take out's list (R159): SKR first, the only coin that leaves through Sprouts (staked under the Seeker's key, the program's
 * 48 hours), then every wallet coin with where it sits; those rows open nothing, the user trades them from any wallet app.
 */
export function takeOutRows(me: Pick<MeResponse, 'pot' | 'basket' | 'holdings'>): TakeOutRow[] {
  const staked = BigInt(me.pot.skrStakedRaw)
  const rows: TakeOutRow[] = []
  if (me.basket) rows.push({ asset: 'SKR', amount: formatSkr(BigInt(me.basket.amountRaw), me.pot.skrUsd), note: `in the basket, arrives ${when(me.basket.readyAt)}`, opens: true })
  else if (staked > 0n) rows.push({ asset: 'SKR', amount: formatSkr(staked, me.pot.skrUsd), note: 'locked to your Seeker, 48 hours to leave', opens: true })
  for (const asset of ASSETS) {
    const h = me.holdings.find((x) => x.asset === asset)
    if (h) rows.push({ asset, amount: heldAmount(h), note: 'in your Seeker wallet. Trade or send it from your wallet app.', opens: false })
  }
  return rows
}
