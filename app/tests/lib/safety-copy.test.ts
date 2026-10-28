import { describe, it, expect } from 'vitest'
import { CAN, CANT, LINK_INTRO, APPROVAL_WARN_TITLE, APPROVAL_WARN_BODY, OTHER_WALLET_LINE, phoneUsdcNote } from '../../src/lib/safety-copy'
import * as web from '../../../api/src/lib/link-safety-copy'

describe('safety copy (mirrors api/src/app/safety.tsx)', () => {
  it('keeps the phone-sized shape: one can, three can\'t, and no em dashes', () => {
    expect(CAN).toHaveLength(1)
    expect(CANT).toHaveLength(2)
    for (const l of [...CAN, ...CANT, LINK_INTRO, APPROVAL_WARN_TITLE, APPROVAL_WARN_BODY, OTHER_WALLET_LINE]) expect(l).not.toMatch(/—/)
  })
  // his ask 10-28: /link says the app's Link a wallet lines word for word
  it('matches the lines under the code box on /link', () => {
    expect(web.LINK_INTRO).toBe(LINK_INTRO)
    expect(web.CAN).toEqual(CAN)
    expect(web.CANT).toEqual(CANT)
  })
})

describe('phoneUsdcNote', () => {
  it('says the wallet has no USDC at zero', () => {
    // 10-26 copy review row 2: the wallet named, the amount to add
    expect(phoneUsdcNote('0', 200)).toBe('This wallet has no USDC. Add at least $2.00 to it so Sprouts can plant.')
  })
  it('names a balance under one planting', () => {
    expect(phoneUsdcNote('400000', 200)).toBe('This wallet has $0.40 of USDC. Add at least $1.60 to it so Sprouts can plant.')
  })
  it('says nothing at or above the threshold, or when the balance is unknown', () => {
    expect(phoneUsdcNote('2000000', 200)).toBeNull()
    expect(phoneUsdcNote(null, 200)).toBeNull()
    expect(phoneUsdcNote(undefined, 200)).toBeNull()
    expect(phoneUsdcNote('garbage', 200)).toBeNull()
  })
})
