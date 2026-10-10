import { describe, it, expect } from 'vitest'
import { coinSheet, earnedLabel } from '@/lib/coin-sheet'
import { coinRows, gardenTotals } from '@/lib/me-state'
import type { MeResponse } from '@/lib/api'

const pot = { skrStakedRaw: '34900000', skrEarnedRaw: '2000000', skrUsd: 0.5, skrPutInRaw: '32900000', skrPrincipalPickedRaw: '0' } as MeResponse['pot']
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
  it("SKR's Put in is what is still staked, as Home's total counts it (s6 review C2): half the principal withdrawn halves it", () => {
    const half = { ...me, pot: { ...pot, skrPutInRaw: '16450000', skrPrincipalPickedRaw: '16450000' } } as MeResponse
    const [row] = coinRows(half)
    expect(coinSheet(half, row!).lines[0]).toEqual({ label: 'Put in', value: '$2.50' })
    expect(gardenTotals(half).putInCents - 203).toBe(250)   // Home's tile, less the hSOL holding's 203
  })
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
    expect(s.withdrawKey).toBeUndefined()
    expect(s.walletNote).toMatch(/your wallet app/)
  })
})

describe('coinSheet for a coin at two venues (R568)', () => {
  it('lists each venue with its share; Withdraw opens the list', () => {
    const part = (venue: string, where: string, usd: string) => ({ key: `USDC_LEND:${venue}`, asset: 'USDC_LEND', venue, amount: '', qty: '', usd, locked: false, note: null, lead: false, earnedUsd: 0, putInCents: 50, where }) as never
    const row = { key: 'USDC_LEND', asset: 'USDC_LEND', venue: null, amount: '', qty: '1.41 USDC', usd: '$1.41', locked: false, note: null, lead: false, earnedUsd: 0.01, putInCents: 140, where: 'x',
      parts: [part('kamino_klend', 'Kamino 6.2%', '$0.90'), part('jupiter_lend', 'Jupiter 5.1%', '$0.51')] } as never
    const s = coinSheet(me, row)
    expect(s.lines).toEqual([{ label: 'Put in', value: '$1.40' }, { label: 'Earned', value: '+$0.01', positive: true }, { label: 'Kamino 6.2%', value: '$0.90' }, { label: 'Jupiter 5.1%', value: '$0.51' }])
    expect(s.withdrawKey).toBeNull()
    expect(s.walletNote).toBeNull()
  })
})
