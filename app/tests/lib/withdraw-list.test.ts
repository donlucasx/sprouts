import { describe, it, expect } from 'vitest'
import { withdrawRows } from '@/lib/withdraw-list'
import type { MeResponse } from '@/lib/api'

const hsol = { asset: 'hSOL', heldRaw: '12300000', putInCents: 203, valueUsd: 2.07, earnedUsd: 0.04, earnedUnderlyingRaw: '1' } as const
const pot = { skrStakedRaw: '34900000', skrUsd: 0.0183 } as MeResponse['pot']

describe('withdrawRows (R159, R171: every coin listed; only SKR leaves through Sprouts)', () => {
  it('SKR first and opening the flow, then each held coin with where it sits', () => {
    const rows = withdrawRows({ pot, basket: null, holdings: [{ ...hsol, asset: 'cbBTC', heldRaw: '2389', valueUsd: null }, hsol] })
    expect(rows.map((r) => [r.asset, r.opens])).toEqual([['SKR', true], ['hSOL', false], ['cbBTC', false]])
    expect(rows[0]).toMatchObject({ label: 'Withdraw SKR', amount: '34.90 SKR ($0.64)', note: 'locked to your Seeker, 48 hours to leave' })
    expect(rows[1]).toMatchObject({ amount: '0.0123 hSOL ($2.07)', note: 'in your wallet. Trade or send it from your wallet app.' })
    expect(rows[2].amount).toBe('0.00002389 cbBTC')
    expect(rows[1].label).toBeUndefined()   // a wallet coin does not leave through Sprouts: no Withdraw label
  })
  it('the SKR row says in the basket while one ripens, and still opens', () => {
    const basket = { id: 'b', asset: 'SKR', amountRaw: '1000000', unstakeTs: '2026-10-02T12:00:00Z', readyAt: '2026-10-04T12:00:00Z', delivered: false, deliveredSignature: null } as const
    const [skr] = withdrawRows({ pot: { ...pot, skrStakedRaw: '0' }, basket, holdings: [] }, new Date('2026-10-03T00:00:00Z'))
    expect(skr.asset).toBe('SKR')
    expect(skr.opens).toBe(true)
    expect(skr.label).toBe('Withdraw SKR')
    expect(skr.note).toMatch(/^in the basket, arrives Oct [45], \d{1,2} [AP]M$/)
  })
  it('R165: the basket note says arriving today once readyAt has passed', () => {
    const basket = { id: 'b', asset: 'SKR', amountRaw: '1000000', unstakeTs: '2026-10-02T12:00:00Z', readyAt: '2026-10-04T12:00:00Z', delivered: false, deliveredSignature: null } as const
    const [skr] = withdrawRows({ pot: { ...pot, skrStakedRaw: '0' }, basket, holdings: [] }, new Date('2026-10-04T13:00:00Z'))
    expect(skr.note).toBe('in the basket, arriving today')
  })
  it('nothing staked, no basket, no holdings: no rows', () => {
    expect(withdrawRows({ pot: { ...pot, skrStakedRaw: '0' }, basket: null, holdings: [] })).toEqual([])
  })
})
