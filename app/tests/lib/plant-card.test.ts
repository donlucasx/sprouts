import { describe, it, expect } from 'vitest'
import { plantCard } from '@/lib/plant-card'
import type { MeResponse } from '@/lib/api'

const pot = { skrStakedRaw: '34900000', skrEarnedRaw: '2000000', skrUsd: 0.5 } as MeResponse['pot']
const hsol = { asset: 'hSOL', heldRaw: '12300000', putInCents: 203, valueUsd: 2.07, earnedUsd: 0.04, earnedUnderlyingRaw: '1' } as const
const me = (asset: string, pendingCents: number) =>
  ({ pot, holdings: [hsol], positions: [], nextPlanting: { pendingCents, thresholdCents: 100, capLeftCents: 0, asset } }) as unknown as MeResponse

describe('plantCard (R587: what a tapped plant tells you)', () => {
  it("SKR: Home's row in small: value, green earned, locked; the next planting while its change builds", () => {
    const c = plantCard(me('SKR', 40), 'SKR')
    expect(c).toMatchObject({ title: 'Seeker', where: 'Locked to your Seed Vault', earned: { text: '+$1.00', positive: true }, next: 'Next planting: $0.40 of $1.00' })
    expect(c.value).toMatch(/^\$/)
    expect(c.row?.key).toBe('SKR')
  })
  it('the next planting only on the coin it goes to, and only with change waiting', () => {
    expect(plantCard(me('hSOL', 40), 'SKR').next).toBeNull()
    expect(plantCard(me('SKR', 0), 'SKR').next).toBeNull()
  })
  it('a coin with nothing in it says so, with no numbers and nothing to open', () => {
    expect(plantCard(me('SKR', 0), 'cbBTC')).toMatchObject({ where: 'Nothing planted here yet', value: null, earned: null, row: null })
  })
})
