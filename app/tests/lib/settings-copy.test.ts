import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ADMIN_KEY_LINE, COST_LINE, DISCLOSURES, HOW_IT_WORKS, PRECISE_GUARANTEE, PRICE_LINE } from '@/lib/settings-copy'
import { POOL_FULL_LINE } from '@/lib/lend-withdraw'
import { MANAGER_LINE } from '@/model/manager'
import { PUBLIC_GUARANTEE, RELINK } from '@/lib/relink'

describe('Settings > About Sprouts (spec 6.2, 11; R452: six questions)', () => {
  it('the titles, in order', () =>
    expect(DISCLOSURES.map(([h]) => h)).toEqual([
      'Who holds my money?',
      'What does it cost?',
      'Where does lending go?',
      'What does "earned" mean?',
      'What can Sprouts buy?',
      'Can I pause or stop it?',
    ]))
  it("Who holds my money (copy pass 11-20): where the money sits, then the guarantee in plain words, the hacked line, the admin key and prices; an old approval's rules", () => {
    expect(PRECISE_GUARANTEE).toBe(
      "Sprouts' server can't send your money anywhere else, even if it were hacked. It can only pull through the Sprouts on-chain program, which allows at most your $5 daily limit, only into the coins, lending and SKR staking Sprouts offers, and only if at least 98.5% of the value arrives (99.4% for USDC lending) at a live oracle price. Otherwise nothing happens. The server picks when, which coin and how much, up to your limit. Only Sprouts' offline admin key can change these rules or replace the program, and your $5 limit still holds.",
    )
    const [where, guarantee, trust, session] = DISCLOSURES[0][1].split('\n\n')
    expect(where).toBe("Your coins and lending receipts sit in your own wallet. Your SKR is staked under your Seeker's key, and only that key can unstake it.")
    expect(guarantee).toBe(`${PRECISE_GUARANTEE} ${ADMIN_KEY_LINE} ${PRICE_LINE}`)
    expect(trust).toBe("Wallets linked on the web trust the link page when they link; your Seeker's own wallet doesn't. An approval made before you re-linked keeps the old rules until you re-link or revoke it.")
    expect(session).toBe('You stay signed in for seven days on this phone, and signing out ends it right away. Raising your daily limit or resuming a wallet asks your wallet to sign again. Watering moves no money and signs nothing.')
  })
  it('how it works: the draft words, pulled from the swapping wallet', () =>
    expect(HOW_IT_WORKS).toBe('Every swap you make rounds up to the next dollar. Once a day, Sprouts plants that change into your split, using USDC from the wallet that made the swap. What it buys stays in your own wallet. It never moves more than your daily limit, and you can pause or revoke it any time.'))
  it('"The list is fixed in code" is gone from the app (founder 10-27); pause or stop says the draft words', () => {
    expect(DISCLOSURES.map(([, p]) => p).join(' ')).not.toContain('fixed in code')
    expect(DISCLOSURES[5][1]).toBe("Turn Sprouts off at the top of Rules and nothing moves until you turn it back on. Revoke a wallet in Settings to end Sprouts' approval on chain. You can withdraw any coin or lending position at any time.")
  })
  it("/faqs says the app's How it works and cost words (Kimi copy item 4): no lending fee waiver, no linked-wallet line", () => {
    const faqs = readFileSync(new URL('../../../api/src/app/faqs/page.tsx', import.meta.url), 'utf8')
    expect(faqs).toContain(`["How does it work?", "${HOW_IT_WORKS.split(' It never moves')[0]}"]`)
    expect(faqs).toContain(`["What does it cost?", "${COST_LINE}"]`)
    expect(faqs).not.toMatch(/No fee on USDC or SOL lending|paid from the USDC in your linked wallet/)
  })
  it('lists the venues and the cap, the geo line, free lending, the admin key, the full-pool line', () => {
    const all = DISCLOSURES.map(([, p]) => p).join(' ')
    for (const s of [
      'Kamino Lend',
      'Jupiter Lend',
      '60%',
      'marginfi and Lulo',
      'blocks some regions',   // R367 (10-05): no named countries
      'including USDC and SOL lending',
      "Sprouts' offline admin key",
      POOL_FULL_LINE.slice(0, -1),   // inlined, with when you can withdraw
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
  it('price honesty (contracts 2.6, R324) and the admin key (R299) close the guarantee paragraph; no SKR price line yet (fix round 1, I1)', () => {
    expect(PRICE_LINE).toBe("Prices come from Pyth; cbBTC's price can be up to 10 minutes old.")
    expect(ADMIN_KEY_LINE).toBe("That key lives on the owner's laptop, not the server.")
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
      `${COST_LINE}\n\nEach coin and lending account needs a one-time rent in SOL, about $0.30 each. When you link or re-link this phone's wallet, or add USDC, the accounts for your switched-on coins are set up from your wallet's SOL, and the screen shows the cost before you approve. If your SOL is short, Sprouts pays. The rent stays yours: you get it back if you empty and close the account.\n\nRounding leftovers carry to your next planting, and every fee shows on its receipt. Pro (the Yield Manager, automatic lending and tax reports) is free during launch.`,
    )
    // Kimi copy item 1: withdrawals carry a small user-paid network fee, so never "free"
    expect(COST_LINE).toBe('Sprouts takes 0.5% of each planting, in USDC, including USDC and SOL lending. Sprouts takes nothing on interest, withdrawals or moves, and pays the network fee for every planting.')
    expect(fees).not.toMatch(/\bfree\b(?! during launch)/)
    expect(fees).toContain('including USDC and SOL lending')
    expect(fees).toContain('pays the network fee for every planting.')
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
