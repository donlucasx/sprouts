import type { ActivityResponse } from '@/lib/api'
import { formatSkr, formatUsd, plantedLine } from '@/lib/format'

/** Activity's rows (spec 3.2, 7.7), pure, in the manual's words: a planting is what the change became; nothing is "pulled". */
type Planting = Pick<ActivityResponse['plantings'][number], 'status' | 'usdcPulledCents' | 'legs'>
type Swap = Pick<ActivityResponse['swaps'][number], 'usdSizeCents' | 'roundupCents' | 'plantingId'>
type Withdrawal = Pick<ActivityResponse['withdrawals'][number], 'amountRaw' | 'cancelled' | 'delivered' | 'source' | 'ts'>

export function plantingRowLine(day: string, p: Planting): string {
  const leg = p.legs[0]
  if (p.status === 'confirmed' && leg) {
    return `${day}, ${plantedLine({ usdcInCents: leg.usdcInCents, asset: leg.asset, amountOutRaw: leg.amountOutRaw, usdPrice: leg.usdPrice ?? null, feeCents: leg.feeCents, feeAmountRaw: leg.feeAmountRaw })}`
  }
  return p.status === 'failed' ? `${day}, did not land, nothing moved` : `${day}, in flight`
}

export function swapRowLine(day: string, s: Swap): string {
  const size = s.usdSizeCents === null ? 'unpriced swap' : `${formatUsd(s.usdSizeCents)} swap`
  return `${day}, ${size}, change ${formatUsd(s.roundupCents)}${s.plantingId ? ', planted' : ', waiting'}`
}

const COOLDOWN_MS = 172_800_000
/** R156: the row says when the SKR arrives (the staking program's 48 hours after the unstake), in the phone's time zone. A withdrawal the basket knows the chain's time for says that time (a wallet-started row's ts is when Sprouts found it). */
const when = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })

export function withdrawalRowLine(day: string, w: Withdrawal, skrUsd: number | null, readyAt?: string): string {
  const amount = w.amountRaw ? formatSkr(BigInt(w.amountRaw), skrUsd) : 'an amount'
  const state = w.cancelled ? 'put back' : w.delivered ? 'delivered' : `arrives ${when(readyAt ? new Date(readyAt) : new Date(new Date(w.ts).getTime() + COOLDOWN_MS))}`
  return `${day}, ${amount}, ${state}${w.source === 'wallet' ? ', from your wallet' : ''}`
}

/** R156 (supersedes R94's third line): the one-line explainer under the withdrawals. */
export const TAKEN_OUT_LINE = 'What you took out.'

/** A section shows its latest five rows (the API serves fifty, newest first); "Show N more" opens the rest in place (his note 6). */
export function visibleRows<T>(rows: T[], open: boolean, limit = 5): { shown: T[]; hidden: number } {
  if (open || rows.length <= limit) return { shown: rows, hidden: 0 }
  return { shown: rows.slice(0, limit), hidden: rows.length - limit }
}
