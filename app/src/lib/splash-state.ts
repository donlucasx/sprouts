import { useSyncExternalStore } from 'react'

/**
 * Whether the launch's loading screen (components/Splash.tsx, R282: over the app on every launch) has started to lift. Home holds the
 * garden's reveal (R521) until then: the s6 review (C1) found the growth played under the loading screen and was marked seen unseen.
 */
let lifted = false
const listeners = new Set<() => void>()
export function markSplashLifted(): void {
  if (lifted) return
  lifted = true
  listeners.forEach((l) => l())
}
export const splashLifted = (): boolean => lifted
export function useSplashLifted(): boolean {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    splashLifted,
    splashLifted,
  )
}
