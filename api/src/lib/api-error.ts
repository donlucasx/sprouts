import { NextResponse } from "next/server";

/**
 * 0.1.13 Spanish pass P8: every JSON error a route answers carries a stable machine `code` next to its `error` sentence. The app
 * matches the code; the sentence is for people. The `error` text stays the English it has always been (byte for byte): a 0.1.12 app
 * matches some of it by its stem (app/src/lib/confirm-retry.ts). Codes are snake_case and never renamed once shipped; add, never reuse.
 */
export const API_ERROR_CODES = {
  // Shared
  sign_in_first: "No session, or it expired (401).",
  bad_request: "The body or a parameter did not parse (400). The sentence may name the field.",
  rate_limited: "Too many calls in a short window (429).",
  daily_limit: "The day's allowance for this action is used (429).",
  reauth_required: "A fresh wallet sign-in is needed for this change (403, with reauth: true).",
  bad_address: "Not a Solana address (400).",
  bad_transaction: "The signed transaction could not be read (400).",
  wrong_transaction: "The signed transaction is not the one Sprouts built or asked for (400 or 409).",
  tx_failed: "The chain reports the transaction failed (400 or 409).",
  tx_expired: "The blockhash expired before it landed; nothing moved (409).",
  still_waiting: "Sent, not confirmed yet; check again shortly (409).",
  chain_catching_up: "The chain does not show the change yet; check again in a minute (409).",
  venue_unreadable: "A lending venue could not be read just now (503).",
  pool_full: "The venue's pool is fully lent out (409, with poolFull: true).",
  not_found: "No such route for this caller (404, ops).",
  unauthorized: "Missing or wrong server credentials (401, cron, webhooks).",
  wrong_password: "Ops password did not match (401).",
  internal: "The server failed (500).",
  busy: "Another run of the same job is going (409).",
  // Sign-in
  bad_signature: "The sign-in signature is malformed (400).",
  signature_invalid: "The sign-in signature did not verify (401).",
  nonce_expired: "The sign-in request expired or was used (401).",
  no_genesis_token: "The wallet holds no Seeker Genesis Token (403).",
  phone_registered: "This phone is already registered (409).",
  // Link a wallet
  code_unknown: "The link code is unknown, expired or used (404).",
  code_not_fetched: "Confirm before the approval for this code was fetched (409).",
  code_other_wallet: "The code was used with another wallet (409).",
  code_outdated: "The code predates the current link model (409).",
  wallet_taken: "The wallet is linked to another Seeker (409).",
  link_would_fail: "The approval would fail on chain; nothing asked of the wallet (400).",
  no_delegation: "Link confirm: the approval is not on chain (yet). The app retries the confirm on this (409).",
  // Re-link
  link_wallet_first: "No live link for this phone's wallet (409).",
  already_relinked: "The wallet is already re-linked (409).",
  relink_keeps_old: "The re-link does not revoke the current approval (400).",
  relink_would_fail: "The re-link would fail on chain; nothing asked of the wallet (400).",
  relink_not_on_chain: "Re-link confirm: the re-link is not on chain (yet). The app retries the confirm on this (409).",
  wrong_mint: "The approval on chain is not for USDC (409).",
  // Wallets, revoke
  wallet_not_found: "No such wallet for this user (404).",
  wallet_revoked: "The wallet was revoked (409).",
  nothing_to_revoke: "No live link to revoke (409).",
  // Moves
  move_not_found: "No such move for this user (404).",
  move_not_open: "The move is no longer open (409).",
  move_in_flight: "The move is under way (409, with inFlight: true).",
  move_not_built: "Confirm before build (409).",
  move_unsure: "The move may still go through (409).",
  move_partial: "The redeem landed, the deposit did not (409, with partial: true).",
  nothing_to_move: "The position is empty (409).",
  move_unsized: "The move could not be sized (409).",
  // Withdraw, lend withdraw, basket
  min_withdrawal: "Below the smallest withdrawal (400).",
  withdraw_too_large: "More than the position holds (400).",
  withdraw_refused: "The withdrawal plan refused this request (409).",
  nothing_to_withdraw: "The position is empty (409).",
  basket_busy: "A withdrawal is already ripening (409).",
  basket_empty: "Nothing in the basket (409).",
  // Plant my SKR, top-up
  plant_off: "Plant my SKR is switched off (503).",
  plant_bad_amount: "The SKR amount is not valid (400).",
  plant_refused: "Plant my SKR refused this request (status as given).",
  plant_not_now: "Plant my SKR could not be built just now (503).",
  topup_bad_amount: "The top-up amount is outside $2 to $25 (400).",
  topup_bad_source: "The top-up source coin is not valid (400).",
  topup_refused: "The top-up refused this request (status as given).",
  topup_not_now: "The top-up could not be built just now (503).",
  // Rules, terms, preview, feedback, export, watcher
  pin_invalid: "A pin breaks the split's rules (400).",
  rules_not_saved: "The rules could not be saved just now (503).",
  nothing_to_undo: "No split change to undo (409).",
  terms_outdated: "Accepting a Terms version that is not current (400).",
  has_wallet: "The preview is only for a user with no wallet linked (409).",
  preview_unavailable: "The preview could not be read (503).",
  pick_answer: "The feedback answer is not one of the choices (400).",
  bad_year: "The export year is not four digits (400).",
  export_too_long: "The history is too long for one export (503).",
  watcher_resting: "The watcher's monthly budget is spent (503).",
  watcher_unreadable: "The watcher could not read the request (502).",
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

/**
 * The one way a route answers an error: `body` is exactly what the route answered before (its English `error` and any extra fields,
 * e.g. `partial`, `inFlight`, `reauth`), `init` its status and headers. The answer is `{ error, code, ...extras }`.
 */
export function apiError(code: ApiErrorCode, body: { error: string } & Record<string, unknown>, init: ResponseInit): NextResponse {
  const { error, ...extras } = body;
  return NextResponse.json({ error, code, ...extras }, init);
}

/** The code for a confirm route's settle outcome that is not "confirmed". */
export const settleCode = (s: string): ApiErrorCode => (s === "failed" ? "tx_failed" : s === "expired" ? "tx_expired" : "still_waiting");
