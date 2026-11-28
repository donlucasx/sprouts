import type { MeResponse, WalletPause } from './api'
import { REFUSED, SignRefused, SKR_MINT, topUpSourceAllowed, WSOL_MINT, type SignFlow } from './sign'
import { droppedNothingSent } from './wallet-errors'
import { t } from '@/i18n'
import { usdFromCents, usdTrimmed } from "@/i18n/format"

/**
 * The SOL top-up (10-22, owner-approved): round-ups are pulled only as USDC and most Seeker wallets hold SOL, so wherever USDC is short
 * (Home's no-USDC pause, Link a wallet's low-USDC note) this phone's wallet can swap some of its own SOL to USDC in one signature. The
 * API builds it (POST /api/topup/build), the phone checks it (sign.ts 'topup'), the Seed Vault signs, POST /api/topup/confirm sends.
 * Only this phone's wallet: another linked wallet's key is not on this phone. Build-written copy, every line below (his ruling owed).
 */
// 0.1.13 Spanish pass P6 (e): every line is read in the current language when it is shown (getters and functions over t()); the
// amounts go through the formatter (whole dollars, usdTrimmed), never hand-built "$5".
/** The button's whole dollars: "$5" (the same in Spanish, "$5"). */
const wholeUsd = (cents: number) => usdTrimmed(Math.round(cents / 100) * 100)
export const TOPUP = {
  // 10-26 copy review rows 8-9 (his: make clear the USDC goes to the user's own wallet, not to Sprouts)
  // 10-27 (his ruling: "We dont want to tell the user 'you need sol' so 'you can buy usdc'... Should be a simpler solution"): one
  // button (0.1.13: "Top up", Spanish "Agregar USDC"); what it swaps is said on each coin's row
  get open() { return t('topup.open') },
  button: (cents: number) => t('topup.button', { amount: wholeUsd(cents) }),
  // 0.1.13 (his ruling 11-27, the no-USDC card): [Top up], this line under it, then in the same card a row per coin, each with its
  // own short line, greyed with why when it cannot pay, and [Send USDC] last.
  get disclaimer() { return t('topup.disclaimer') },
  coinTitle: (coin: string) => t('topup.useCoin', { coin }),
  coinLine: (coin: string) => t('topup.useCoin.line', { coin }),
  get send() { return t('topup.send') },
  get sendLine() { return t('topup.send.line') },
  /** Why a coin is greyed (api TopUpUnavailable reason); the smallest offer names the amount ("Not enough SOL for $5"). */
  greyed: (coin: string, reason: TopUpUnavailableReason) =>
    reason === 'none_here' ? t('topup.noCoin', { coin }) : t('topup.notEnough', { coin, amount: wholeUsd(TOPUP_CHOICES[0]) }),
  get copy() { return t('topup.copy') },
  /** 11-20: under the open top-up, back to the closed card; sends nothing. */
  get back() { return t('link.approval.back') },
  get copied() { return t('topup.copied') },
  get waiting() { return t('wallet.waiting') },
  get checking() { return t('wallet.checking') },
  done: (cents: number) => t('topup.done', { amount: usdFromCents(cents) }),
  doneLink: (cents: number) => t('topup.doneLink', { amount: usdFromCents(cents) }),
  /** After the signature went out and no final answer came back: never "nothing moved". */
  get sent() { return t('topup.sent') },
  /** Before the wallet was asked (the build failed for a reason the API did not word). */
  get failedBefore() { return t('topup.failedBefore') },
  otherWallet: (short: string) => t('topup.otherWallet', { wallet: short }),
}

/** A top-up amount chip: whole dollars through the formatter ("$5", "$10"; cents only if an amount ever has them). */
export const chipLabel = (cents: number): string => usdTrimmed(cents)

/**
 * Task 7 review: the API computes topUpSources only when asked (it costs a Helius token-accounts read and Jupiter calls), so only Home's
 * read (whose Add USDC shows the coin picker) asks; Link a wallet and the background refresh read the plain path and get no list.
 */
export const ME_USDC_WITH_SOURCES = '/api/me/usdc?sources=1'
/**
 * Task 17b (user rent), ruling 26: the setup count costs a Helius read, so it is asked only where its line shows: Link a wallet, and when
 * the top-up opens or the re-link card shows. Never on Home's regular read above.
 */
export const ME_USDC_SETUP = '/api/me/usdc?setup=1'
/**
 * Ruling 27: the setup read's own query key, OUTSIDE the 'me-usdc' prefix, so Home's focus and app-active invalidation of ['me-usdc']
 * never re-reads it. Link a wallet, the top-up and the re-link card share it; a top-up invalidates it (its accounts now exist).
 */
export const meUsdcSetupKey = (user: string | undefined) => ['me-usdc-setup', user] as const
/** The most setup creates a top-up carries (api lib/user-setup.ts TOPUP_SETUP_MAX: a fourth would not fit beside Jupiter's route). */
export const TOPUP_SETUP_MAX = 3

/** GET /api/me/usdc topUpSources (0.1.12 API): a coin this phone's wallet can top up from; SOL first, absent from an older API. */
/** `splitPct` / `costBps` (0.1.13 API, api lib/topup-cost.ts): the coin's share of the user's split and what a top-up from it wastes;
 *  absent from an older API or when the split could not be read. */
export type TopUpSource = { mint: string; symbol: string; decimals: number; valueCents: number; offers: number[]; splitPct?: number; costBps?: number }
/** A coin at or above this share of the split gets the SOL line (his ruling 11-25, gate per Kimi step 3 #9-11). */
export const SOL_CHEAPER_MIN_SPLIT_PCT = 25
/**
 * 0.1.13 (his ruling "Point to SOL instead", his note "make sure this is appropriate/accurate/necessary"): the line that replaces the
 * fee sentence when the picked coin mostly goes back into itself at planting, said only when it is true AND actionable: the picked coin
 * is not SOL, is SOL_CHEAPER_MIN_SPLIT_PCT or more of the split, SOL is in the picker, covers this amount, and costs less. The share is
 * the server's, never a fixed number. Null otherwise (the fee sentence shows). Only Home's read asks for sources with costs
 * (ME_USDC_WITH_SOURCES); Link a wallet's ?setup=1 read has none, so the line can only show on Home (Kimi step 3 #14).
 */
export function solCheaperLine(picked: TopUpSource | null, usable: readonly TopUpSource[] | null, cents: number): string | null {
  if (!picked || !usable || picked.mint === WSOL_MINT) return null
  const sol = usable.find((s) => s.mint === WSOL_MINT)
  if (!sol || !sol.offers.includes(cents)) return null
  if (typeof picked.splitPct !== 'number' || typeof picked.costBps !== 'number' || typeof sol.costBps !== 'number') return null
  if (picked.splitPct < SOL_CHEAPER_MIN_SPLIT_PCT || sol.costBps >= picked.costBps) return null
  return t('topup.solCheaper', { pct: Math.round(picked.splitPct), symbol: picked.symbol })
}

/** GET /api/me/usdc?sources=1 topUpUnavailable (0.1.13 API, for a 0.1.13 phone): a card coin that cannot pay, and why. */
export type TopUpUnavailableReason = 'none_here' | 'not_enough'
export type TopUpUnavailable = { mint: string; symbol: string; reason: TopUpUnavailableReason }
/** The only coins the no-USDC card names (his "Not now" for WIF and the rest; the server may list more, the card never shows them). */
export const CARD_COIN_MINTS: readonly string[] = [WSOL_MINT, SKR_MINT]
const REASONS: readonly string[] = ['none_here', 'not_enough']

/**
 * The card's coins that can pay (SOL and SKR only, a coin the phone would sign, with amounts), cheapest first by the server's costBps
 * when every one carries it (ties: more value first); else SOL first, then by value. An older API with no list (Link a wallet's read,
 * a 0.1.11 API): SOL alone with `offers` (null = every amount, as 0.1.11), none when `offers` is [].
 */
export function cardCoins(sources: readonly TopUpSource[] | null | undefined, offers: readonly number[] | null | undefined): TopUpSource[] {
  if (!sources?.length) {
    const amounts = offers ?? TOPUP_CHOICES
    return amounts.length ? [{ mint: WSOL_MINT, symbol: 'SOL', decimals: 9, valueCents: 0, offers: [...amounts] }] : []
  }
  const coins = sources.filter((s) => CARD_COIN_MINTS.includes(s.mint) && topUpSourceAllowed(s.mint) && s.offers.length > 0)
  const ranked = coins.every((s) => typeof s.costBps === 'number')
  const solFirst = (s: TopUpSource) => (s.mint === WSOL_MINT ? 0 : 1)
  return [...coins].sort((a, b) => (ranked ? (a.costBps as number) - (b.costBps as number) : solFirst(a) - solFirst(b)) || b.valueCents - a.valueCents)
}

/** The greyed rows: the server's card coins that cannot pay, in its order, never one that pays, an unknown coin or an unknown reason. */
export function greyedCoins(unavailable: readonly TopUpUnavailable[] | null | undefined, payable: readonly TopUpSource[]): TopUpUnavailable[] {
  const seen = new Set(payable.map((s) => s.mint))
  return (unavailable ?? []).filter((u) => {
    if (!CARD_COIN_MINTS.includes(u.mint) || !REASONS.includes(u.reason) || seen.has(u.mint)) return false
    seen.add(u.mint)
    return true
  })
}

/** What the card's open part shows: null = nothing picked yet, a coin (its amounts and [Add $X of USDC]) or Send USDC (the address). */
export const SEND_PICK = 'send'
export type TopUpCardView =
  | { step: 'closed'; waiting: boolean }
  | { step: 'open'; coins: TopUpSource[]; greyed: TopUpUnavailable[]; picked: null | { kind: 'coin'; source: TopUpSource } | { kind: 'send' } }

/**
 * The no-USDC card (his ruling 11-27, Kimi scope 11-27 #2): closed = [Top up] and its line; while Home's ?sources=1 read has not landed
 * (`waiting`) the button holds, so it never opens on a guessed list. Open = the paying coins (cardCoins), then the greyed ones
 * (greyedCoins), then Send USDC; `pick` (a mint or SEND_PICK) opens that row. A picked coin that can no longer pay (the list re-read
 * without it) falls back to nothing picked, never to another coin's amounts.
 */
export function topUpCard(a: { open: boolean; waiting: boolean; pick: string | null; sources: readonly TopUpSource[] | null | undefined; unavailable: readonly TopUpUnavailable[] | null | undefined; offers: readonly number[] | null | undefined }): TopUpCardView {
  if (!a.open || a.waiting) return { step: 'closed', waiting: a.waiting }
  const coins = cardCoins(a.sources, a.offers)
  const greyed = greyedCoins(a.unavailable, coins)
  const coin = coins.find((s) => s.mint === a.pick)
  const picked = a.pick === SEND_PICK ? { kind: 'send' as const } : coin ? { kind: 'coin' as const, source: coin } : null
  return { step: 'open', coins, greyed, picked }
}

export const TOPUP_DEFAULT_CENTS = 500
export const TOPUP_MAX_CENTS = 2_500
/** 10-26 (his: "can the top up be dialed?"): the amounts offered; the one that covers the pause is picked first. */
export const TOPUP_CHOICES = [500, 1_000, 2_500] as const
/** The smallest choice that covers `cents`, else the largest. */
export const choiceFor = (cents: number, offers: readonly number[] = TOPUP_CHOICES) => offers.find((c) => c >= cents) ?? offers[offers.length - 1] ?? TOPUP_CHOICES[0]

/**
 * How much the button offers (build-invented, 10-22): $5, or the whole dollars the pause line names when that is more (so one tap both
 * restarts the wallet and covers the waiting round-ups), at most $25 (the API's ceiling).
 */
export function topUpCentsFor(pause: WalletPause | null | undefined): number {
  if (pause?.reason !== 'no_usdc') return TOPUP_DEFAULT_CENTS
  const dollars = Math.max(1, Math.ceil(Math.max(pause.needCents ?? 0, pause.resumeAtCents ?? 0) / 100))   // ?? 0: an older cached read (Kimi 10-27)
  return Math.min(TOPUP_MAX_CENTS, Math.max(TOPUP_DEFAULT_CENTS, dollars * 100))
}

/** What Home offers: the button when this phone's wallet is paused for no USDC; a line for each other wallet paused for it. */
export function topUpOffer(me: Pick<MeResponse, 'wallets' | 'user'>): { phoneCents: number | null; others: string[] } {
  const paused = me.wallets.filter((w) => w.status === 'paused' && w.pause?.reason === 'no_usdc')
  const phone = paused.find((w) => w.pubkey === me.user.pubkey)
  return {
    phoneCents: phone ? topUpCentsFor(phone.pause) : null,
    others: paused.filter((w) => w.pubkey !== me.user.pubkey).map((w) => TOPUP.otherWallet(`${w.pubkey.slice(0, 4)}...${w.pubkey.slice(-4)}`)),
  }
}

/**
 * Home's card right after Link a wallet (Task 4, 11-19): this phone's wallet under $5 of USDC gets the "Add USDC" button (Home's own
 * /api/me/usdc read, not the link route's numbers); another wallet gets the line saying where to add it. null = nothing to add.
 */
export function postLinkUsdc(a: { linked: string | undefined; phone: string; usdcCents: number | null }): { line: string | null; topUp: boolean } | null {
  if (!a.linked) return null
  if (a.linked !== a.phone) return { line: TOPUP.otherWallet(`${a.linked.slice(0, 4)}...${a.linked.slice(-4)}`), topUp: false }
  return a.usdcCents !== null && a.usdcCents < TOPUP_DEFAULT_CENTS ? { line: null, topUp: true } : null
}

/** A top-up that did not finish; `message` is the sentence to show as it is. */
export class TopUpFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TopUpFailed'
  }
}

// Duck-typed on ApiError's shape (status, message) so this module stays free of api.ts and its native session store.
const apiStatus = (e: unknown): number | null => {
  const s = e instanceof Error ? (e as { status?: unknown }).status : undefined
  return typeof s === 'number' ? s : null
}

/**
 * Build, check, sign, send. Each step's failure says what it means: before the wallet answered nothing was sent (the phone only signs;
 * the API sends), so a decline, a dropped wallet session or our own refusal is "nothing moved"; after the signature went out only the
 * confirm route's own final answers (400 failed on chain or not a top-up, 409 expired) are shown as they are, and anything else is
 * TOPUP.sent. Answers 'confirmed', or 'pending' when the route said it may still land (202).
 */
export async function topUpThisPhone(a: {
  user: string
  cents: number
  /** The coin to swap; absent or the wSOL mint = SOL (the build body is then exactly { cents }, as 0.1.11 sends it). */
  inputMint?: string
  /** Task 17b: the setup count the screen showed (/api/me/usdc?setup=1); capped at TOPUP_SETUP_MAX; absent or 0 = today's body and flow. */
  setupMax?: number
  build: (body: { cents: number; inputMint?: string; setupMax?: number }) => Promise<{ transaction: string; usdcRaw: string; inputMint?: string }>
  sign: (flow: SignFlow) => (transaction: string) => Promise<string>
  confirm: (body: { signedTransaction: string }) => Promise<{ status?: string }>
  onSigned?: () => void
}): Promise<'confirmed' | 'pending'> {
  const usdcRaw = String(BigInt(a.cents) * 10_000n)
  const token = a.inputMint !== undefined && a.inputMint !== WSOL_MINT ? a.inputMint : undefined
  const setupMax = a.setupMax !== undefined && Number.isInteger(a.setupMax) && a.setupMax > 0 ? Math.min(a.setupMax, TOPUP_SETUP_MAX) : 0
  const setup = setupMax > 0 ? { setupMax } : {}
  let built: { transaction: string; usdcRaw: string; inputMint?: string }
  try {
    built = await a.build(token === undefined ? { cents: a.cents, ...setup } : { cents: a.cents, inputMint: token, ...setup })
  } catch (e) {
    throw new TopUpFailed(apiStatus(e) !== null && apiStatus(e) !== 0 ? (e as Error).message : TOPUP.failedBefore)
  }
  // The button's amount, never the build's: a build for another amount is refused before the wallet is asked.
  if (built.usdcRaw !== usdcRaw) throw new TopUpFailed(REFUSED.plan)
  // The coin asked, never the build's: SOL accepts no echo (an older API) or wSOL; a token must be echoed exactly.
  const echoed = built.inputMint === undefined || built.inputMint === WSOL_MINT ? undefined : built.inputMint
  if (echoed !== token) throw new TopUpFailed(REFUSED.plan)
  let signedTransaction: string
  try {
    signedTransaction = await a.sign(token === undefined ? { kind: 'topup', user: a.user, usdcRaw, ...setup } : { kind: 'topup', user: a.user, usdcRaw, inputMint: token, ...setup })(built.transaction)
  } catch (e) {
    throw new TopUpFailed(e instanceof SignRefused ? e.message : droppedNothingSent())
  }
  a.onSigned?.()
  let answer: { status?: string }
  try {
    answer = await a.confirm({ signedTransaction })
  } catch (e) {
    const s = apiStatus(e)
    throw new TopUpFailed(s === 400 || s === 409 ? (e as Error).message : TOPUP.sent)
  }
  return answer?.status === 'confirmed' ? 'confirmed' : 'pending'
}
