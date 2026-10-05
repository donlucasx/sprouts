/** The API's answer when the signed approval is not on chain yet (link/confirm 409; relink/confirm polls the same way, contracts 5.5). */
// Duck-typed on ApiError's shape so this module stays free of api.ts (and its native session store) for the node tests.
export function isLateDelegation(e: unknown): boolean {
  return e instanceof Error && (e as { status?: unknown }).status === 409 && e.message.includes('No delegation found')
}

/**
 * Confirms an approval the wallet already signed (review I7, shared by Connect and the re-link card since T9 review I3): when the
 * delegation is late on chain the API answers 409 and the confirm is sent again, never a new signature, so a late approval never
 * leaves a stray delegation behind a fresh one. `send(attempt)` picks the body per attempt; any other error is thrown at once.
 */
export async function confirmWithRetries(
  send: (attempt: number) => Promise<unknown>,
  o: { tries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const tries = o.tries ?? 5
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let attempt = 0; ; attempt++) {
    try {
      await send(attempt)
      return
    } catch (e) {
      if (!isLateDelegation(e) || attempt >= tries - 1) throw e
      await sleep(o.waitMs ?? 4_000)
    }
  }
}
