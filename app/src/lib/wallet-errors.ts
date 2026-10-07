/**
 * The two ways a wallet request ends without a result, told apart (audits/signin-drop, 10-06). They need different handling:
 * a DROP is the wallet closing its session without answering (a cold, locked Solflare does this after the user approved; the retry
 * works), a DECLINE is the wallet's own "no". Only a drop is ever retried, and only for a sign-in.
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
export const DROPPED_NOTHING_SENT = "Your wallet closed before answering, so nothing was sent. Try again.";
