/**
 * Each confirm route's own 409 for "your signed approval is not on chain yet" (T9 re-review: the routes do NOT share one).
 * 0.1.13 Spanish pass P8: the route sends a machine `code` beside its sentence, and its sentence may soon be Spanish. The retry
 * matches the code when the answer has one, and falls back to the English stem for an older server (0.1.12-era API: `{ error }` only).
 * A different 409 from that route is a real refusal and is thrown at once.
 */
export type NotOnChainMatch = { code: string; stem: string }

/** api/src/app/api/link/confirm/route.ts ("No delegation found for this wallet yet. Sign the approval first." and its two siblings), matched on its stem. */
export const LINK_NOT_ON_CHAIN_YET = 'No delegation found'
/** docs/superpowers/plans/2026-10-05-lending-api.md:5675, `/api/relink/confirm` after `waitForDelegation(pda, 10_000)`. Track A: keep it. */
export const RELINK_NOT_ON_CHAIN_YET = 'No re-link found on chain yet. Check again in a minute.'
/** The codes the API sends with those sentences (api/src/lib/api-error.ts API_ERROR_CODES). */
export const LINK_NOT_ON_CHAIN: NotOnChainMatch = { code: 'no_delegation', stem: LINK_NOT_ON_CHAIN_YET }
export const RELINK_NOT_ON_CHAIN: NotOnChainMatch = { code: 'relink_not_on_chain', stem: RELINK_NOT_ON_CHAIN_YET }

// Duck-typed on ApiError's shape (status, message, code) so this module stays free of api.ts (and its native session store) for the node tests.
export function isNotOnChainYet(e: unknown, m: NotOnChainMatch): boolean {
  if (!(e instanceof Error) || (e as { status?: unknown }).status !== 409) return false
  const code = (e as { code?: unknown }).code
  // A code decides alone (the text may be in another language); no code is an older server, read by its English stem.
  return typeof code === 'string' && code.length > 0 ? code === m.code : e.message.includes(m.stem)
}

/**
 * Confirms an approval the wallet already signed (review I7, shared by Connect and the re-link card since T9 review I3): when the
 * route answers its own not-on-chain-yet 409 the confirm is sent again, never a new signature, so a late approval never leaves a stray
 * delegation behind a fresh one. `send(attempt)` picks the body per attempt; any other error is thrown at once.
 */
export async function confirmWithRetries(
  send: (attempt: number) => Promise<unknown>,
  o: { notOnChainYet: NotOnChainMatch; tries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const tries = o.tries ?? 5
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 0; ; attempt++) {
    try {
      await send(attempt)
      return
    } catch (e) {
      if (!isNotOnChainYet(e, o.notOnChainYet) || attempt >= tries - 1) throw e
      await sleep(o.waitMs ?? 4_000)
    }
  }
}

/**
 * 11-26 (Kimi scope 2 B): link/confirm and relink/confirm answer 409 `blockhash_expired` when the network refused the signed approval
 * because its blockhash expired. Those bytes can never land, so confirmWithRetries (which re-posts them) stops at once on it (the code
 * decides alone), and the flow builds a fresh approval and asks the wallet ONCE more. Only a 0.1.13-era server sends the code; its
 * English keeps the not-on-chain stem, so a 0.1.12 app keeps retrying as before.
 */
export const BLOCKHASH_EXPIRED = 'blockhash_expired'
export function isBlockhashExpired(e: unknown): boolean {
  return e instanceof Error && (e as { status?: unknown }).status === 409 && (e as { code?: unknown }).code === BLOCKHASH_EXPIRED
}

/**
 * Build, sign, confirm; on `blockhash_expired` (and only then) build, sign and confirm one more time. Never a third signature: a second
 * expiry, or any other error, is thrown as it came. `onRebuild` runs before the second build (the screen says why the wallet asks again).
 */
export async function signAndConfirmRebuildingOnce<B>(a: {
  build: () => Promise<B>
  sign: (built: B) => Promise<string>
  confirm: (signed: string) => Promise<void>
  /** Called after each signature returns, before its confirm. */
  onSigned?: () => void
  onRebuild?: () => void
}): Promise<void> {
  for (let round = 0; ; round++) {
    const built = await a.build()
    const signed = await a.sign(built)
    a.onSigned?.()
    try {
      await a.confirm(signed)
      return
    } catch (e) {
      if (round > 0 || !isBlockhashExpired(e)) throw e
    }
    a.onRebuild?.()
  }
}
