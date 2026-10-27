import type { MeResponse, WalletPause } from './api'
import { REFUSED, SignRefused, type SignFlow } from './sign'
import { DROPPED_NOTHING_SENT } from './wallet-errors'

/**
 * The SOL top-up (10-22, owner-approved): round-ups are pulled only as USDC and most Seeker wallets hold SOL, so wherever USDC is short
 * (Home's no-USDC pause, Link a wallet's low-USDC note) this phone's wallet can swap some of its own SOL to USDC in one signature. The
 * API builds it (POST /api/topup/build), the phone checks it (sign.ts 'topup'), the Seed Vault signs, POST /api/topup/confirm sends.
 * Only this phone's wallet: another linked wallet's key is not on this phone. Build-written copy, every line below (his ruling owed).
 */
export const TOPUP = {
  // 10-26 copy review rows 8-9 (his: make clear the USDC goes to the user's own wallet, not to Sprouts)
  button: (cents: number) => `Swap $${Math.round(cents / 100)} of SOL to USDC in your wallet`,
  how: 'Through Jupiter. No Sprouts fee.',
  waiting: 'Waiting for your wallet.',
  checking: 'Approved. Checking the chain.',
  done: (cents: number) => `Your wallet now has $${(cents / 100).toFixed(2)} more USDC. Sprouts plants again at the next daily planting.`,
  doneLink: (cents: number) => `Your wallet now has $${(cents / 100).toFixed(2)} more USDC.`,
  /** After the signature went out and no final answer came back: never "nothing moved". */
  sent: 'Your top-up was sent but is not confirmed yet. Check Home in a minute before you try again.',
  /** Before the wallet was asked (the build failed for a reason the API did not word). */
  failedBefore: 'Could not start the top-up. Nothing moved. Try again.',
  otherWallet: (short: string) => `Top up works only for this phone's wallet. Add USDC to ${short} from wherever you use it.`,
} as const

export const TOPUP_DEFAULT_CENTS = 500
export const TOPUP_MAX_CENTS = 2_500
/** 10-26 (his: "can the top up be dialed?"): the amounts offered; the one that covers the pause is picked first. */
export const TOPUP_CHOICES = [500, 1_000, 2_500] as const
/** The smallest choice that covers `cents`, else the largest. */
export const choiceFor = (cents: number) => TOPUP_CHOICES.find((c) => c >= cents) ?? TOPUP_CHOICES[TOPUP_CHOICES.length - 1]

/**
 * How much the button offers (build-invented, 10-22): $5, or the whole dollars the pause line names when that is more (so one tap both
 * restarts the wallet and covers the waiting round-ups), at most $25 (the API's ceiling).
 */
export function topUpCentsFor(pause: WalletPause | null | undefined): number {
  if (pause?.reason !== 'no_usdc') return TOPUP_DEFAULT_CENTS
  const dollars = Math.max(1, Math.ceil(Math.max(pause.needCents ?? 0, pause.resumeAtCents) / 100))
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
  build: (cents: number) => Promise<{ transaction: string; usdcRaw: string }>
  sign: (flow: SignFlow) => (transaction: string) => Promise<string>
  confirm: (body: { signedTransaction: string }) => Promise<{ status?: string }>
  onSigned?: () => void
}): Promise<'confirmed' | 'pending'> {
  const usdcRaw = String(BigInt(a.cents) * 10_000n)
  let built: { transaction: string; usdcRaw: string }
  try {
    built = await a.build(a.cents)
  } catch (e) {
    throw new TopUpFailed(apiStatus(e) !== null && apiStatus(e) !== 0 ? (e as Error).message : TOPUP.failedBefore)
  }
  // The button's amount, never the build's: a build for another amount is refused before the wallet is asked.
  if (built.usdcRaw !== usdcRaw) throw new TopUpFailed(REFUSED.plan)
  let signedTransaction: string
  try {
    signedTransaction = await a.sign({ kind: 'topup', user: a.user, usdcRaw })(built.transaction)
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
