import { describe, it, expect } from 'vitest'
import { ADMIN_KEY_LINE, DISCLOSURES, PRECISE_GUARANTEE, PRICE_LINE } from '@/lib/settings-copy'
import { POOL_FULL_LINE } from '@/lib/lend-withdraw'
import { MANAGER_LINE } from '@/model/manager'
import { PUBLIC_GUARANTEE, RELINK, WEB_LINK_TRUST } from '@/lib/relink'

describe('Settings > About Sprouts (spec 6.2, 11)', () => {
  it('the titles, in order', () =>
    expect(DISCLOSURES.map(([h]) => h)).toEqual([
      'How Sprouts holds your money',
      'Prices and keys',
      'What "earned" means',
      'Watering',
      'Fees',
      'Where your lending goes',
      'If a pool is full',
      'Kamino and where you live',
      'Signed in',
      'ORE, if you choose it',
      'What the Yield Manager can buy',
      'Not advice',
    ]))
  it('How Sprouts holds your money opens with the precise sentence, verbatim, and says what an old approval still allows', () => {
    expect(PRECISE_GUARANTEE).toBe(
      "Once you re-link, Sprouts' server can only pull through the Sprouts program: at most your $5 daily limit, and only in a transaction that leaves at least 98.5% of that value (99.9% for USDC lending), at a live oracle price, in your own allowed coins, lending positions or SKR stake; otherwise it reverts. The server still chooses when, which leg and how much up to the limit; rounding remainders carry to your next planting. Only Sprouts' offline admin key can change these rules.",
    )
    expect(DISCLOSURES[0][1].startsWith(PRECISE_GUARANTEE)).toBe(true)
    expect(DISCLOSURES[0][1]).toContain('stays on chain under the old rules until you re-link or revoke it')
  })
  it('lists the venues and the cap, the geo line, free lending, the admin key, the full-pool line', () => {
    const all = DISCLOSURES.map(([, p]) => p).join(' ')
    for (const s of [
      'Kamino Lend',
      'Jupiter Lend',
      '60%',
      'marginfi and Lulo',
      'the US and UK',
      'Lending is free',
      "Sprouts' offline admin key",
      POOL_FULL_LINE,
    ])
      expect(all).toContain(s)
  })
  it('the stale lines are gone: no "withdraw them for you", no retired coin, no "six coins"; no dashes; never sells stays', () => {
    for (const [h, p] of DISCLOSURES) {
      if (h !== 'ORE, if you choose it') expect(p).not.toMatch(/withdraw (them|it) for you/)
      expect(p).not.toMatch(/JitoSOL|JupSOL|six coins/)
      expect(h + p).not.toMatch(/[–—]/)
    }
    expect(MANAGER_LINE).toContain('Never sells what you hold.')
  })
  it("the guarantee carries C6's web-link line from the one shared constant, right after the precise sentence", () =>
    expect(DISCLOSURES[0][1].startsWith(`${PRECISE_GUARANTEE} ${WEB_LINK_TRUST}`)).toBe(true))
  it('price honesty (contracts 2.6, R324) and the admin key (R299) sit in their own row, not in the guarantee; no SKR price line yet (fix round 1, I1)', () => {
    expect(PRICE_LINE).toBe("Prices come from Pyth's free price accounts; cbBTC is priced at most 10 minutes ago.")
    expect(ADMIN_KEY_LINE).toBe("The admin key is kept on the owner's laptop, never on the server.")
    expect(DISCLOSURES[1]).toEqual(['Prices and keys', `${PRICE_LINE} ${ADMIN_KEY_LINE}`])
    expect(DISCLOSURES[0][1]).not.toContain(PRICE_LINE)
    expect(DISCLOSURES[0][1]).not.toContain(ADMIN_KEY_LINE)
    expect(DISCLOSURES.map(([, p]) => p).join(' ')).not.toMatch(/price source|does not check its price/)
  })
  it("R300's public promise is one constant, shared with the re-link card", () => {
    expect(PUBLIC_GUARANTEE).toBe(
      'Even if our server is hacked, it can only move your daily round-up (max $5) into your own savings. Never anywhere else.',
    )
    expect(RELINK.body).toBe(PUBLIC_GUARANTEE)
  })
  it('fees: no Sprouts fee on lending, the network fee passes through (R266, R318)', () => {
    const fees = DISCLOSURES.find(([h]) => h === 'Fees')![1]
    expect(fees).toContain('Lending is free')
    expect(fees).toContain('passes through the network fee (about $0.03)')
  })
})
