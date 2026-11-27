import { Text, type ColorValue } from 'react-native'
import { FONT } from '@/theme'
import { t } from '@/i18n'
import { useLang } from '@/i18n/useLang'
import type { Key } from '@/i18n/en'

/**
 * A tab's name in the current language. 11-27 (his device test, build 3: the app in English, the tab names still Spanish): the React
 * Compiler (app.json experiments.reactCompiler) caches `t(k)` on its arguments, and `useLang()` called for its re-render alone is not
 * an argument, so the cached name from the first render came back on every later one. The language is passed into t(), so a change
 * re-reads the name (tests/lib/tab-label.test.ts compiles this file with the compiler and switches both ways).
 */
export function TabLabel({ k, color }: { k: Key; color: ColorValue }) {
  const lang = useLang()
  return <Text style={{ fontFamily: FONT.label, fontSize: 12, color }}>{t(k, undefined, lang)}</Text>
}
