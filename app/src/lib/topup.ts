import type { MeResponse, WalletPause } from './api'
import { REFUSED, SignRefused, topUpSourceAllowed, WSOL_MINT, type SignFlow } from './sign'
import { DROPPED_NOTHING_SENT } from './wallet-errors'
import { t } from '@/i18n'
import { usdFromCents } from "@/i18n/format"

/**
 * The SOL top-up (10-22, owner-approved): round-ups are pulled only as USDC and most Seeker wallets hold SOL, so wherever USDC is short
 * (Home's no-USDC pause, Link a wallet's low-USDC note) this phone's wallet can swap some of its own SOL to USDC in one signature. The
 * API builds it (POST /api/topup/build), the phone checks it (sign.ts 'topup'), the Seed Vault signs, POST /api/topup/confirm sends.
 * Only this phone's wallet: another linked wallet's key is not on this phone. Build-written copy, every line below (his ruling owed).
 */
export const TOPUP = {
  // 10-26 copy review rows 8-9 (his: make clear the USDC goes to the user's own wallet, not to Sprouts)
  // 10-27 (his ruling: "We dont want to tell the user 'you need sol' so 'you can buy usdc'... Should be a simpler solution"): one
  // "Add USDC" button; the SOL swap stays behind it, named once in a quiet line; a wallet whose SOL covers nothing gets its address
  open: 'Add USDC',
  button: (cents: number) => `Add $${Math.round(cents / 100)} of USDC`,
  // 10-27 (his note on the Saga: "should state somewhere that you are swapping existing sol from your wallet into USDC")
  // Task 3 (any-coin top-up): the coin picked names itself; SOL by default, so the SOL line is unchanged
  // 0.1.13 (his ruling "Name both", 11-25): the swap is free and the planting carries the 0.5% (t topup.fee). `tail` replaces that
  // sentence (the SOL pointer, solCheaperLine).
  how: (cents: number, covers: string | null, symbol = 'SOL', tail: string = t('topup.fee')) =>
    `Swaps ${symbol} already in this wallet for $${Math.round(cents / 100)} of USDC${covers ? `, ${covers.charAt(0).toLowerCase()}${covers.slice(1)}` : ''}. ${tail}`,
  /** The line under the closed "Add USDC" button (owner's copy, 11-19), the picked coin's symbol in it. */
  swapsLine: (symbols: string[]) => {
    const list = symbols.length === 0 ? 'SOL' : symbols.length === 1 ? symbols[0] : `${symbols.slice(0, -1).join(', ')} or ${symbols[symbols.length - 1]}`
    return `Swaps a little of your ${list} into USDC. ${t('topup.fee')}`
  },
  // 11-20 (Kimi copy item 3): never a "not enough SOL" line; just where to send USDC
  sendHere: 'Send USDC to this wallet from any wallet or exchange. Plantings start again once it arrives.',
  copy: 'Copy address',
  /** 11-20: under the open top-up, back to the closed card; sends nothing. */
  back: 'Back',
  copied: 'Copied',
  get waiting() { return t('wallet.waiting') },
  get checking() { return t('wallet.checking') },
  done: (cents: number) => `Your wallet now has ${usdFromCents(cents)} more USDC. Sprouts plants again at the next daily planting.`,
  doneLink: (cents: number) => `Your wallet now has ${usdFromCents(cents)} more USDC.`,
  /** After the signature went out and no final answer came back: never "nothing moved". */
  sent: 'Your top-up was sent but is not confirmed yet. Check Home in a minute before you try again.',
  /** Before the wallet was asked (the build failed for a reason the API did not word). */
  failedBefore: 'Could not start the top-up. Nothing moved. Try again.',
  otherWallet: (short: string) => `Top up works only for this phone's wallet. Add USDC to ${short} from wherever you use it.`,
} as const

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
/** The coin picked first: SOL when offered, else the first; null when there is no list (an older API: the SOL top-up as in 0.1.11). */
export const defaultSource = (sources: readonly TopUpSource[] | null | undefined): TopUpSource | null =>
  sources?.find((s) => s.mint === WSOL_MINT) ?? sources?.[0] ?? null

/**
 * Controller ruling (11-19): the picker shows at most 3 coins: SOL first (when offered), then two more. 0.1.13 (his ruling "Line +
 * ranking now"): the cheapest two by costBps when every coin carries one (ties: more value first); else, as before, the two worth the
 * most in this wallet.
 */
export function pickerSources(sources: readonly TopUpSource[]): TopUpSource[] {
  const sol = sources.filter((s) => s.mint === WSOL_MINT).slice(0, 1)
  const rest = sources.filter((s) => s.mint !== WSOL_MINT)
  const ranked = rest.every((s) => typeof s.costBps === 'number')
  const others = [...rest].sort((a, b) => (ranked ? (a.costBps as number) - (b.costBps as number) : 0) || b.valueCents - a.valueCents).slice(0, 2)
  return [...sol, ...others]
}

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

/**
 * What TopUpButton shows. No list, or an empty one (an older API, or a read that listed nothing): no picker, SOL, `offers` (0.1.11's
 * topUpCents; null = every amount). A list: its coins with amounts (only coins the phone would sign: a buggy or hostile answer never shows the rest), at most 3 (pickerSources); the picked one (else defaultSource) and
 * its amounts; none with amounts = [] (the address to send USDC to).
 */
export function topUpChoices(sources: readonly TopUpSource[] | null | undefined, offers: readonly number[] | null | undefined, pickedMint: string | null) {
  const usable = sources?.length ? pickerSources(sources.filter((s) => topUpSourceAllowed(s.mint) && s.offers.length > 0)) : null
  const source = usable ? (usable.find((s) => s.mint === pickedMint) ?? defaultSource(usable)) : null
  const choices: readonly number[] = usable ? (source?.offers ?? []) : (offers ?? TOPUP_CHOICES)
  return { usable, source, symbol: source?.symbol ?? 'SOL', choices }
}

/**
 * The closed card (11-20 copy pass): 'add' = the "Add USDC" button, its line naming only the coins that can pay (the usable sources with
 * amounts; an older API with no list = SOL, as 0.1.11); 'send' = no coin can pay, so the address to send USDC to shows straight away,
 * no button. Never names a coin that cannot pay (the empty-list SOL fallback was the bug).
 */
export function topUpClosedView(sources: readonly TopUpSource[] | null | undefined, offers: readonly number[] | null | undefined): { kind: 'send' } | { kind: 'add'; symbols: string[] } {
  const { usable, choices } = topUpChoices(sources, offers, null)
  if (choices.length === 0) return { kind: 'send' }
  return { kind: 'add', symbols: usable ? usable.map((s) => s.symbol) : ['SOL'] }
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
    throw new TopUpFailed(e instanceof SignRefused ? e.message : DROPPED_NOTHING_SENT)
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
