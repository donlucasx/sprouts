import { describe, it, expect } from 'vitest'
import { coinRows, gardenTotals, livePositions } from '@/lib/me-state'
import { positionAmount, positionNote } from '@/lib/format'
import { FIXTURE_LEND_HOLDINGS, FIXTURE_POSITIONS } from '@/lib/lend-fixtures'
import type { MeResponse } from '@/lib/api'

const pot = { skrStakedRaw: '34900000', skrEarnedRaw: '0', skrPutInRaw: '1000000', skrPrincipalPickedRaw: '0', skrUsd: 0.0183 } as MeResponse['pot']
const hsol = { asset: 'hSOL', heldRaw: '12300000', putInCents: 203, valueUsd: 2.07, earnedUsd: 0.04, earnedUnderlyingRaw: '1' } as const
const me = { pot, holdings: [hsol, ...FIXTURE_LEND_HOLDINGS], positions: FIXTURE_POSITIONS, history: { plantings: [], picks: [] } } as unknown as MeResponse

describe('lending positions in the coin list (spec 11, contracts 5.2)', () => {
  it('one row per position: venue, rate, value, earned', () => {
    expect(positionAmount(FIXTURE_POSITIONS[0])).toBe('2.00 USDC ($2.00)')
    expect(positionAmount(FIXTURE_POSITIONS[2])).toBe('0.0100 SOL ($1.50)')
    expect(positionNote(FIXTURE_POSITIONS[0])).toBe('Kamino 4.4%, earned $0.02')
    expect(positionNote(FIXTURE_POSITIONS[1])).toBe('Jupiter 3.8%')   // earned under half a cent is not shown
    expect(positionNote({ ...FIXTURE_POSITIONS[1], ratePct: null })).toBe('Jupiter')
  })
  it('Review Focus 4: positions replace the aggregated row; the total counts once', () => {
    const rows = coinRows(me)
    expect(rows.map((r) => [r.asset, r.venue])).toEqual([['SKR', null], ['USDC_LEND', 'kamino_klend'], ['USDC_LEND', 'jupiter_lend'], ['SOL_LEND', 'jupiter_lend'], ['hSOL', null]])
    expect(rows.map((r) => r.key)).toEqual(['SKR', 'USDC_LEND:kamino_klend', 'USDC_LEND:jupiter_lend', 'SOL_LEND:jupiter_lend', 'hSOL'])
    expect(rows[1]).toMatchObject({ qty: '2.00 USDC', usd: '$2.00', note: 'Kamino 4.4%, earned $0.02', locked: false, lead: false })
    expect(gardenTotals(me).valueUsd).toBeCloseTo(34.9 * 0.0183 + 2.07 + 3.0 + 1.5, 6)   // holdings only; the positions are the same money
  })
  it('a lending holding with no positions (an API before positions) shows its one row; an empty position is skipped', () => {
    expect(coinRows({ ...me, positions: undefined }).map((r) => [r.asset, r.venue])).toEqual([['SKR', null], ['USDC_LEND', null], ['SOL_LEND', null], ['hSOL', null]])
    const emptied = { ...me, positions: FIXTURE_POSITIONS.map((p) => (p.venue === 'jupiter_lend' && p.asset === 'USDC_LEND' ? { ...p, receiptRaw: '0' } : p)) }
    expect(livePositions(emptied, 'USDC_LEND').map((p) => p.venue)).toEqual(['kamino_klend'])
    expect(livePositions({ positions: [{ ...FIXTURE_POSITIONS[0], receiptRaw: 'x' }] }, 'USDC_LEND')).toEqual([])
  })
})
