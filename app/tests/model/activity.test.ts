import { describe, it, expect } from 'vitest'
import { plantingRowLine, swapRowLine, withdrawalRowLine, visibleRows, WITHDRAWN_LINE } from '@/model/activity'

// Activity's rows (spec 3.2 and 7.7), in the manual's words: planting, change, withdraw; dollars first; never pulled.
const EARLY = new Date('2026-10-01T00:00:00Z')

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
        { amountRaw: '12480000', cancelled: false, delivered: true, source: 'sprouts', ts: '2026-10-01T12:00:00Z' },
        0.01833,
      ),
    ).toBe('Oct 1, 12.48 SKR ($0.23), delivered')
    expect(
      withdrawalRowLine('Oct 1', { amountRaw: '12480000', cancelled: false, delivered: false, source: 'wallet', ts: '2026-10-01T12:00:00Z' }, null, undefined, EARLY),
    ).toMatch(/^Oct 1, 12\.48 SKR, arrives Oct [34], \d{1,2} [AP]M, from your wallet$/)
    expect(
      withdrawalRowLine('Oct 1', { amountRaw: null, cancelled: true, delivered: false, source: 'sprouts', ts: '2026-10-01T12:00:00Z' }, null),
    ).toBe('Oct 1, an amount, put back')
  })
})

describe('visibleRows (his note 6: the latest five, the rest behind Show more)', () => {
  const rows = Array.from({ length: 12 }, (_, i) => i)
  it('closed: the first five and how many are hidden', () => {
    expect(visibleRows(rows, false)).toEqual({ shown: [0, 1, 2, 3, 4], hidden: 7 })
  })
  it('open: everything, nothing hidden', () => {
    expect(visibleRows(rows, true)).toEqual({ shown: rows, hidden: 0 })
  })
  it('five or fewer: everything, nothing hidden, closed or open', () => {
    expect(visibleRows([1, 2, 3], false)).toEqual({ shown: [1, 2, 3], hidden: 0 })
  })
})

describe('withdrawalRowLine (R156: when it arrives, not "on its way")', () => {
  const base = { amountRaw: '1000000', cancelled: false, delivered: false, source: 'sprouts', ts: '2026-10-02T12:00:00Z' } as const
  it('a ripening withdrawal says when it arrives: 48 hours after the unstake', () => {
    expect(withdrawalRowLine('Oct 2', base, 0.0183, undefined, EARLY)).toMatch(/^Oct 2, 1\.00 SKR \(\$0\.02\), arrives Oct [45], \d{1,2} [AP]M$/)
  })
  it('a withdrawal the basket knows the chain time for says that time, not the row time plus 48 hours', () => {
    expect(withdrawalRowLine('Oct 2', base, 0.0183, '2026-10-03T12:00:00Z', EARLY)).toMatch(/^Oct 2, 1\.00 SKR \(\$0\.02\), arrives Oct [23], \d{1,2} [AP]M$/)
  })
  it('R165: once the ready time has passed, the row says arriving today (the job has not marked it delivered yet)', () => {
    const late = new Date('2026-10-05T00:00:00Z')
    expect(withdrawalRowLine('Oct 2', base, 0.0183, undefined, late)).toBe('Oct 2, 1.00 SKR ($0.02), arriving today')
    expect(withdrawalRowLine('Oct 2', base, 0.0183, '2026-10-03T12:00:00Z', late)).toBe('Oct 2, 1.00 SKR ($0.02), arriving today')
    expect(withdrawalRowLine('Oct 2', { ...base, source: 'wallet' }, 0.0183, undefined, late)).toBe('Oct 2, 1.00 SKR ($0.02), arriving today, from your wallet')
  })
  it('delivered and put back read as before', () => {
    expect(withdrawalRowLine('Oct 2', { ...base, delivered: true }, 0.0183)).toBe('Oct 2, 1.00 SKR ($0.02), delivered')
    expect(withdrawalRowLine('Oct 2', { ...base, cancelled: true }, 0.0183)).toBe('Oct 2, 1.00 SKR ($0.02), put back')
    expect(withdrawalRowLine('Oct 2', { ...base, source: 'wallet', delivered: true }, 0.0183)).toBe('Oct 2, 1.00 SKR ($0.02), delivered, from your wallet')
  })
  it('the explainer is his simplified line', () => {
    expect(WITHDRAWN_LINE).toBe('What you withdrew.')
  })
})
