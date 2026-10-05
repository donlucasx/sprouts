/**
 * Each confirm route's own 409 sentence for "your signed approval is not on chain yet" (T9 re-review: the routes do NOT share one).
 * The retry helper takes the route's sentence; a different 409 from that route is a real refusal and is thrown at once.
 */
/** api/src/app/api/link/confirm/route.ts:75 ("No delegation found for this wallet yet. Sign the approval first."), matched on its stem. */
export const LINK_NOT_ON_CHAIN_YET = 'No delegation found'
/** docs/superpowers/plans/2026-10-05-lending-api.md:5675, `/api/relink/confirm` after `waitForDelegation(pda, 10_000)`. Track A: keep it. */
export const RELINK_NOT_ON_CHAIN_YET = 'No re-link found on chain yet. Check again in a minute.'

// Duck-typed on ApiError's shape so this module stays free of api.ts (and its native session store) for the node tests.
export function isNotOnChainYet(e: unknown, sentence: string): boolean {
  return e instanceof Error && (e as { status?: unknown }).status === 409 && e.message.includes(sentence)
}

/**
 * Confirms an approval the wallet already signed (review I7, shared by Connect and the re-link card since T9 review I3): when the
 * route answers its own not-on-chain-yet 409 the confirm is sent again, never a new signature, so a late approval never leaves a stray
 * delegation behind a fresh one. `send(attempt)` picks the body per attempt; any other error is thrown at once.
 */
export async function confirmWithRetries(
  send: (attempt: number) => Promise<unknown>,
  o: { notOnChainYet: string; tries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> },
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
