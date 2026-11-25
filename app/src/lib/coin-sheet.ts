import type { MeResponse } from './api'
import { formatUsd, plantedParts } from './format'
import { skrPutInCents, type CoinRow } from './me-state'
import { withdrawRows } from './withdraw-list'
import { IDLE_SKR_ROW_KEY } from './plant-skr'
import { dayMonth } from "@/i18n/format"
import { t } from '@/i18n'

/** R563: a row's earned as Home shows it, "+$0.03" (null when unknown); green only above zero (`positive`). */
export function earnedLabel(usd: number | null): { text: string; positive: boolean } | null {
  if (usd === null || !Number.isFinite(usd)) return null
  const cents = Math.round(usd * 100)
  return { text: `${cents < 0 ? '' : '+'}${formatUsd(cents)}`, positive: cents > 0 }
}

export type CoinSheet = {
  /** Put in, Earned, Where: label and value, Earned flagged for the green. */
  lines: { label: string; value: string; positive?: boolean }[]
  /** This coin's last plantings, newest first, at most three ("Oct 7: $1.00 became 0.0085 stORE"). */
  plantings: string[]
  /** Withdraw opens on this row (its withdraw key), on the list (null: a coin at several venues, R568), or is absent (undefined)
   * when the coin sits in the wallet and the sheet says so instead. */
  withdrawKey: string | null | undefined
  walletNote: string | null
}

/**
 * R564: what tapping a coin row on Home shows. Put in = the row's own (a holding or position), or for SKR its plantings' dollars
 * still staked (skrPutInCents, as Home's total); Earned = R563's; Where = locked / venue and rate / wallet; the coin's last three plantings (a lending row only its venue's
 * when the planting names one); Withdraw for what Sprouts can withdraw (withdraw-list), else the wallet line.
 */
export function coinSheet(me: Pick<MeResponse, 'pot' | 'basket' | 'holdings' | 'positions' | 'history'>, row: CoinRow, now: Date = new Date()): CoinSheet {
  const mine = me.history.plantings
    .filter((p) => p.asset === row.asset && (!row.venue || !p.venue || p.venue === row.venue))
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
  const putIn = row.putInCents ?? (row.asset === 'SKR' ? skrPutInCents(me) : null)
  const earned = earnedLabel(row.earnedUsd)
  const lines: CoinSheet['lines'] = []
  if (putIn !== null) lines.push({ label: t('home.value.putIn'), value: formatUsd(putIn) })
  if (earned) lines.push({ label: t('home.value.earned'), value: earned.text, positive: earned.positive })
  if (row.parts) for (const p of row.parts) lines.push({ label: p.where ?? '', value: p.usd ?? p.qty })   // R568: each venue, its share
  else if (row.where) lines.push({ label: t('sheet.where'), value: row.where })
  const plantings = mine.slice(0, 3).map((p) => {
    const day = dayMonth(new Date(p.ts))
    const w = plantedParts({ usdcInCents: p.usdcInCents, asset: row.asset, amountOutRaw: p.amountOutRaw, usdPrice: null, venue: p.venue })
    return w.kind === 'went' ? t('sheet.planting.went', { day, ...w.vars }) : t('sheet.planting.became', { day, ...w.vars })
  })
  if (row.parts) return { lines, plantings, withdrawKey: null, walletNote: null }   // R568: Withdraw opens the list, one row per venue
  // 0.1.13: the $0 SKR row (liquid SKR, nothing staked): Put in and Where only, no Withdraw and no wallet line; the sheet's Plant my SKR does the rest
  if (row.key === IDLE_SKR_ROW_KEY) return { lines, plantings: [], withdrawKey: undefined, walletNote: null }
  const w = withdrawRows(me, now).find((r) => r.key === row.key)
  return w?.opens
    ? { lines, plantings, withdrawKey: w.key, walletNote: null }
    : { lines, plantings, withdrawKey: undefined, walletNote: t('sheet.walletNote') }
}
