import { describe, it, expect } from 'vitest'
import { ADMIN_KEY_LINE, DISCLOSURES, PRECISE_GUARANTEE, PRICE_LINE } from '@/lib/settings-copy'
import { POOL_FULL_LINE } from '@/lib/lend-withdraw'
import { MANAGER_LINE } from '@/model/manager'
import { PUBLIC_GUARANTEE, RELINK, WEB_LINK_TRUST } from '@/lib/relink'

describe('Settings > About Sprouts (spec 6.2, 11; R452: six questions)', () => {
  it('the titles, in order', () =>
    expect(DISCLOSURES.map(([h]) => h)).toEqual([
      'Who holds my money?',
      'What does it cost?',
      'Where does lending go?',
      'What does "earned" mean?',
      'What can Sprouts buy?',
      'How do I stop it?',
    ]))
  it('How Sprouts holds your money opens with the precise sentence, verbatim, and says what an old approval still allows', () => {
    expect(PRECISE_GUARANTEE).toBe(
      "Once you re-link, Sprouts' server can only pull through the Sprouts program: at most your $5 daily limit, and only in a transaction that leaves at least 98.5% of that value (99.4% for USDC lending), at a live oracle price, in the coins Sprouts has enabled, lending positions or SKR stake; otherwise it reverts. The server still chooses when, which leg and how much up to the limit; rounding remainders carry to your next planting. Only Sprouts' offline admin key can change these rules or replace the program; your $5-a-day limit still holds.",
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
      'restricts some regions',   // R367 (10-05): softened, no named countries
      'including USDC and SOL lending',
      "Sprouts' offline admin key",
      POOL_FULL_LINE,
    ])
      expect(all).toContain(s)
  })
  it('the stale lines are gone: no "withdraw them for you", no retired coin, no "six coins"; no dashes; never sells stays', () => {
    for (const [h, p] of DISCLOSURES) {
      if (h !== 'What can Sprouts buy?') expect(p).not.toMatch(/withdraw (them|it) for you/)
      expect(p).not.toMatch(/JitoSOL|JupSOL|six coins/)
      expect(h + p).not.toMatch(/[–—]/)
    }
    expect(MANAGER_LINE).toContain('never sells what you hold.')
  })
  it("the guarantee carries C6's web-link line from the one shared constant, right after the precise sentence", () =>
    expect(DISCLOSURES[0][1].startsWith(`${PRECISE_GUARANTEE} ${WEB_LINK_TRUST}`)).toBe(true))
  it('price honesty (contracts 2.6, R324) and the admin key (R299) are their own paragraph, never inside the guarantee; no SKR price line yet (fix round 1, I1)', () => {
    expect(PRICE_LINE).toBe("Prices come from Pyth. cbBTC's price can be up to 10 minutes old.")
    expect(ADMIN_KEY_LINE).toBe("The admin key lives on the owner's laptop, not the server.")
    const [guarantee, prices] = DISCLOSURES[0][1].split('\n\n')
    expect(prices).toBe(`${PRICE_LINE} ${ADMIN_KEY_LINE}`)
    expect(guarantee).not.toContain(PRICE_LINE)
    expect(guarantee).not.toContain(ADMIN_KEY_LINE)
    expect(DISCLOSURES.map(([, p]) => p).join(' ')).not.toMatch(/price source|does not check its price/)
  })
  it("R300's public promise is one constant, shared with the re-link card", () => {
    expect(PUBLIC_GUARANTEE).toBe(
      'Even if our server is hacked, neither it nor the AI can move more than your daily round-up (max $5), and only into your own savings.',
    )
    expect(RELINK.body).toBe(PUBLIC_GUARANTEE)
  })
  it('fees: 0.5% on every planting incl. USDC and SOL lending; Sprouts pays the network fee; account rent from your SOL at link or top-up, as the Terms say (R266, audits/fee-model, Task 17b)', () => {
    const fees = DISCLOSURES.find(([h]) => h === 'What does it cost?')![1]
    expect(fees).toBe(
      "Sprouts takes 0.5% of each planting, in USDC, including USDC and SOL lending. There is nothing on interest, withdrawals or moves. Sprouts pays the network fee for each planting. Your coin and lending accounts need a small one-time rent in SOL (about $0.30 each). When you link this phone's wallet or add USDC, the accounts for the coins you have switched on are set up from your wallet's SOL, and the screen shows the cost before you approve. Sprouts opens any others itself. It's yours: you get it back if you empty and close the account. Leftovers from rounding carry to your next planting. Fees are on every receipt. Pro (the Yield Manager, automatic lending and tax reports) is included free during launch.",
    )
    expect(fees).toContain('including USDC and SOL lending')
    expect(fees).toContain('Sprouts pays the network fee for each planting.')
    // Task 17b (Kimi 7): the rent is no longer always Sprouts'; it comes back on close, never on revoke
    expect(fees).not.toContain('one-time account rent for your coin')
    expect(fees).toContain("you get it back if you empty and close the account")
    expect(fees).not.toMatch(/revoke|—/)
    const buy = DISCLOSURES.find(([h]) => h === 'What can Sprouts buy?')![1]
    expect(buy).not.toMatch(/Sprouts pays (the|each coin's) one-time account rent/)
    expect(buy).toContain('Each coin needs a one-time account rent (see What does it cost?).')
    expect(fees).not.toMatch(/passes through|about \$0\.03/)
  })
})
