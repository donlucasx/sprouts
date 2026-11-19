import { describe, it, expect } from 'vitest'
import { joinsLine } from '@/lib/opening'

const opening = { plantedCents: 320, waiting: [{ asset: 'USDC_LEND' as const, afterCents: 500 }, { asset: 'hSOL' as const, afterCents: 1000 }] }

describe('joinsLine', () => {
  it('is null when the API sends no opening', () => {
    expect(joinsLine(undefined, 'hSOL')).toBeNull()
    expect(joinsLine({}, 'hSOL')).toBeNull()
    expect(joinsLine({ opening: null }, 'hSOL')).toBeNull()
  })
  it('names the planted amount a waiting coin joins at', () => {
    expect(joinsLine({ opening }, 'hSOL')).toBe('Joins your garden after $10 planted')
    expect(joinsLine({ opening }, 'USDC_LEND')).toBe('Joins your garden after $5 planted')
    expect(joinsLine({ opening }, 'SKR')).toBeNull()
  })
})
