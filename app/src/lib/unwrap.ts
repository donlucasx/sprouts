import { getAddressEncoder, getBase64Encoder, getProgramDerivedAddress, getTransactionDecoder, type Address, type Transaction } from '@solana/kit'
import { ATA_PROGRAM, checkBeforeSigning, SignRefused, REFUSED, WSOL_MINT } from './sign'

export const UNWRAP_BUTTON = 'Unwrap your SOL'
export const UNWRAP_DONE = 'Your SOL is back in your wallet.'
/** Only for an on-chain failure the chain itself reported. */
export const UNWRAP_FAILED = 'Could not unwrap it. Your next withdraw or move closes it too.'

/**
 * The SOL move's partial failure (moves/confirm 409): the redeem landed and the deposit did not, so the SOL sits in the user's WSOL
 * account. The route hands back a one-instruction unwrap; this is it, or null when the 409 is any other answer. Duck-typed on
 * ApiError's shape (status, body) so this module needs nothing from api.ts.
 */
export function partialUnwrap(e: unknown): string | null {
  if (!(e instanceof Error)) return null
  const { status, body } = e as { status?: unknown; body?: { partial?: unknown; unwrapTransaction?: unknown } }
  if (status !== 409 || !body || body.partial !== true) return null
  return typeof body.unwrapTransaction === 'string' && body.unwrapTransaction.length > 0 ? body.unwrapTransaction : null
}

export const UNWRAP_SENT = 'Sent. Check Home in a minute.'
export const UNWRAP_NOT_SENT = 'Not sent. Tap again to try once more.'
export const UNWRAP_NOT_YET = 'Not unwrapped yet. Check Home in a minute.'
export const UNWRAP_UNSURE = 'Sent? Check Home in a minute.'
/**
 * The unwrap carries a blockhash that lives 60 to 90 s; past the short end of it a retry cannot land. The age is measured from the moment
 * the app RECEIVED the unwrapTransaction (the 409), the closest the app can get to when the API took the blockhash.
 */
export const UNWRAP_VALID_MS = 60_000

export type UnwrapStatus = 'confirmed' | 'failed' | 'pending'
export type UnwrapOutcome = 'confirmed' | 'failed' | 'unknown'

/**
 * Checks the unwrap against the 'unwrap_wsol' flow (exactly one CloseAccount of this user's WSOL account to this user), and only then asks
 * the wallet to sign and send it. The wallet answers on SUBMISSION, so the answer is read back: 'confirmed' only when the chain says so,
 * 'failed' when it says the transaction errored, 'unknown' when it is still not seen after the bounded wait. An error from the wallet (a
 * decline, a cancelled sheet) is thrown as it is: nothing was sent.
 */
export async function unwrapAtTap(a: {
  user: string
  transaction: string
  signAndSend: (tx: Transaction) => Promise<string>
  status: (signature: string) => Promise<UnwrapStatus>
  tries?: number
  waitMs?: number
  sleep?: (ms: number) => Promise<void>
}): Promise<UnwrapOutcome> {
  let tx: Transaction
  try {
    tx = getTransactionDecoder().decode(getBase64Encoder().encode(a.transaction))
  } catch {
    throw new SignRefused(REFUSED.unreadable)
  }
  await checkBeforeSigning(tx, { kind: 'unwrap_wsol', user: a.user })
  const signature = await a.signAndSend(tx)
  const tries = a.tries ?? 10
  const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let i = 0; i < tries; i++) {
    if (i > 0) await sleep(a.waitMs ?? 2_000)
    let s: UnwrapStatus = 'pending'
    try {
      s = await a.status(signature)
    } catch {
      // a read that fails says nothing about the transaction
    }
    if (s !== 'pending') return s
  }
  return 'unknown'
}

/** After a wallet error with the transaction `ageMs` old: the button stays while a retry could still land. */
export const unwrapRetryable = (ageMs: number) => ageMs < UNWRAP_VALID_MS

/** The user's WSOL associated token account, derived on the phone (the account the unwrap closes). */
export async function wsolAccount(user: string): Promise<string> {
  const enc = getAddressEncoder()
  const token = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
  const [a] = await getProgramDerivedAddress({ programAddress: ATA_PROGRAM as Address, seeds: [enc.encode(user as Address), enc.encode(token as Address), enc.encode(WSOL_MINT as Address)] })
  return a
}

/** The wallet's own explicit "no" before anything was sent: MWA ERROR_NOT_SIGNED (-3, the user declined) or a closed wallet sheet. */
export function isWalletDecline(e: unknown): boolean {
  const code = e instanceof Error ? (e as { code?: unknown }).code : undefined
  return code === -3 || code === 'ERROR_ASSOCIATION_CANCELLED'
}

export type UnwrapAfterError = { text: string; error: boolean; keepButton: boolean; invalidate: boolean }

/**
 * What to say after the wallet step threw. Read state, never guess from the error: only our own refusal and the wallet's explicit
 * decline mean nothing was sent. Any other error (a send error, a timeout, a dropped session) can come after the wallet submitted, so the
 * user's WSOL account is read: gone means the unwrap landed; still there means not yet (the button stays only while the blockhash can
 * land); a read that fails says nothing.
 */
export async function unwrapAfterError(a: { error: unknown; ageMs: number; accountExists: () => Promise<boolean> }): Promise<UnwrapAfterError> {
  if (a.error instanceof SignRefused) return { text: a.error.message, error: true, keepButton: false, invalidate: false }
  if (isWalletDecline(a.error)) return { text: UNWRAP_NOT_SENT, error: true, keepButton: unwrapRetryable(a.ageMs), invalidate: false }
  let exists: boolean
  try {
    exists = await a.accountExists()
  } catch {
    return { text: UNWRAP_UNSURE, error: false, keepButton: false, invalidate: true }
  }
  if (!exists) return { text: UNWRAP_DONE, error: false, keepButton: false, invalidate: true }
  return { text: UNWRAP_NOT_YET, error: true, keepButton: unwrapRetryable(a.ageMs), invalidate: true }
}
