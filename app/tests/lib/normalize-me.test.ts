import { describe, it, expect } from 'vitest'
import { normalizeMe, gardenTotals, coinRows, lastPlantingLine } from '@/lib/me-state'
import { toGardenInput } from '@/lib/garden-input'
import { buildScene } from '@/model/garden'
import { ASSETS, isLend, isRetired, liveSplit, livePins, VENUE_NAME } from '@/lib/coins'
import { COIN_NAME, COIN_NAME_LONG, DECIMALS, legLabel } from '@/lib/format'
import type { MeResponse } from '@/lib/api'

/** /api/me as production answers on 10-04 (main a6d6f32): retired keys, no lending fields. */
const prod = {
  user: { pubkey: 'U', skrName: null, joinedAt: '2026-09-25T00:00:00.000Z', wateredAt: null },
  pot: { skrStakedRaw: '34900000', skrPutInRaw: '1000000', skrEarnedRaw: '0', skrPickedRaw: '0', skrPrincipalPickedRaw: '0', joinedValueRaw: '0', fruit: 0, nextFruitProgress: 0, skrUnstakingRaw: '0', skrUnstakeReadyAt: null, storeRaw: '0', storePutInRaw: '0', storeEarnedRaw: '0', storeRedeemRate: null, skrUsd: 0.0183, storeUsd: null, asOf: '2026-10-04T00:00:00.000Z' },
  holdings: [
    { asset: 'JitoSOL', heldRaw: '12939970', putInCents: 200, valueUsd: 2.4, earnedUsd: 0.01, earnedUnderlyingRaw: '1' },
    { asset: 'hSOL', heldRaw: '12300000', putInCents: 203, valueUsd: 2.07, earnedUsd: 0.04, earnedUnderlyingRaw: '1' },
  ],
  manager: { managed: true, stop: 'balanced', pins: { JitoSOL: 15, hSOL: 20 }, changedDay: null, undoAvailable: false, why: null, fallback: null, stopSplit: { SKR: 45, stORE: 0, hSOL: 20, JitoSOL: 15, JupSOL: 10, cbBTC: 10 } },
  history: { plantings: [{ id: 'j', ts: '2026-10-01T10:00:00.000Z', asset: 'JitoSOL', usdcInCents: 200, amountOutRaw: '12939970', feeCents: 1, signature: null }, { id: 'h', ts: '2026-10-02T10:00:00.000Z', asset: 'hSOL', usdcInCents: 203, amountOutRaw: '12300000', feeCents: 1, signature: null }], picks: [] },
  nextPlanting: { pendingCents: 120, thresholdCents: 200, capLeftCents: 500, asset: 'JupSOL' },
  lastReceipt: { ts: '2026-10-01T10:00:00.000Z', usdcPulledCents: 203, networkFeeCents: 3, asset: 'JitoSOL', amountOutRaw: '12939970', feeCents: 1, usdPrice: 185, signature: 's' },
  basket: null,
  wallets: [{ pubkey: 'U', status: 'active', dailyCapCents: 500 }],
  rules: { roundupOn: true, roundupToCents: 100, pctOn: true, pctBps: 100, pctThresholdCents: 10000, plantThresholdCents: 200, plantMaxDays: 7, dailyCapCents: 500, managed: true, stop: 'balanced', pins: { JitoSOL: 15, hSOL: 20 }, allocation: { SKR: 45, stORE: 0, hSOL: 20, JitoSOL: 15, JupSOL: 10, cbBTC: 10 } },
} as unknown as MeResponse

describe('the six legs (contracts 1.1)', () => {
  it('lists the live legs in the spec order; JitoSOL and JupSOL are retired; two are lending', () => {
    expect(ASSETS).toEqual(['SKR', 'stORE', 'USDC_LEND', 'SOL_LEND', 'hSOL', 'cbBTC'])
    expect(['JitoSOL', 'JupSOL', 'hSOL', 'USDC_LEND'].map(isRetired)).toEqual([true, true, false, false])
    expect(['USDC_LEND', 'SOL_LEND', 'hSOL'].map(isLend)).toEqual([true, true, false])
    expect(VENUE_NAME.kamino_klend).toBe('Kamino')
    expect(VENUE_NAME.jupiter_lend).toBe('Jupiter')
  })
  it('names and decimals: the underlying for lending (6 and 9), short and long names', () => {
    expect(DECIMALS).toEqual({ SKR: 6, stORE: 11, USDC_LEND: 6, SOL_LEND: 9, hSOL: 9, cbBTC: 8 })
    expect([COIN_NAME.USDC_LEND, COIN_NAME.SOL_LEND, COIN_NAME_LONG.USDC_LEND, COIN_NAME_LONG.SOL_LEND]).toEqual(['USDC', 'SOL', 'USDC lending', 'SOL lending'])
    expect(legLabel('USDC_LEND', 'kamino_klend')).toBe('USDC lending (Kamino)')
    expect(legLabel('SOL_LEND', null)).toBe('SOL lending')
    expect(legLabel('hSOL')).toBe('hSOL')
  })
  it('liveSplit keeps live keys, zero-fills missing ones and folds retired shares into SKR so the sum stays 100', () => {
    expect(liveSplit({ SKR: 45, stORE: 0, hSOL: 20, JitoSOL: 15, JupSOL: 10, cbBTC: 10 })).toEqual({ SKR: 70, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 20, cbBTC: 10 })
    expect(liveSplit({ SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 })).toEqual({ SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 })
    expect(liveSplit(null)).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 })
    expect(livePins({ JitoSOL: 15, hSOL: 20, USDC_LEND: 5 })).toEqual({ hSOL: 20, USDC_LEND: 5 })
  })
})

describe("Review Focus 1: today's production read", () => {
  const me = normalizeMe(prod)
  it('drops every retired coin and reads only live keys', () => {
    expect(me.holdings.map((h) => h.asset)).toEqual(['hSOL'])
    expect(me.rules.allocation).toEqual({ SKR: 70, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 20, cbBTC: 10 })
    expect(me.manager.stopSplit).toEqual({ SKR: 70, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 20, cbBTC: 10 })
    expect(me.rules.pins).toEqual({ hSOL: 20 })
    expect(me.manager.pins).toEqual({ hSOL: 20 })
    expect(me.nextPlanting.asset).toBe('SKR')
    expect(me.lastReceipt).toBeNull()
  })
  it('Home, the garden and the totals work with no lending fields at all', () => {
    expect(gardenTotals(me).valueUsd).toBeCloseTo((34.9 * 0.0183) + 2.07, 6)   // the JitoSOL 2.40 is not counted
    expect(coinRows(me).map((r) => r.asset)).toEqual(['SKR', 'hSOL'])
    expect(lastPlantingLine(me.lastReceipt)).toBeNull()
    const g = toGardenInput(me, new Date('2026-10-04T12:00:00-07:00'))
    expect(g.plantings.map((p) => p.asset)).toEqual(['hSOL'])   // the JitoSOL sprout is gone (R281)
    const plants = buildScene(g).parts.flatMap((p) => (p.kind === 'plant' ? [p.plant] : []))
    expect(plants).toEqual(['hsol'])   // no SKR planting in this history; the JitoSOL snake plant is gone
    expect(JSON.stringify(me)).not.toMatch(/undefined|NaN/)
  })
  it('is idempotent', () => expect(normalizeMe(me)).toEqual(me))
})
