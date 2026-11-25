import { useSyncExternalStore } from 'react'
import { currentLang, subscribeLang, type Lang } from './index'

/** The current language; a screen that calls this re-renders when it changes (the root keys the tree on it too). */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, currentLang, currentLang)
}
