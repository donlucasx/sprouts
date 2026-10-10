import { describe, it, expect } from 'vitest'
import { coinSheet, earnedLabel } from '@/lib/coin-sheet'
import { coinRows } from '@/lib/me-state'
import type { MeResponse } from '@/lib/api'

const pot = { skrStakedRaw: '34900000', skrEarnedRaw: '2000000', skrUsd: 0.5 } as MeResponse['pot']
const hsol = { asset: 'hSOL', heldRaw: '12300000', putInCents: 203, valueUsd: 2.07, earnedUsd: 0.04, earnedUnderlyingRaw: '1' } as const
const planting = (ts: string, asset: string, cents: number) => ({ id: ts, ts, asset, usdcInCents: cents, amountOutRaw: '1000000', feeCents: 0, signature: null }) as never
const me = {
  pot,
  basket: null,
  holdings: [hsol],
  positions: [],
  history: {
    plantings: [planting('2026-10-01T15:00:00Z', 'SKR', 200), planting('2026-10-03T15:00:00Z', 'SKR', 150), planting('2026-10-02T15:00:00Z', 'hSOL', 203),
      planting('2026-10-05T15:00:00Z', 'SKR', 100), planting('2026-10-07T15:00:00Z', 'SKR', 50)],
    picks: [],
  },
} as unknown as MeResponse

describe('earnedLabel (R563)', () => {
  it('"+$0.03", green only above zero; null when unknown', () => {
    expect(earnedLabel(0.034)).toEqual({ text: '+$0.03', positive: true })
    expect(earnedLabel(0.001)).toEqual({ text: '+$0.00', positive: false })
    expect(earnedLabel(null)).toBeNull()
    expect(earnedLabel(Number.NaN)).toBeNull()
  })
})

describe('coinSheet (R564)', () => {
  const [skr, h] = coinRows(me)
  it('SKR: put in = its plantings, earned at its price, locked, the last three plantings newest first, Withdraw opens on SKR', () => {
    const s = coinSheet(me, skr!)
    expect(s.lines).toEqual([
      { label: 'Put in', value: '$5.00' },
      { label: 'Earned', value: '+$1.00', positive: true },
      { label: 'Where', value: 'Locked to your Seed Vault' },
    ])
    expect(s.plantings.map((p) => p.split(':')[0])).toEqual(['Oct 7', 'Oct 5', 'Oct 3'])
    expect(s.withdrawKey).toBe('SKR')
    expect(s.walletNote).toBeNull()
  })
  it('a wallet coin: its own put in, the wallet line, no Withdraw', () => {
    const s = coinSheet(me, h!)
    expect(s.lines[0]).toEqual({ label: 'Put in', value: '$2.03' })
    expect(s.plantings).toHaveLength(1)
    expect(s.withdrawKey).toBeNull()
    expect(s.walletNote).toMatch(/your wallet app/)
  })
})
