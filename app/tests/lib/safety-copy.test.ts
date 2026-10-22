import { describe, it, expect } from 'vitest'
import { CAN, CANT, BEFORE_YOU_LINK, phoneUsdcNote } from '../../src/lib/safety-copy'

describe('safety copy (mirrors api/src/app/safety.tsx)', () => {
  it('keeps the phone-sized shape: one can, three can\'t, and no em dashes', () => {
    expect(CAN).toHaveLength(1)
    expect(CANT).toHaveLength(3)
    for (const l of [...CAN, ...CANT, ...BEFORE_YOU_LINK]) expect(l).not.toMatch(/—/)
  })
})

describe('phoneUsdcNote', () => {
  it('says the wallet has no USDC at zero', () => {
    expect(phoneUsdcNote('0', 200)).toBe(
      'This wallet has no USDC yet. Round-ups are paid from USDC, so add a few dollars before your first planting.',
    )
  })
  it('names a balance under one planting', () => {
    expect(phoneUsdcNote('400000', 200)).toMatch(/^This wallet holds \$0\.40 of USDC\./)
  })
  it('says nothing at or above the threshold, or when the balance is unknown', () => {
    expect(phoneUsdcNote('2000000', 200)).toBeNull()
    expect(phoneUsdcNote(null, 200)).toBeNull()
    expect(phoneUsdcNote(undefined, 200)).toBeNull()
    expect(phoneUsdcNote('garbage', 200)).toBeNull()
  })
})
