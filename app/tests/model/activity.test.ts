import { describe, it, expect } from 'vitest'
import {
  plantingRow, splitRow, lendWithdrawalRow, moveRow, foundRow, swapRow, swapRowLine, withdrawalRowLine, visibleRows, WITHDRAWN_LINE, FOUND_NOTE, type ActivityRow,
} from '@/model/activity'
import type { ActivityResponse, SplitRow } from '@/lib/api'

const EARLY = new Date('2026-10-01T00:00:00Z')
type P = ActivityResponse['plantings'][number]
const planting = (legs: P['legs'], o: Partial<P> = {}): P => ({ id: 'p', ts: '2026-10-05T15:00:00Z', status: 'confirmed', signature: 's', usdcPulledCents: 203, networkFeeCents: 3, legs, ...o })
const hsol = { asset: 'hSOL' as const, usdcInCents: 200, amountOutRaw: '12300000', feeCents: 0, feeAmountRaw: '0', usdPrice: 168 }
const usdc = { asset: 'USDC_LEND' as const, usdcInCents: 200, amountOutRaw: '1661200', feeCents: 0, feeAmountRaw: '0', usdPrice: 1, venue: 'kamino_klend' as const }
const all: ActivityRow[] = []
const keep = <T extends ActivityRow | null>(r: T) => { if (r) all.push(r); return r }

describe('R284: a planting is one plain line, the details behind a tap', () => {
  it('a coin: the dollars and the leg; the details say what it became, the fee clause and the network fee', () => {
    expect(keep(plantingRow('Oct 1', planting([hsol])))).toEqual({ key: 'p', line: 'Oct 1, planted $2.00: hSOL', details: ['$2.00 became 0.0123 hSOL ($2.07), fee under 1 cent', 'Network fee $0.03'], signature: 's' })
  })
  it('lending names the venue (contracts 5.7) and says no Sprouts fee', () => {
    expect(keep(plantingRow('Oct 5', planting([usdc], { networkFeeCents: 0 })))).toEqual({ key: 'p', line: 'Oct 5, planted $2.00: USDC lending (Kamino)', details: ['$2.00 went into USDC lending (Kamino), no Sprouts fee'], signature: 's' })
  })
  it('several legs read as shares', () => {
    const skr = { asset: 'SKR' as const, usdcInCents: 90, amountOutRaw: '4920000', feeCents: 0, feeAmountRaw: '0', usdPrice: 0.0183 }
    const r = keep(plantingRow('Oct 5', planting([skr, { ...usdc, usdcInCents: 110 }])))
    expect(r?.line).toBe('Oct 5, planted $2.00: 45% SKR, 55% USDC lending (Kamino)')
    expect(r?.details).toHaveLength(3)
  })
  it("a retired coin's planting is not shown (R281); a failed one moved nothing; one in flight says so", () => {
    expect(plantingRow('Oct 1', planting([{ ...hsol, asset: 'JitoSOL' }]))).toBeNull()
    expect(keep(plantingRow('Oct 1', planting([hsol], { status: 'failed' })))?.line).toBe('Oct 1, a planting did not land. Nothing moved.')
    expect(keep(plantingRow('Oct 1', planting([], { status: 'sent' })))?.line).toBe('Oct 1, a planting is on its way.')
  })
})

describe('the split, as one line', () => {
  const ts = '2026-10-03T14:00:00.000Z'
  const row = (o: Partial<SplitRow>): SplitRow => ({ ts, by: 'manager', from: { SKR: 45, USDC_LEND: 10, hSOL: 20, JitoSOL: 5 }, to: { SKR: 45, USDC_LEND: 15, hSOL: 15, JitoSOL: 5 }, stop: 'balanced', why: 'Kamino paid more this week.', fallback: null, ...o })
  it("the manager's move, its change and its why behind the tap; retired keys never named", () => {
    expect(keep(splitRow(row({}), 0))).toEqual({ key: `${ts}-0`, line: 'Oct 3, the Yield Manager moved your split', details: ['USDC lending 10 to 15, hSOL 20 to 15', 'Kamino paid more this week.'], signature: null })
    expect(splitRow(row({ from: { SKR: 40, JitoSOL: 10 }, to: { SKR: 50, JitoSOL: 0 }, why: null }), 1).details).toEqual(['SKR 40 to 50'])
  })
  it('an undo, a switch turned on, a change by rule, your own change', () => {
    expect(keep(splitRow(row({ by: 'undo' }), 0)).line).toBe('Oct 3, undone. The Yield Manager is off.')
    expect(keep(splitRow(row({ by: 'you', turnedOn: true, to: { SKR: 45, USDC_LEND: 10, hSOL: 20, JitoSOL: 5 } }), 0))).toMatchObject({ line: 'Oct 3, you turned the Yield Manager on', details: ['Balanced.'] })
    expect(keep(splitRow(row({ fallback: 'model' }), 0)).line).toBe('Oct 3, your split moved by rule today')
    expect(keep(splitRow(row({ by: 'you' }), 0))).toMatchObject({ line: 'Oct 3, you changed your split', details: ['USDC lending 10 to 15, hSOL 20 to 15'] })
  })
})

describe('lending withdrawals, moves and found venues', () => {
  it('a lending withdrawal names the amount when the API gives it, else the leg', () => {
    expect(keep(lendWithdrawalRow('Oct 5', { ts: '', asset: 'SOL_LEND', venue: 'jupiter_lend', receiptRaw: '940800', underlyingRaw: '1000000', signature: 'w' }))).toEqual({ key: 'lw-w', line: 'Oct 5, withdrew 0.0010 SOL from Jupiter', details: ['Back in your Seeker wallet.'], signature: 'w' })
    expect(keep(lendWithdrawalRow('Oct 5', { ts: '', asset: 'USDC_LEND', venue: 'kamino_klend', receiptRaw: '1', signature: 'x' })).line).toBe('Oct 5, withdrew your USDC lending from Kamino')
  })
  it('a move: done, did not finish, kept; an open or expired proposal is not a row', () => {
    const m = { ts: '2026-10-05T19:00:00Z', asset: 'USDC_LEND' as const, from: 'jupiter_lend' as const, to: 'kamino_klend' as const, receiptRaw: '940000' }
    expect(keep(moveRow('Oct 5', { ...m, status: 'done' }))?.line).toBe('Oct 5, moved your USDC from Jupiter to Kamino')
    expect(keep(moveRow('Oct 5', { ...m, status: 'failed' }))).toMatchObject({ line: 'Oct 5, a move of your USDC from Jupiter to Kamino did not finish', details: ['Withdraw shows where it sits now.'] })
    expect(keep(moveRow('Oct 5', { ...m, status: 'dismissed' }))?.line).toBe('Oct 5, you kept your USDC on Jupiter')
    expect(moveRow('Oct 5', { ...m, status: 'open' })).toBeNull()
    expect(moveRow('Oct 5', { ...m, status: 'expired' })).toBeNull()
  })
  it('a found venue gets its own line (spec 11), never routed to', () => {
    const f = { day: '2026-10-05', project: 'Fixture Venue', symbol: 'USDC', asset: 'USDC' as const, apyBasePct: 6.1, tvlUsd: 25_000_000, note: 'A higher base rate this week.' }
    expect(keep(foundRow(f))).toEqual({ key: 'f-2026-10-05-Fixture Venue-USDC', line: 'Oct 5, found Fixture Venue USDC at 6.1%', details: ['A higher base rate this week.', FOUND_NOTE], signature: null })
    expect(foundRow({ ...f, apyBasePct: null, note: null })).toMatchObject({ line: 'Oct 5, found Fixture Venue USDC', details: [FOUND_NOTE] })
    expect(FOUND_NOTE).toBe('Not used: Sprouts lends only on Kamino and Jupiter.')
  })
  it('every line is one line, plain: no line break, no dash', () => {
    expect(all.length).toBeGreaterThan(10)
    for (const r of all) for (const t of [r.line, ...r.details]) expect(t).not.toMatch(/[\n\u2013\u2014]/)
  })
})

describe('swaps and SKR withdrawals (unchanged lines)', () => {
  it('a swap row: the swap, its change, planted or waiting; an unpriced swap says so', () => {
    expect(swapRowLine('Oct 1', { usdSizeCents: 1240, roundupCents: 60, plantingId: 'p1' })).toBe('Oct 1, $12.40 swap, change $0.60, planted')
    expect(swapRowLine('Oct 1', { usdSizeCents: null, roundupCents: 60, plantingId: null })).toBe('Oct 1, unpriced swap, change $0.60, waiting')
    expect(swapRow('Oct 1', { signature: 'sg', usdSizeCents: 1240, roundupCents: 60, plantingId: 'p1' })).toEqual({ key: 'sg', line: 'Oct 1, $12.40 swap, change $0.60, planted', details: [], signature: 'sg' })
  })
  it('a withdrawal row: the SKR with its dollar, then its state, and whether the wallet started it', () => {
    expect(withdrawalRowLine('Oct 1', { amountRaw: '12480000', cancelled: false, delivered: true, source: 'sprouts', ts: '2026-10-01T12:00:00Z' }, 0.01833)).toBe('Oct 1, 12.48 SKR ($0.23), delivered')
    expect(withdrawalRowLine('Oct 1', { amountRaw: '12480000', cancelled: false, delivered: false, source: 'wallet', ts: '2026-10-01T12:00:00Z' }, null, undefined, EARLY)).toMatch(/^Oct 1, 12\.48 SKR, arrives Oct [34], \d{1,2} [AP]M, from your wallet$/)
    expect(withdrawalRowLine('Oct 1', { amountRaw: null, cancelled: true, delivered: false, source: 'sprouts', ts: '2026-10-01T12:00:00Z' }, null)).toBe('Oct 1, an amount, put back')
  })
  const base = { amountRaw: '1000000', cancelled: false, delivered: false, source: 'sprouts', ts: '2026-10-02T12:00:00Z' } as const
  it('R156 and R165: when it arrives, then arriving today', () => {
    expect(withdrawalRowLine('Oct 2', base, 0.0183, undefined, EARLY)).toMatch(/^Oct 2, 1\.00 SKR \(\$0\.02\), arrives Oct [45], \d{1,2} [AP]M$/)
    expect(withdrawalRowLine('Oct 2', base, 0.0183, '2026-10-03T12:00:00Z', EARLY)).toMatch(/^Oct 2, 1\.00 SKR \(\$0\.02\), arrives Oct [23], \d{1,2} [AP]M$/)
    const late = new Date('2026-10-05T00:00:00Z')
    expect(withdrawalRowLine('Oct 2', base, 0.0183, undefined, late)).toBe('Oct 2, 1.00 SKR ($0.02), arriving today')
    expect(withdrawalRowLine('Oct 2', { ...base, source: 'wallet' }, 0.0183, undefined, late)).toBe('Oct 2, 1.00 SKR ($0.02), arriving today, from your wallet')
    expect(withdrawalRowLine('Oct 2', { ...base, delivered: true }, 0.0183)).toBe('Oct 2, 1.00 SKR ($0.02), delivered')
    expect(withdrawalRowLine('Oct 2', { ...base, cancelled: true }, 0.0183)).toBe('Oct 2, 1.00 SKR ($0.02), put back')
    expect(WITHDRAWN_LINE).toBe('What you withdrew.')
  })
})

describe('visibleRows (his note 6: the latest five, the rest behind Show more)', () => {
  const rows = Array.from({ length: 12 }, (_, i) => i)
  it('closed, open, and five or fewer', () => {
    expect(visibleRows(rows, false)).toEqual({ shown: [0, 1, 2, 3, 4], hidden: 7 })
    expect(visibleRows(rows, true)).toEqual({ shown: rows, hidden: 0 })
    expect(visibleRows([1, 2, 3], false)).toEqual({ shown: [1, 2, 3], hidden: 0 })
  })
})
