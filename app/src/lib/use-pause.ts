import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, type MeResponse } from './api'
import { useInvalidateMe } from './me'
import { setPaused } from './pause-api'
import { freshWalletSignIn } from './reauth'
import { identity } from './identity'

/** The Sprouts switch's action (R147; moved from Home to Rules, R448): the answer's statuses land on the cached read at once, so
 *  the row settles with the switch; the fresh read reconciles after. */
export function usePauseToggle() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateMe()
  const [pausing, setPausing] = useState(false)
  const [pauseError, setPauseError] = useState<string | null>(null)
  async function togglePaused(on: boolean) {
    setPausing(true)
    setPauseError(null)
    try {
      const answer = await setPaused(!on, freshWalletSignIn(identity))
      queryClient.setQueryData<MeResponse>(['me'], (old) =>
        old
          ? {
              ...old,
              wallets: old.wallets.map((w) => ({
                ...w,
                status: answer.wallets.find((a) => a.pubkey === w.pubkey)?.status ?? w.status,
              })),
            }
          : old,
      )
      void invalidate()
    } catch (e) {
      setPauseError(
        e instanceof ApiError ? e.message : on ? 'Could not turn Sprouts back on. Try again.' : 'Could not pause. Try again.',
      )
    } finally {
      setPausing(false)
    }
  }
  return { pausing, pauseError, togglePaused }
}
