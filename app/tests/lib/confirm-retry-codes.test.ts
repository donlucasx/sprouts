import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/session', () => ({ loadSession: async () => null }))
import { ApiError } from '@/lib/api'
import { confirmWithRetries, isNotOnChainYet, LINK_NOT_ON_CHAIN, RELINK_NOT_ON_CHAIN, type NotOnChainMatch } from '@/lib/confirm-retry'

// 0.1.13 Spanish pass P8: the retry decides on the API's `code`, and on the English stem only when an older server sends none.
// Each case is the same decision three ways: a new server in English, a new server in Spanish, and a 0.1.12-era server ({ error } only).

const err = (status: number, body: Record<string, unknown>) => new ApiError(status, String(body.error), body)

const LINK = {
  en: 'No delegation found for this wallet yet. Sign the approval first.',
  es: 'Todavía no hay una delegación para esta billetera. Firma la aprobación primero.',
}
const RELINK = {
  en: 'No re-link found on chain yet. Check again in a minute.',
  es: 'Todavía no se ve la nueva vinculación on-chain. Vuelve a mirar en un minuto.',
}

const cases: { name: string; m: NotOnChainMatch; code: string; text: { en: string; es: string }; other: NotOnChainMatch }[] = [
  { name: 'link/confirm', m: LINK_NOT_ON_CHAIN, code: 'no_delegation', text: LINK, other: RELINK_NOT_ON_CHAIN },
  { name: 'relink/confirm', m: RELINK_NOT_ON_CHAIN, code: 'relink_not_on_chain', text: RELINK, other: LINK_NOT_ON_CHAIN },
]

describe.each(cases)('isNotOnChainYet: $name', ({ m, code, text, other }) => {
  it('the late 409 is a late answer with { error, code } in English, with the code and Spanish text, and English-only (0.1.12 server)', () => {
    expect(isNotOnChainYet(err(409, { error: text.en, code }), m)).toBe(true)
    expect(isNotOnChainYet(err(409, { error: text.es, code }), m)).toBe(true)
    expect(isNotOnChainYet(err(409, { error: text.en }), m)).toBe(true)
  })
  it('a Spanish late sentence without a code is not recognised (only an English-era server omits the code)', () => {
    expect(isNotOnChainYet(err(409, { error: text.es }), m)).toBe(false)
  })
  it("another refusal is never a late answer, in any of the three shapes", () => {
    expect(isNotOnChainYet(err(409, { error: 'This code was already used with another wallet.', code: 'code_other_wallet' }), m)).toBe(false)
    expect(isNotOnChainYet(err(409, { error: 'Este código ya se usó con otra billetera.', code: 'code_other_wallet' }), m)).toBe(false)
    expect(isNotOnChainYet(err(409, { error: 'This code was already used with another wallet.' }), m)).toBe(false)
  })
  it('a code decides alone: a different code is not late even if the English stem appears in the text', () => {
    expect(isNotOnChainYet(err(409, { error: text.en, code: 'wrong_transaction' }), m)).toBe(false)
  })
  it("the other route's late answer does not match this route", () => {
    const otherText = other === LINK_NOT_ON_CHAIN ? LINK : RELINK
    expect(isNotOnChainYet(err(409, { error: otherText.en, code: other.code }), m)).toBe(false)
    expect(isNotOnChainYet(err(409, { error: otherText.en }), m)).toBe(false)
  })
  it('only a 409 counts', () => {
    expect(isNotOnChainYet(err(400, { error: text.en, code }), m)).toBe(false)
    expect(isNotOnChainYet(err(400, { error: text.en }), m)).toBe(false)
  })
})

describe('confirmWithRetries: the same retries against a new server (Spanish + code) and a 0.1.12-era server (English only)', () => {
  for (const [label, body] of [
    ['code + Spanish', { error: LINK.es, code: 'no_delegation' }],
    ['English only', { error: LINK.en }],
  ] as const) {
    it(`${label}: late twice, then lands, with no new signature`, async () => {
      let n = 0
      const send = vi.fn(async (_a: number) => {
        if (n++ < 2) throw err(409, body)
        return { linked: true }
      })
      await confirmWithRetries(send, { notOnChainYet: LINK_NOT_ON_CHAIN, sleep: async () => {} })
      expect(send.mock.calls.map((c) => c[0])).toEqual([0, 1, 2])
    })
    it(`${label}: a real refusal is thrown at once`, async () => {
      const refusal = err(409, 'code' in body ? { error: 'Esta billetera está vinculada a otro Seeker.', code: 'wallet_taken' } : { error: 'This wallet is linked to another Seeker. Revoke it there first.' })
      const send = vi.fn(async () => {
        throw refusal
      })
      await expect(confirmWithRetries(send, { notOnChainYet: LINK_NOT_ON_CHAIN, sleep: async () => {} })).rejects.toBe(refusal)
      expect(send).toHaveBeenCalledTimes(1)
    })
  }
})
