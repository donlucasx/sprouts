import { ORE_DISCLOSURE } from './ore-copy'
import { POOL_FULL_LINE } from './lend-withdraw'
import { WEB_LINK_TRUST } from './relink'

/** Spec 6.2, the precise guarantee, verbatim (Settings and README). */
export const PRECISE_GUARANTEE =
  "Once you re-link, Sprouts' server can only pull through the Sprouts program: at most your $5 daily limit, and only in a transaction that leaves at least 98.5% of that value (99.9% for USDC lending), at a live oracle price, in your own allowed coins, lending positions or SKR stake; otherwise it reverts. The server still chooses when, which leg and how much up to the limit; rounding remainders carry to your next planting. Only Sprouts' offline admin key can change these rules."

/** Contracts 2.6 and R324: where the program's prices come from, cbBTC's looser age, SKR's missing price source. Build-written copy, awaiting his ruling. */
export const PRICE_LINE =
  "Prices come from Pyth's free price accounts; cbBTC is priced at most 10 minutes ago. SKR has no price source yet, so the program does not check its price."

/** Settings > About Sprouts, the disclosures (spec 3.5 and 9; R60; RECONCILED rules 10 to 12; R81; R84; the lending build, spec 6.2 and 11). */
export const DISCLOSURES: [string, string][] = [
  [
    'How Sprouts holds your money',
    `${PRECISE_GUARANTEE} ${WEB_LINK_TRUST} ${PRICE_LINE} The admin key is kept on the owner's laptop, never on the server. Your SKR is staked under your Seeker's key; only that key can unstake it. Your coins and lending receipts sit in your Seeker wallet. An approval you made before re-linking stays on chain under the old rules until you re-link or revoke it.`,
  ],
  [
    'What "earned" means',
    "Rewards are paid by the staking program every two days into the share price. Sprouts draws what the program shows and nothing else; a fruit is earned SKR since you joined, in SKR, with today's dollar value beside it. Lending earns from borrowers: your receipt is worth a little more USDC or SOL each day at the venue's rate. The dollar value of your garden moves with prices and can be lower than what you put in.",
  ],
  ['Watering', 'Watering moves no money and signs nothing. It opens new growth on the screen.'],
  [
    'Fees',
    'Sprouts takes 0.5% of each SKR, stORE, hSOL and cbBTC planting, in USDC, inside the swap, and passes through the network fee (about $0.03). Lending is free: no Sprouts fee on USDC or SOL lending, and nothing on interest, withdrawals or moves. Leftovers from rounding carry to your next planting. Fees are on every receipt.',
  ],
  [
    'Where your lending goes',
    'New USDC and SOL go to Kamino Lend or Jupiter Lend, whichever has paid more over the last 7 days and is safe that day. Once you lend $20 or more, neither holds more than 60% of it. marginfi and Lulo are compared every day but get no money. The Yield Manager can skip a venue for a day and says why.',
  ],
  [
    'If a pool is full',
    `${POOL_FULL_LINE} Withdraw says so, and you can withdraw once borrowers repay or new money comes in.`,
  ],
  [
    'Kamino and where you live',
    "Kamino blocks users in the US and UK on its own website. Sprouts deposits on-chain for you, so you can hold a Kamino position even where Kamino's site is blocked, and you withdraw it in Sprouts. Follow the rules where you live.",
  ],
  [
    'Signed in',
    'Signing in keeps you signed in for seven days on this phone; sign out ends it at once. Raising your daily limit or resuming a wallet asks your Seeker for a fresh fingerprint.',
  ],
  ['ORE, if you choose it', ORE_DISCLOSURE],
  [
    'What the Yield Manager can buy',
    "hSOL is SOL staked with Helius; its value moves with SOL. cbBTC is bitcoin held by Coinbase; its value moves with bitcoin. Both sit in your Seeker wallet, not locked; Sprouts cannot sell them for you, and pays each coin's one-time account rent. USDC and SOL lending sit at Kamino or Jupiter Lend with the receipt in your Seeker wallet; you withdraw them in Sprouts with one tap. The list is fixed in code; nothing else can be bought.",
  ],
  [
    'Not advice',
    'Sprouts is not tax advice and not investment advice. The Yield Manager, if you turn it on, splits new round-ups across SKR, stORE, USDC lending, SOL lending, hSOL and cbBTC inside limits you set and limits in code. It never sets the amount, never sells anything you hold, and every change it makes shows in Activity with an undo. The tax export is a record, not a filing.',
  ],
]

export const VENUES_EMPTY = 'The venues show here once the Yield Manager has read their rates.'
