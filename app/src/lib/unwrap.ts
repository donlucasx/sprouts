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

/** Checks the unwrap against the 'unwrap_wsol' flow (exactly one CloseAccount of this user's WSOL account to this user), and only then asks the wallet to sign and send it. */
export async function unwrapAtTap(a: { user: string; transaction: string; signAndSend: (tx: Transaction) => Promise<unknown> }): Promise<void> {
  let tx: Transaction
  try {
    tx = getTransactionDecoder().decode(getBase64Encoder().encode(a.transaction))
  } catch {
    throw new SignRefused(REFUSED.unreadable)
  }
  await checkBeforeSigning(tx, { kind: 'unwrap_wsol', user: a.user })
  await a.signAndSend(tx)
}
