import { getLocales } from 'expo-localization'
import { store } from '@/lib/store'
import { en, type Key } from './en'
import { es } from './es'

/**
 * 0.1.13 (his ruling 11-24): Sprouts in English and Spanish. The phone's language by default (Android 13+ also offers a per-app
 * language in system Settings, declared in app.json); Settings > Language can pin English or Spanish. English is the source of
 * every line (en.ts); a line missing in Spanish falls back to English, never to a key or a blank.
 */
export type Lang = 'en' | 'es'
export type LangChoice = 'auto' | Lang
export const LANGS: readonly Lang[] = ['en', 'es']
const DICTS: Record<Lang, Partial<Record<Key, string>>> = { en, es }
const CHOICE = 'prefs.language'

/** The phone's own language code (lowercase, e.g. "es"), whatever Sprouts supports; null when the phone gives none. */
export function phoneLanguage(): string | null {
  try {
    const code = getLocales()[0]?.languageCode
    return typeof code === 'string' && /^[a-z]{2,3}$/i.test(code) ? code.toLowerCase() : null
  } catch {
    return null
  }
}

/** 0.1.13 (his ruling 11-24): the sign-in's language signal: the phone's own code only (e.g. "es"), never the pinned choice. */
export function langSignal(): { lang?: string } {
  const l = phoneLanguage()
  return l ? { lang: l } : {}
}

export function readLangChoice(): LangChoice {
  const v = store.getString(CHOICE)
  return v === 'en' || v === 'es' ? v : 'auto'
}

/** The language the app shows: the pinned one, else the phone's when Sprouts has it, else English. */
export function currentLang(): Lang {
  const c = readLangChoice()
  if (c !== 'auto') return c
  const p = phoneLanguage()
  return p === 'es' ? 'es' : 'en'
}

const listeners = new Set<() => void>()
/** For useLang (useSyncExternalStore): a change re-renders every screen at once. */
export function subscribeLang(l: () => void): () => void {
  listeners.add(l)
  return () => void listeners.delete(l)
}
/** Every subscriber hears the change: the screens (useLang), and outside React the placed widget (lib/me.ts redraws it with
 *  refreshWidget) and the notification channel's name (lib/notify.ts). Those two subscribe from their own modules, which the entry
 *  (index.js) loads, so this file never imports native widget or notification code. */
export function writeLangChoice(c: LangChoice) {
  if (c === 'auto') store.remove(CHOICE)
  else store.set(CHOICE, c)
  for (const l of listeners) l()
}

export type Vars = Record<string, string | number>
/** The line for `key` in `lang` (default: the current one), with {name} placeholders filled; unknown placeholders stay as written. */
export function t(key: Key, vars?: Vars, lang: Lang = currentLang()): string {
  const line = DICTS[lang][key] ?? en[key]
  return vars ? line.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : line
}
