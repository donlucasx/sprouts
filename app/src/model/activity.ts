import type { ActivityResponse } from '@/lib/api'
import { formatSkr, formatUsd, plantedLine } from '@/lib/format'

/** Activity's rows (spec 3.2, 7.7), pure, in the manual's words: a planting is what the change became; nothing is "pulled". */
type Planting = Pick<ActivityResponse['plantings'][number], 'status' | 'usdcPulledCents' | 'legs'>
type Swap = Pick<ActivityResponse['swaps'][number], 'usdSizeCents' | 'roundupCents' | 'plantingId'>
type Withdrawal = Pick<ActivityResponse['withdrawals'][number], 'amountRaw' | 'cancelled' | 'delivered' | 'source'>

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

export function withdrawalRowLine(day: string, w: Withdrawal, skrUsd: number | null): string {
  const amount = w.amountRaw ? formatSkr(BigInt(w.amountRaw), skrUsd) : 'an amount'
  const state = w.cancelled ? 'put back' : w.delivered ? 'delivered' : 'in the basket'
  return `${day}, ${amount} ${state}${w.source === 'wallet' ? ', from your wallet' : ''}`
}
