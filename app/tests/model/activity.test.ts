import { describe, it, expect } from 'vitest'
import { plantingRowLine, swapRowLine, withdrawalRowLine } from '@/model/activity'

// Activity's rows (spec 3.2 and 7.7), in the manual's words: planting, change, withdraw; dollars first; never pulled.
describe('Activity rows', () => {
  const leg = {
    asset: 'hSOL' as const,
    usdcInCents: 200,
    amountOutRaw: '12300000',
    feeCents: 0,
    feeAmountRaw: '0',
    usdPrice: 168,
  }
  it('a confirmed planting says what the change became, with the fee clause', () => {
    expect(plantingRowLine('Oct 1', { status: 'confirmed', usdcPulledCents: 203, legs: [leg] })).toBe(
      'Oct 1, $2.00 became 0.0123 hSOL ($2.07), fee under 1 cent',
    )
  })
  it('a failed planting moved nothing; one in flight says so', () => {
    expect(plantingRowLine('Oct 1', { status: 'failed', usdcPulledCents: 203, legs: [leg] })).toBe(
      'Oct 1, did not land, nothing moved',
    )
    expect(plantingRowLine('Oct 1', { status: 'sent', usdcPulledCents: 203, legs: [] })).toBe('Oct 1, in flight')
  })
  it('a swap row: the swap, its change, planted or waiting; an unpriced swap says so', () => {
    expect(swapRowLine('Oct 1', { usdSizeCents: 1240, roundupCents: 60, plantingId: 'p1' })).toBe(
      'Oct 1, $12.40 swap, change $0.60, planted',
    )
    expect(swapRowLine('Oct 1', { usdSizeCents: null, roundupCents: 60, plantingId: null })).toBe(
      'Oct 1, unpriced swap, change $0.60, waiting',
    )
  })
  it('a withdrawal row: the SKR with its dollar, then its state, and whether the wallet started it', () => {
    expect(
      withdrawalRowLine(
        'Oct 1',
        { amountRaw: '12480000', cancelled: false, delivered: true, source: 'sprouts' },
        0.01833,
      ),
    ).toBe('Oct 1, 12.48 SKR ($0.23) delivered')
    expect(
      withdrawalRowLine('Oct 1', { amountRaw: '12480000', cancelled: false, delivered: false, source: 'wallet' }, null),
    ).toBe('Oct 1, 12.48 SKR in the basket, from your wallet')
    expect(
      withdrawalRowLine('Oct 1', { amountRaw: null, cancelled: true, delivered: false, source: 'sprouts' }, null),
    ).toBe('Oct 1, an amount put back')
  })
})
