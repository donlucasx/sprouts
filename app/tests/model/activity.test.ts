import { describe, it, expect } from 'vitest'
import {
  plantingRow, splitRow, lendWithdrawalRow, moveRow, foundRow, swapRow, withdrawalRow, visibleRows, groupByDay, dayHeader, rowTime, spokenLabel,
  WITHDRAWN_LINE, FOUND_NOTE, type ActivityRow,
} from '@/model/activity'
import type { ActivityResponse, SplitRow } from '@/lib/api'

// vitest pins TZ America/Los_Angeles: 15:00Z on Oct 5 is 8:00 AM local.
const EARLY = new Date('2026-10-01T00:00:00Z')
const NOW = new Date('2026-10-05T18:00:00Z') // Oct 5, 11:00 AM local
type P = ActivityResponse['plantings'][number]
const planting = (legs: P['legs'], o: Partial<P> = {}): P => ({ id: 'p', ts: '2026-10-05T15:00:00Z', status: 'confirmed', signature: 's', usdcPulledCents: 203, networkFeeCents: 3, legs, ...o })
const hsol = { asset: 'hSOL' as const, usdcInCents: 200, amountOutRaw: '12300000', feeCents: 0, feeAmountRaw: '0', usdPrice: 168 }
const usdc = { asset: 'USDC_LEND' as const, usdcInCents: 62, amountOutRaw: '515000', feeCents: 0, feeAmountRaw: '0', usdPrice: 1, venue: 'kamino_klend' as const }
const all: ActivityRow[] = []
const keep = <T extends ActivityRow | null>(r: T) => { if (r) all.push(r); return r }

describe('R362: a planting is one short line (what, amount); the long line lives behind the tap', () => {
  it('a coin: "Planted hSOL" and its dollars; the details say what it became, the fee clause and the network fee', () => {
    expect(keep(plantingRow(planting([hsol])))).toEqual({
      key: 'p', ts: '2026-10-05T15:00:00Z', label: 'Planted hSOL', amount: '$2.00',
      details: ['$2.00 became 0.0123 hSOL ($2.07), fee under 1 cent', 'Network fee $0.03'], signature: 's',
    })
  })
  it('SKR: the coin amount ("235.21 SKR ($4.28)") moves into the details', () => {
    const skr = { asset: 'SKR' as const, usdcInCents: 432, amountOutRaw: '235210000', feeCents: 4, feeAmountRaw: '2000000', usdPrice: 0.0182 }
    const r = keep(plantingRow(planting([skr], { networkFeeCents: 0 })))
    expect(r).toMatchObject({ label: 'Planted SKR', amount: '$4.32' })
    expect(r?.details[0]).toMatch(/^\$4\.32 became 235\.21 SKR \(\$4\.28\)/)
  })
  it('lending: the label names the leg, the venue moves into the details with "no Sprouts fee"', () => {
    expect(keep(plantingRow(planting([usdc], { networkFeeCents: 0 })))).toMatchObject({ label: 'Planted USDC lending', amount: '$0.62', details: ['$0.62 went into USDC lending (Kamino), no Sprouts fee'] })
  })
  it('several legs: the count in the label, the total on the right, each leg in the details', () => {
    const skr = { asset: 'SKR' as const, usdcInCents: 90, amountOutRaw: '4920000', feeCents: 0, feeAmountRaw: '0', usdPrice: 0.0183 }
    const r = keep(plantingRow(planting([skr, { ...usdc, usdcInCents: 110 }])))
    expect(r).toMatchObject({ label: 'Planted 2 coins', amount: '$2.00' })
    expect(r?.details).toHaveLength(3)
    expect(r?.details[1]).toBe('$1.10 went into USDC lending (Kamino), no Sprouts fee')
  })
  it("a retired coin's planting is not shown (R281); a failed one moved nothing; one in flight says so", () => {
    expect(plantingRow(planting([{ ...hsol, asset: 'JitoSOL' }]))).toBeNull()
    expect(keep(plantingRow(planting([hsol], { status: 'failed' })))).toMatchObject({ label: 'Planting did not land', amount: null, details: ['Nothing moved.'] })
    expect(keep(plantingRow(planting([], { status: 'sent' })))).toMatchObject({ label: 'Planting on its way', amount: null, details: [] })
  })
})

describe('R362: the split, one short line, chevron only (no amount)', () => {
  const ts = '2026-10-03T14:00:00.000Z'
  const row = (o: Partial<SplitRow>): SplitRow => ({ ts, by: 'manager', from: { SKR: 45, USDC_LEND: 10, hSOL: 20, JitoSOL: 5 }, to: { SKR: 45, USDC_LEND: 15, hSOL: 15, JitoSOL: 5 }, stop: 'balanced', why: 'Kamino paid more this week.', fallback: null, ...o })
  it("the manager's move: what changed and its why behind the tap; retired keys never named", () => {
    expect(keep(splitRow(row({}), 0))).toEqual({ key: `${ts}-0`, ts, label: 'AI moved your split', amount: null, details: ['USDC lending 10 to 15, hSOL 20 to 15', 'Kamino paid more this week.'], signature: null })
    expect(splitRow(row({ from: { SKR: 40, JitoSOL: 10 }, to: { SKR: 50, JitoSOL: 0 }, why: null }), 1).details).toEqual(['SKR 40 to 50'])
  })
  it('an undo, the AI turned on, a change by rule, your own change', () => {
    expect(keep(splitRow(row({ by: 'undo' }), 0))).toMatchObject({ label: 'Undone', details: ["Yesterday's split is back.", 'The Yield Manager is off.'] })
    expect(keep(splitRow(row({ by: 'you', turnedOn: true, to: { SKR: 45, USDC_LEND: 10, hSOL: 20, JitoSOL: 5 } }), 0))).toMatchObject({ label: 'You turned on the AI', details: ['Balanced.'] })
    expect(keep(splitRow(row({ fallback: 'model' }), 0))).toMatchObject({ label: 'Split moved by rule', details: ['USDC lending 10 to 15, hSOL 20 to 15', 'Chosen by rule today.'] })
    expect(keep(splitRow(row({ by: 'you' }), 0))).toMatchObject({ label: 'You changed your split', amount: null, details: ['USDC lending 10 to 15, hSOL 20 to 15'] })
  })
})

describe('R362: swaps', () => {
  const s = { signature: 'sg', ts: '2026-10-05T17:56:00Z', usdSizeCents: 1000, roundupCents: 100, plantingId: 'p1' }
  it('"Swap $10.00" with "+$1.00" on the right; planted or waiting behind the tap', () => {
    expect(keep(swapRow(s))).toEqual({ key: 'sg', ts: s.ts, label: 'Swap $10.00', amount: '+$1.00', details: ['Change $1.00, planted.'], signature: 'sg' })
    expect(keep(swapRow({ ...s, plantingId: null })).details).toEqual(['Change $1.00, waiting to be planted.'])
    expect(keep(swapRow({ ...s, usdSizeCents: null, roundupCents: 60 }))).toMatchObject({ label: 'Unpriced swap', amount: '+$0.60' })
  })
})

describe('R362: withdrawals', () => {
  const w = { id: 'w1', ts: '2026-10-02T12:00:00Z', amountRaw: '12480000', cancelled: false, delivered: true, source: 'sprouts', withdrawSignature: 'ws', unstakeSignature: 'us' } as const
  it('delivered SKR: "Withdrew SKR", its dollars on the right, the SKR amount and state behind the tap', () => {
    expect(keep(withdrawalRow(w, 0.01833))).toEqual({ key: 'w1', ts: w.ts, label: 'Withdrew SKR', amount: '$0.23', details: ['12.48 SKR ($0.23)', 'Delivered.'], signature: 'ws' })
    expect(withdrawalRow(w, null).amount).toBe('12.48 SKR')
  })
  it('R156/R165: on its way says when it arrives, then arriving today; a wallet-started one says so; put back', () => {
    const on = { ...w, delivered: false, withdrawSignature: null }
    const r = keep(withdrawalRow(on, 0.0183, undefined, EARLY))
    expect(r).toMatchObject({ label: 'Withdrawing SKR', signature: 'us' })
    expect(r.details[1]).toMatch(/^Arrives Oct [34], \d{1,2} [AP]M\.$/)
    expect(withdrawalRow(on, 0.0183, '2026-10-03T12:00:00Z', EARLY).details[1]).toMatch(/^Arrives Oct [23], \d{1,2} [AP]M\.$/)
    expect(withdrawalRow({ ...on, source: 'wallet' }, 0.0183, undefined, NOW).details).toEqual(['12.48 SKR ($0.23)', 'Arriving today.', 'Started from your wallet.'])
    expect(keep(withdrawalRow({ ...w, cancelled: true }, 0.0183))).toMatchObject({ label: 'Withdrawal put back', details: ['12.48 SKR ($0.23)', 'Put back.'] })
    expect(withdrawalRow({ ...w, amountRaw: null }, 0.0183)).toMatchObject({ amount: null, details: ['Delivered.'] })
    expect(WITHDRAWN_LINE).toBe('What you withdrew.')
  })
  it('a lending withdrawal: the coin in the label, its amount on the right, the venue behind the tap', () => {
    expect(keep(lendWithdrawalRow({ ts: 't', asset: 'SOL_LEND', venue: 'jupiter_lend', receiptRaw: '940800', underlyingRaw: '1000000', signature: 'w' }))).toEqual({ key: 'lw-w', ts: 't', label: 'Withdrew SOL', amount: '0.0010 SOL', details: ['From Jupiter.', 'Back in your Seeker wallet.'], signature: 'w' })
    expect(keep(lendWithdrawalRow({ ts: 't', asset: 'USDC_LEND', venue: 'kamino_klend', receiptRaw: '1', signature: 'x' }))).toMatchObject({ label: 'Withdrew USDC', amount: null })
    expect(lendWithdrawalRow({ ts: 't', asset: 'USDC_LEND', venue: 'kamino_klend', receiptRaw: '1', underlyingRaw: null, signature: 'x' }).amount).toBeNull()
  })
})

describe('moves and found venues', () => {
  const m = { ts: '2026-10-05T19:00:00Z', asset: 'USDC_LEND' as const, from: 'jupiter_lend' as const, to: 'kamino_klend' as const, receiptRaw: '940000' }
  it('a move: done, did not finish, kept; an open or expired proposal is not a row', () => {
    expect(keep(moveRow({ ...m, status: 'done' }))).toMatchObject({ ts: m.ts, label: 'Moved USDC', amount: null, details: ['Jupiter to Kamino.'] })
    expect(keep(moveRow({ ...m, status: 'failed' }))).toMatchObject({ label: "Move didn't finish", details: ['Your USDC is back in your wallet.', 'Jupiter to Kamino.'] })
    expect(keep(moveRow({ ...m, asset: 'SOL_LEND', status: 'failed' }))?.details).toEqual(['Your SOL is in your wallet. If it shows as wrapped SOL, unwrap it in your wallet.', 'Jupiter to Kamino.'])
    expect(keep(moveRow({ ...m, status: 'dismissed' }))).toMatchObject({ label: 'Kept USDC on Jupiter', details: ['Not moved to Kamino.'] })
    expect(moveRow({ ...m, status: 'open' })).toBeNull()
    expect(moveRow({ ...m, status: 'expired' })).toBeNull()
  })
  it('a found venue (spec 11): its day, the rate on the right, never routed to', () => {
    const f = { day: '2026-10-05', project: 'Fixture', symbol: 'USDC', asset: 'USDC' as const, apyBasePct: 6.1, tvlUsd: 25_000_000, note: 'A higher base rate this week.' }
    expect(keep(foundRow(f))).toEqual({ key: 'f-2026-10-05-Fixture-USDC', ts: '2026-10-05', label: 'Found Fixture USDC', amount: '6.1%', details: ['A higher base rate this week.', FOUND_NOTE], signature: null })
    expect(foundRow({ ...f, apyBasePct: null, note: null })).toMatchObject({ amount: null, details: [FOUND_NOTE] })
    expect(FOUND_NOTE).toBe('Not used: Sprouts lends only on Kamino and Jupiter.')
  })
})

describe('R362: every row fits one line at 360 dp', () => {
  it('labels are short (22 characters at most), amounts shorter; no line break or dash anywhere', () => {
    expect(all.length).toBeGreaterThan(20)
    for (const r of all) {
      expect(r.label.length, r.label).toBeLessThanOrEqual(22)
      expect((r.amount ?? '').length, r.amount ?? '').toBeLessThanOrEqual(10)
      for (const t of [r.label, r.amount ?? '', ...r.details]) expect(t).not.toMatch(/[\n–—]/)
    }
  })
})

describe('R362: day headers in the phone zone, the time on each row', () => {
  const r = (ts: string, key = ts): ActivityRow => ({ key, ts, label: 'x', amount: null, details: [], signature: null })
  it('the header: Today, Yesterday, then "Oct 3"; another year carries the year', () => {
    expect(dayHeader('2026-10-05', NOW)).toBe('Today')
    expect(dayHeader('2026-10-04', NOW)).toBe('Yesterday')
    expect(dayHeader('2026-10-03', NOW)).toBe('Oct 3')
    expect(dayHeader('2025-12-30', NOW)).toBe('Dec 30, 2025')
    expect(dayHeader('2026-10-01', new Date('2026-10-02T06:59:00Z'))).toBe('Today') // 06:59Z on Oct 2 is Oct 1, 11:59 PM local
  })
  it('groups by the LOCAL day (07:30Z is 12:30 AM Today, 06:30Z is 11:30 PM Yesterday), in order', () => {
    const rows = [r('2026-10-05T18:13:00Z'), r('2026-10-05T07:30:00Z'), r('2026-10-05T06:30:00Z'), r('2026-10-03T14:11:00Z'), r('2026-10-03T05:00:00Z')] // 05:00Z on Oct 3 is Oct 2, 10 PM local
    const g = groupByDay(rows, NOW)
    expect(g.map((d) => [d.header, d.rows.length])).toEqual([['Today', 2], ['Yesterday', 1], ['Oct 3', 1], ['Oct 2', 1]])
    expect(g.flatMap((d) => d.rows)).toEqual(rows)
    expect(g[0].key).toBe('2026-10-05')
  })
  it("a found venue's day is the API's day as given; it has no time", () => {
    expect(groupByDay([r('2026-10-04')], NOW)[0].header).toBe('Yesterday')
    expect(rowTime('2026-10-04')).toBe('')
  })
  it('the time column: "7:11 AM" in the phone zone', () => {
    expect(rowTime('2026-10-05T14:11:00Z')).toBe('7:11 AM')
    expect(rowTime('2026-10-05T18:13:00Z')).toBe('11:13 AM')
  })
  it('a row is spoken with its full date, its time, the label and the amount', () => {
    expect(spokenLabel({ ...r('2026-10-05T14:11:00Z'), label: 'Planted SKR', amount: '$4.32' })).toBe('October 5, 2026, 7:11 AM, Planted SKR, $4.32')
    expect(spokenLabel({ ...r('2026-10-05'), label: 'Found Fixture USDC', amount: null })).toBe('October 5, 2026, Found Fixture USDC')
  })
  it('"Show N more" counts rows, not headers: the five newest rows, then grouped', () => {
    const rows = Array.from({ length: 8 }, (_, i) => r(`2026-10-0${5 - Math.floor(i / 3)}T18:0${i}:00Z`, String(i)))
    const { shown, hidden } = visibleRows(rows, false)
    expect(hidden).toBe(3)
    expect(groupByDay(shown, NOW).map((d) => d.rows.length)).toEqual([3, 2])
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
