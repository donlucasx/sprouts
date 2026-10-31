import { ApiError } from './api'
import { SignRefused } from './sign'
import { isSessionDropped, isWalletDeclined } from './wallet-errors'

/**
 * 10-31 (his "add logging for failed sign-ins and links"): the server never hears about a link that stops in the wallet (the 10-30
 * sweep: two Seeker owners fetched the approval and stopped, with no trace). The app reports where it stopped and what it saw to
 * POST /api/link/report, best effort. An API answer is not reported: the route that gave it already recorded it.
 */
export type LinkStep = 'new' | 'approval' | 'sign' | 'confirm'
export type LinkFailure = { step: LinkStep; reason: 'declined' | 'dropped' | 'refused' | 'other'; error: string; wallet?: string }

export function linkFailure(step: LinkStep, e: unknown, wallet?: string): LinkFailure | null {
  if (e instanceof ApiError) return null
  const reason = isSessionDropped(e) ? 'dropped' : isWalletDeclined(e) ? 'declined' : e instanceof SignRefused ? 'refused' : 'other'
  const error = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200)
  return { step, reason, error, ...(wallet ? { wallet } : {}) }
}

/** Sends the report and forgets it: a report that fails changes nothing the user sees. */
export function reportLinkFailure(post: (body: LinkFailure) => Promise<unknown>, step: LinkStep, e: unknown, wallet?: string): void {
  const f = linkFailure(step, e, wallet)
  if (f) post(f).catch(() => {})
}
