import { useSyncExternalStore } from 'react'
import { currentLang, subscribeLang, type Lang } from './index'

/**
 * The current language; a component that calls this re-renders when it changes. 11-27: the React Compiler caches a `t(key)` call on
 * its arguments, so in a component the compiler memoizes, pass this value into t (`t(key, vars, lang)`) or the old line can come back
 * (components/TabLabel). Nothing keys the tree on the language.
 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, currentLang, currentLang)
}
