import { ORE_DISCLOSURE } from './ore-copy'
/** Copy pass 11-20 (founder-reviewed draft, Kimi copy audit): the precise guarantee in plain words, the hacked line moved here from the
 *  Link a wallet card. Deltas from spec 6.2: "leg" is "coin", "leaves" is "arrives", the re-link precondition is its own paragraph,
 *  remainders moved to What does it cost?. "or replace the program" stays (Kimi item 2, matches the Terms). */
export const PRECISE_GUARANTEE =
  "Even if our server were hacked, neither it nor the AI could send your money anywhere else or move more than your daily limit. It can only pull through the Sprouts on-chain program, which allows at most your $5 daily limit, only into the coins, lending and SKR staking Sprouts offers, and only if at least 98.5% of the value arrives (99.4% for USDC lending) at a live oracle price. Otherwise nothing happens. The server picks when, which coin and how much, up to your limit. Only Sprouts' offline admin key can change these rules or replace the program, and your $5 limit still holds."

/** R299: where the admin key lives. Goes stale when the key moves to Squads. */
export const ADMIN_KEY_LINE = "That key lives on the owner's laptop, not the server."

/** Contracts 2.6 and R324: where the program's prices come from and cbBTC's looser age. */
export const PRICE_LINE = "Prices come from Pyth; cbBTC's price can be up to 10 minutes old."

/** R452 (10-08): About Sprouts = how it works, then six questions. Copy pass 11-20: the draft's wording. */
export const HOW_IT_WORKS =
  'Every swap you make rounds up to the next dollar. Once a day, Sprouts plants that change into your split, using USDC from the wallet that made the swap. What it buys stays in your own wallet. It never moves more than your daily limit, and you can pause or revoke it any time.'

/** The cost answer's first paragraph; /faqs says it word for word (settings-copy.test.ts checks). */
export const COST_LINE =
  'Sprouts takes 0.5% of each planting, in USDC, including USDC and SOL lending. Sprouts takes nothing on interest, withdrawals or moves, and pays the network fee for every planting.'

export const DISCLOSURES: [string, string][] = [
  [
    'Who holds my money?',
    `Your coins and lending receipts sit in your own wallet. Your SKR is staked under your Seeker's key, and only that key can unstake it.\n\n${PRECISE_GUARANTEE} ${ADMIN_KEY_LINE} ${PRICE_LINE}\n\nWallets linked on the web trust the link page when they link; your Seeker's own wallet doesn't. An approval made before you re-linked keeps the old rules until you re-link or revoke it.\n\nYou stay signed in for seven days on this phone, and signing out ends it right away. Raising your daily limit or resuming a wallet asks your wallet to sign again. Watering moves no money and signs nothing.`,
  ],
  [
    'What does it cost?',
    `${COST_LINE}\n\nEach coin and lending account needs a one-time rent in SOL, about $0.30 each. When you link or re-link this phone's wallet, or add USDC, the accounts for your switched-on coins are set up from your wallet's SOL, and the screen shows the cost before you approve. If your SOL is short, Sprouts pays. The rent stays yours: you get it back if you empty and close the account.\n\nRounding leftovers carry to your next planting, and every fee shows on its receipt. Pro (the Yield Manager, automatic lending and tax reports) is free during launch.`,
  ],
  [
    'Where does lending go?',
    'New USDC and SOL go to Kamino Lend or Jupiter Lend, whichever paid more over the last 7 days and is safe that day. Once you have $20 or more lent, new money only goes to a venue if that keeps it at or under 60% of your lending. The Yield Manager can skip a venue for a day and says why in Rules, under "Where lending goes today". A venue can pause withdrawals when its pool is fully lent out; your money stays yours, and you can withdraw once borrowers repay or new money comes in. Kamino blocks some regions on its own website. Sprouts deposits on-chain for you and you withdraw inside Sprouts, so check that lending is allowed where you live.',
  ],
  [
    'What does "earned" mean?',
    "The staking program pays SKR rewards every two days, into the share price. Sprouts shows what the program reports and nothing else: a fruit is SKR earned since you joined, with today's dollar value beside it. Lending earns from borrowers: your receipt is worth a little more USDC or SOL each day, at the venue's rate. Your garden's dollar value moves with prices and can fall below what you put in.",
  ],
  [
    'What can Sprouts buy?',
    `${ORE_DISCLOSURE} hSOL is SOL staked with Helius, so its value moves with SOL. cbBTC is bitcoin held by Coinbase, so its value moves with bitcoin. Both sit unlocked in your wallet, and Sprouts can't sell them for you. USDC and SOL lending sit at Kamino or Jupiter Lend with the receipt in your wallet; you withdraw them in Sprouts with one tap. Each coin needs a one-time account rent (see What does it cost?).\n\nIf you turn on the Yield Manager, it splits new round-ups across SKR, stORE, USDC lending, SOL lending, hSOL and cbBTC, inside limits you set and limits in code. It never sets the amount, never sells anything you hold, and every change shows in Activity with an undo.`,
  ],
  [
    'Can I pause or stop it?',
    "Turn Sprouts off at the top of Rules and nothing moves until you turn it back on. Revoke a wallet in Settings to end Sprouts' approval on chain. You can withdraw any coin or lending position at any time.",
  ],
]

/** The line under the questions (R452: "Not advice" became the footer). */
export const NOT_ADVICE = 'Sprouts is not tax or investment advice. Tax reports are a record for your tax tool, not a filing.'

export const VENUES_EMPTY = 'The venues show here once Claude Haiku 5.5 has read their rates.'
