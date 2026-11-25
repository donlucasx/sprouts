import { describe, it, expect } from 'vitest'
import { SAFETY_HEADING, CAN, CANT, LINK_STEPS, LINK_FEES, APPROVAL_WARN_TITLE, APPROVAL_WARN_BODY, OTHER_WALLET_LINE, phoneUsdcNote, phoneSolNote, SETUP_RENT_LAMPORTS, setupLine, setupAccountsOf, linkApprovalPath } from '../../src/lib/safety-copy'
import * as web from '../../../api/src/lib/link-safety-copy'

describe('safety copy (mirrors api/src/app/safety.tsx)', () => {
  it('keeps the phone-sized shape: two can, two can\'t, and no em dashes', () => {
    expect(CAN).toHaveLength(2)   // 11-25 (his ruling): the fee is its own line
    expect(CANT).toHaveLength(2)
    for (const l of [...CAN, ...CANT, ...LINK_STEPS, LINK_FEES, APPROVAL_WARN_TITLE, APPROVAL_WARN_BODY, OTHER_WALLET_LINE]) expect(l).not.toMatch(/—/)
  })
  // his ask 10-28: /link says the app's Link a wallet lines word for word
  it('heading matches /link', () => {
    expect(SAFETY_HEADING).toBe("What Sprouts can and can't do")
  })
  it('matches the lines under the code box on /link', () => {
    expect(web.LINK_STEPS).toEqual(LINK_STEPS)
    expect(web.CAN).toEqual(CAN)
    expect(web.CANT).toEqual(CANT)
    expect(web.APPROVAL_WARN_TITLE).toBe(APPROVAL_WARN_TITLE)
    expect(web.APPROVAL_WARN_BODY).toBe(APPROVAL_WARN_BODY)
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

describe('phoneSolNote (0.1.10)', () => {
  it('says so before the approval when the wallet has under 0.01 SOL', () => {
    expect(phoneSolNote('0')).toMatch(/^This wallet needs about 0\.01 SOL to approve\./)
    expect(phoneSolNote('9999999')).not.toBeNull()
  })
  it('no note with 0.01 SOL or more, or when the balance could not be read', () => {
    expect(phoneSolNote('10000000')).toBeNull()
    expect(phoneSolNote(null)).toBeNull()
    expect(phoneSolNote(undefined)).toBeNull()
    expect(phoneSolNote('abc')).toBeNull()
  })
})

describe('Task 17b (user rent): the setup cost line and the count it binds', () => {
  it('SETUP_RENT_LAMPORTS is one token account (165 bytes) of rent', () => {
    expect(SETUP_RENT_LAMPORTS).toBe(2_039_280n)
  })
  it("says the founder's line (D4): dollars from the phone's own SOL price, rounded to cents; 1 is singular", () => {
    // 3 x 2,039,280 lamports = 0.00611784 SOL; at $150 = $0.9177 -> $0.92
    expect(setupLine(3, 150)).toBe("Includes $0.92 one-time setup for 3 coin accounts, paid in SOL. It's yours: you get it back if you empty and close them.")
    // 1 x 0.00203928 SOL at $147.11 = $0.29999... -> $0.30
    expect(setupLine(1, 147.11)).toBe("Includes $0.30 one-time setup for 1 coin account, paid in SOL. It's yours: you get it back if you empty and close it.")
    // 0.01427496 SOL at $200 = $2.854992: rounded UP (review fix: the line never understates)
    expect(setupLine(7, 200)).toBe("Includes $2.86 one-time setup for 7 coin accounts, paid in SOL. It's yours: you get it back if you empty and close them.")
  })
  it('no price (or an unusable one): the SOL amount instead', () => {
    for (const p of [null, undefined, 0, -5, Number.NaN, Infinity]) {
      expect(setupLine(3, p)).toBe("Includes about 0.0062 SOL one-time setup for 3 coin accounts. It's yours: you get it back if you empty and close them.")
    }
    expect(setupLine(1, null)).toBe("Includes about 0.0021 SOL one-time setup for 1 coin account. It's yours: you get it back if you empty and close it.")
  })
  it('review fix: never understates (cents and SOL rounded up, in integers, no float noise)', () => {
    // 1 x 2,039,280 lamports at $50 = $0.101964 -> $0.11 (round-to-nearest would say $0.10)
    expect(setupLine(1, 50)).toMatch(/^Includes \$0\.11 /)
    // 5 x 2,039,280 = 10,196,400 lamports at $100 = $1.01964 -> $1.02
    expect(setupLine(5, 100)).toMatch(/^Includes \$1\.02 /)
    // a price so small the cost is under a cent still shows a cent, never $0.00
    expect(setupLine(1, 0.001)).toMatch(/^Includes \$0\.01 /)
    // every count 1..7 and a spread of prices: the dollars shown are >= the exact cost
    for (let n = 1; n <= 7; n++) for (const p of [0.5, 17.3, 99.99, 147.11, 150, 233.456, 1000]) {
      const shown = Number(setupLine(n, p)!.match(/\$(\d+\.\d\d)/)![1])
      expect(shown * 1e9).toBeGreaterThanOrEqual(n * 2_039_280 * p - 1e-3)
      expect(shown).toBeLessThanOrEqual(Math.ceil((n * 2_039_280 * p) / 1e7) / 100 + 0.01)
    }
  })
  it('no line at 0 or for a count that is not a whole number; never an em dash', () => {
    for (const n of [0, -1, 1.5, Number.NaN]) expect(setupLine(n, 150)).toBeNull()
    for (const n of [1, 2, 3, 7]) for (const p of [150, null]) expect(setupLine(n, p)).not.toMatch(/—|–/)
  })
  it('setupAccountsOf: the count /api/me/usdc?setup=1 sent, as a whole number 0..cap (anything else is 0, no line, no creates)', () => {
    expect(setupAccountsOf(3)).toBe(3)
    expect(setupAccountsOf(7)).toBe(7)
    expect(setupAccountsOf(12)).toBe(7)
    expect(setupAccountsOf(5, 3)).toBe(3)
    expect(setupAccountsOf(2, 3)).toBe(2)
    for (const bad of [undefined, null, 0, -1, 1.5, '3', Number.NaN, Infinity, {}]) expect(setupAccountsOf(bad)).toBe(0)
  })
  it("linkApprovalPath: the setup param only when the screen showed a count (none = today's request exactly)", () => {
    expect(linkApprovalPath('ABC123', 'W1', 0)).toBe('/api/link/ABC123?wallet=W1')
    expect(linkApprovalPath('ABC123', 'W1', 3)).toBe('/api/link/ABC123?wallet=W1&setup=3')
  })
  it("the no-SOL note no longer says the deposit is refunded when you revoke (rent comes back when an account is emptied and closed)", () => {
    const n = phoneSolNote('0')!
    expect(n).not.toMatch(/revoke/i)
    expect(n).toBe('This wallet needs about 0.01 SOL to approve. It covers the one-time rent and the network fee. Add a little SOL first.')
  })
})

// 0.1.13 Spanish pass P9: /link and /faqs in Spanish say the app's es lines word for word (the same drift rule as English above).
describe('safety copy in Spanish (mirrors api/src/lib/link-safety-copy.ts SAFETY_ES)', () => {
  it('the web Spanish equals the app es lines for the shared keys', async () => {
    const { es } = await import('../../src/i18n/es')
    expect(web.SAFETY_ES.heading).toBe(es['link.safety.heading'])
    expect(web.SAFETY_ES.steps).toEqual(['link.step.1', 'link.step.2', 'link.step.3'].map((k) => es[k as keyof typeof es]))
    expect(web.SAFETY_ES.can).toEqual(['link.can.plants', 'link.can.fee'].map((k) => es[k as keyof typeof es]))
    expect(web.SAFETY_ES.cant).toEqual(['link.cant.send', 'link.cant.touch'].map((k) => es[k as keyof typeof es]))
    expect(web.SAFETY_ES.warnTitle).toBe(es['link.approval.title'])
    expect(web.SAFETY_ES.warnBody).toBe(es['link.approval.body'])
    expect(web.safetyCopy('en')).toEqual({ heading: SAFETY_HEADING, steps: LINK_STEPS, can: CAN, cant: CANT, warnTitle: APPROVAL_WARN_TITLE, warnBody: APPROVAL_WARN_BODY })
  })
  it("/faqs in Spanish says the app's es How it works and cost words", async () => {
    const { es } = await import('../../src/i18n/es')
    const { readFileSync } = await import('node:fs')
    const faqs = readFileSync(new URL('../../../api/src/app/faqs/faqs-view.tsx', import.meta.url), 'utf8')
    expect(faqs).toContain(`["¿Cómo funciona?", "${es['about.how']!.split(' Nunca mueve')[0]}"]`)
    expect(faqs).toContain(`["${es['about.cost.title']}", "${es['about.cost']}"]`)
  })
})
