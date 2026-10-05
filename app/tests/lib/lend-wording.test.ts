import { describe, it, expect } from 'vitest'
import { plantedLine, plantedWhat } from '@/lib/format'
import { lastPlantingLine } from '@/lib/me-state'
import { plantingNotice } from '@/lib/notices'
import type { MeResponse } from '@/lib/api'

const receipt = (o: Partial<NonNullable<MeResponse['lastReceipt']>>) => ({ ts: '2026-10-05T14:00:00Z', usdcPulledCents: 200, networkFeeCents: 0, asset: 'SOL_LEND', amountOutRaw: '1340000', feeCents: 0, feeAmountRaw: '0', usdPrice: 150, signature: 's', venue: 'kamino_klend', ...o }) as NonNullable<MeResponse['lastReceipt']>

describe('Review Focus 2: a lending amount is in receipt units and is never shown as USDC or SOL', () => {
  it('a SOL lending planting never formats kSOL as SOL', () => {
    const line = plantedLine({ usdcInCents: 200, asset: 'SOL_LEND', amountOutRaw: '1340000', usdPrice: 150, feeCents: 0, feeAmountRaw: '0', venue: 'kamino_klend' })
    expect(line).toBe('$2.00 went into SOL lending (Kamino), no Sprouts fee')
    expect(line).not.toMatch(/\d SOL/)
    expect(lastPlantingLine(receipt({}))).toBe('Last planting Oct 5: $2.00 went into SOL lending (Kamino)')
    expect(plantingNotice({ asset: 'USDC_LEND', usdcInCents: 200, amountOutRaw: '1661200', venue: 'jupiter_lend' }, { skrUsd: null, storeUsd: null })).toBe('Your change was planted: $2.00 went into USDC lending (Jupiter).')
  })
  it('a lending row from before venues (venue absent) still reads', () => {
    expect(plantedWhat({ usdcInCents: 150, asset: 'USDC_LEND', amountOutRaw: '1', usdPrice: null })).toBe('$1.50 went into USDC lending')
  })
  it('coins read as before', () => {
    expect(plantedWhat({ usdcInCents: 203, asset: 'hSOL', amountOutRaw: '12300000', usdPrice: 168.3 })).toBe('$2.03 became 0.0123 hSOL ($2.07)')
    expect(plantingNotice({ asset: 'SKR', usdcInCents: 23, amountOutRaw: '12480000' }, { skrUsd: 0.02, storeUsd: null })).toBe('Your change was planted: $0.23 became 12.48 SKR ($0.25).')
  })
})

describe('Review Focus 3: lending never says "fee under 1 cent" (R266: no fee on lending)', () => {
  it('a lending leg with feeCents 0 and feeAmountRaw "0" says no Sprouts fee; a coin with the same fields keeps its clause', () => {
    const lend = plantedLine({ usdcInCents: 200, asset: 'USDC_LEND', amountOutRaw: '1661200', usdPrice: 1, feeCents: 0, feeAmountRaw: '0', venue: 'kamino_klend' })
    expect(lend).not.toContain('fee under')
    expect(lend).toContain('no Sprouts fee')
    expect(plantedLine({ usdcInCents: 200, asset: 'hSOL', amountOutRaw: '12300000', usdPrice: 168, feeCents: 0, feeAmountRaw: '0' })).toBe('$2.00 became 0.0123 hSOL ($2.07), fee under 1 cent')
  })
})
