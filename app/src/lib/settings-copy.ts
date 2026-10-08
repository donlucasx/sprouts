import { ORE_DISCLOSURE } from './ore-copy'
import { POOL_FULL_LINE } from './lend-withdraw'
import { WEB_LINK_TRUST } from './relink'

/** Spec 6.2, the precise guarantee, verbatim (Settings and README). */
export const PRECISE_GUARANTEE =
  "Once you re-link, Sprouts' server can only pull through the Sprouts program: at most your $5 daily limit, and only in a transaction that leaves at least 98.5% of that value (99.9% for USDC lending), at a live oracle price, in the coins Sprouts has enabled, lending positions or SKR stake; otherwise it reverts. The server still chooses when, which leg and how much up to the limit; rounding remainders carry to your next planting. Only Sprouts' offline admin key can change these rules or replace the program; your $5-a-day limit still holds."

/** Contracts 2.6 and R324: where the program's prices come from and cbBTC's looser age. Build-written copy, awaiting his ruling. The SKR price line waits on contracts 10 item 15 (fix round 1, I1). */
export const PRICE_LINE = "Prices come from Pyth. cbBTC's price can be up to 10 minutes old."

/** R299, build-written (awaiting his ruling): where the admin key lives. Goes stale when the key moves to Squads. */
export const ADMIN_KEY_LINE = "The admin key lives on the owner's laptop, not the server."

/** R452 (10-08): About Sprouts = three lines on how it works, then six questions. Every fact of the 13 earlier disclosures is kept
 *  (spec 3.5 and 9; R60; RECONCILED rules 10 to 12; R81; R84; spec 6.2 and 11); only the grouping and the order changed. */
export const HOW_IT_WORKS =
  'Each swap you make rounds up to the next dollar. Once a day Sprouts plants that change into the coins you chose, inside your own wallet. It can never move more than your daily limit, and you can turn it off or revoke it any time.'

export const DISCLOSURES: [string, string][] = [
  [
    'Who holds my money?',
    `${PRECISE_GUARANTEE} ${WEB_LINK_TRUST} Your SKR is staked under your Seeker's key; only that key can unstake it. Your coins and lending receipts sit in your wallet. An approval you made before re-linking stays on chain under the old rules until you re-link or revoke it.\n\n${PRICE_LINE} ${ADMIN_KEY_LINE}\n\nSigning in keeps you signed in for seven days on this phone; sign out ends it at once. Raising your daily limit or resuming a wallet asks your wallet for a fresh fingerprint. Watering moves no money and signs nothing.`,
  ],
  [
    'What does it cost?',
    'Sprouts takes 0.5% of each SKR, stORE, hSOL and cbBTC planting, in USDC, inside the swap. No Sprouts fee on USDC or SOL lending, and nothing on interest, withdrawals or moves. Sprouts pays the network fee and the one-time account rent for your coin and lending accounts. Leftovers from rounding carry to your next planting. Fees are on every receipt. Pro (the Yield Manager, automatic lending and the tax pack) is included free during launch.',
  ],
  [
    'Where does lending go?',
    `New USDC and SOL go to Kamino Lend or Jupiter Lend, whichever has paid more over the last 7 days and is safe that day. Once you lend $20 or more, new money goes to a venue only if that keeps it at or under 60% of your lending. marginfi and Lulo are compared every day but get no money. The Yield Manager can skip a venue for a day and says why; see "Where lending goes today" in Rules. ${POOL_FULL_LINE} Withdraw says so, and you can withdraw once borrowers repay or new money comes in. Kamino restricts some regions on its own website. Sprouts deposits on-chain for you and you withdraw in Sprouts; check that using lending is allowed where you live.`,
  ],
  [
    'What does "earned" mean?',
    "Rewards are paid by the staking program every two days into the share price. Sprouts draws what the program shows and nothing else; a fruit is earned SKR since you joined, in SKR, with today's dollar value beside it. Lending earns from borrowers: your receipt is worth a little more USDC or SOL each day at the venue's rate. The dollar value of your garden moves with prices and can be lower than what you put in.",
  ],
  [
    'What can Sprouts buy?',
    `${ORE_DISCLOSURE} hSOL is SOL staked with Helius; its value moves with SOL. cbBTC is bitcoin held by Coinbase; its value moves with bitcoin. Both sit in your wallet, not locked; Sprouts cannot sell them for you, and pays each coin's one-time account rent. USDC and SOL lending sit at Kamino or Jupiter Lend with the receipt in your wallet; you withdraw them in Sprouts with one tap. The list is fixed in code; nothing else can be bought. The Yield Manager, if you turn it on, splits new round-ups across SKR, stORE, USDC lending, SOL lending, hSOL and cbBTC inside limits you set and limits in code. It never sets the amount, never sells anything you hold, and every change it makes shows in Activity with an undo.`,
  ],
  [
    'How do I stop it?',
    'Turn Sprouts off at the top of Rules: nothing moves until you turn it back on. Revoke a wallet in Settings to end Sprouts\' approval on chain. Withdraw any coin or lending position from your garden at any time.',
  ],
]

/** The line under the questions (R452: "Not advice" became the footer). */
export const NOT_ADVICE = 'Sprouts is not tax or investment advice. Tax exports are a record for your tax tool, not a filing.'

export const VENUES_EMPTY = 'The venues show here once the Yield Manager has read their rates.'
