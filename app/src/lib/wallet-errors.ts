/**
 * The two ways a wallet request ends without a result (audits/signin-drop, 10-06). A DROP is the wallet closing its session without
 * answering: a cold, locked Solflare does it after the user approved (the retry works), and BOTH wallets we have (Solflare 2.29.1 on
 * the Saga, Seed Vault Wallet on the Seeker) also send a user's cancel this way, on sign-ins and transactions alike (device tests,
 * 10-06). A DECLINE is the standard MWA "no", which neither wallet sent us. So the copy never claims which one happened, and only a
 * sign-in retries a drop (once).
 */

/** The wallet closed the session with the request still open: no reply, the MWA client cancels the pending call. */
export function isSessionDropped(e: unknown): boolean {
  return e instanceof Error && e.message.includes("CancellationException");
}

/** The wallet said no: MWA -1 (ERROR_AUTHORIZATION_FAILED, e.g. Solflare declining a stale token), a closed sheet, or a user cancel. */
export function isWalletDeclined(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const code = String((e as { code?: unknown }).code ?? "");
  return code === "-1" || code === "ERROR_ASSOCIATION_CANCELLED" || e.message.includes("authorization request failed") || e.message.includes("cancelled by user");
}

/**
 * For a signing flow (withdraw, link, revoke): the phone only signs and the API sends, so a drop means nothing was sent. Never
 * retried on its own: the user approved a spend, and one more prompt is theirs to start.
 */
export const DROPPED_NOTHING_SENT = "Your wallet didn't sign, so nothing was sent. Try again.";

/** A sign-in that ended without a signature, whether the wallet dropped it or the user cancelled (the wallets send both alike). */
export const SIGN_IN_DID_NOT_FINISH = "Sign-in didn't finish in your wallet. Tap Sign in to try again.";
