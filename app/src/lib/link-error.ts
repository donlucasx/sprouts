import { ApiError } from './api'
import { SignRefused } from './sign'
import { isSessionDropped, isWalletDeclined } from './wallet-errors'

/**
 * Copy C: what the link screen says when the phone's wallet ends a request without approving. Both wallets send a user's back gesture
 * as a drop (11-07), so a drop and a decline read alike. No automatic retry: Try again is the user's tap. `ask` offers "What happened?".
 * Other errors keep their own text (no title) and do not ask.
 */
export function linkErrorView(e: unknown): { title: string; body: string; ask: boolean } {
  if (e instanceof ApiError || e instanceof SignRefused) return { title: '', body: e.message, ask: false }
  if (isSessionDropped(e) || isWalletDeclined(e)) {
    return { title: 'Seed Vault closed before approving', body: 'Nothing was sent. Tap Try again and press Approve on the next screen.', ask: true }
  }
  return { title: '', body: 'The approval did not go through. Try again.', ask: false }
}
