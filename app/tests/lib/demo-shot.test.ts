import { describe, expect, it } from 'vitest'
import { demoMe } from '@/lib/demo-shot'
import { gardenTotals, statTiles, coinRows, lastPlantingLine, pauseState } from '@/lib/me-state'
import { formatUsd } from '@/lib/format'
import { buildScene } from '@/model/garden'
import { toGardenInput } from '@/lib/garden-input'
import type { MeResponse } from '@/lib/api'

const real = {
  user: { pubkey: 'Pub111', skrName: null, joinedAt: '2026-09-01T00:00:00.000Z', wateredAt: null },
  pot: { skrStakedRaw: '0', skrPutInRaw: '0', skrEarnedRaw: '0', skrPickedRaw: '0', skrPrincipalPickedRaw: '0', joinedValueRaw: '0', fruit: 0, nextFruitProgress: 0, skrUnstakingRaw: '0', skrUnstakeReadyAt: null, storeRaw: '0', storePutInRaw: '0', storeEarnedRaw: '0', storeRedeemRate: null, skrUsd: 0.0183, storeUsd: 73, asOf: '2026-10-05T00:00:00.000Z' },
  holdings: [], manager: { managed: true, stop: 'balanced', pins: {}, changedDay: null, undoAvailable: false, why: null, fallback: null, stopSplit: {} },
  history: { plantings: [], picks: [] }, nextPlanting: { pendingCents: 0, thresholdCents: 200, capLeftCents: 0, asset: 'SKR' }, lastReceipt: null, basket: null,
  wallets: [], rules: { allocation: {} },
} as unknown as MeResponse

describe('demo shot', () => {
  const now = new Date('2026-10-05T10:00:00-07:00')
  const me = demoMe(real, now)
  it('reads $420.69, put in $396.00, earned $24.69', () => {
    const t = gardenTotals(me)
    expect(formatUsd(Math.round(t.valueUsd! * 100))).toBe('$420.69')
    expect(statTiles(t).map((s) => s.value)).toEqual(['$396.00', '$24.69'])
  })
  it('lists SKR, stORE, USDC on Kamino, SOL on Jupiter, rows summing to the total', () => {
    const rows = coinRows(me)
    expect(rows.map((r) => r.key)).toEqual(['SKR', 'stORE', 'USDC_LEND:kamino_klend', 'SOL_LEND:jupiter_lend'])
    expect(rows.map((r) => r.usd)).toEqual(['$231.38', '$126.21', '$42.07', '$21.03'])
    expect(rows[0].locked).toBe(true)
  })
  it('is on, with a last planting line, no buds, no relink, terms accepted', () => {
    expect(pauseState(me.wallets).line).toBe('On. Planting your change.')
    expect(lastPlantingLine(me.lastReceipt)).toMatch(/^Last planting Oct 3: \$3\.12 became/)
    const scene = buildScene(toGardenInput(me, now))
    expect(scene.unrevealed).toBe(0)
    expect(scene.parts.filter((p) => p.kind === 'pup').length).toBe(4)
    expect(me.relink?.needed).toBe(false)
    expect(me.terms?.acceptedVersion).toBe(me.terms?.currentVersion)
  })
})
