import { getBase64Encoder, getTransactionDecoder, type Transaction } from '@solana/kit'
import { checkBeforeSigning, SignRefused, REFUSED } from './sign'

export const UNWRAP_BUTTON = 'Unwrap your SOL'
export const UNWRAP_DONE = 'Your SOL is back in your wallet.'
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
/** The unwrap carries a blockhash that lives 60 to 90 s; past the short end of it a retry cannot land. */
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
