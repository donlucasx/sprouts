import { createContext, useContext, useSyncExternalStore } from 'react'
import { useColorScheme } from 'react-native'
import { palette, type Palette } from './tokens'
import { isDark } from './appearance'
import { readAppearance, subscribeAppearance } from '@/lib/prefs'

export * from './tokens'

/**
 * The palette for the in-app appearance, read at render time; the one way a component gets a colour. Light and Dark come from the
 * saved choice itself; only System follows the phone (isDark, 10-06: a scheme Android reported for a moment no longer repaints part
 * of the screen).
 */
/** R580: a subtree that is always drawn light, whatever the appearance (the loading screen's watercolour is painted for paper). */
export const LightOnly = createContext(false)

export function useTheme(): { colors: Palette; dark: boolean } {
  const choice = useSyncExternalStore(subscribeAppearance, readAppearance)
  const scheme = useColorScheme()
  const dark = !useContext(LightOnly) && isDark(choice, scheme)
  return { colors: dark ? palette.dark : palette.light, dark }
}

/** A native Switch in the brand (R138: a light track when off, green when on, so an off switch never reads as greyed out). */
export function switchColors(colors: Palette) {
  return {
    trackColor: { false: colors.trackOff, true: colors.accent },
    thumbColor: colors.thumb,
    ios_backgroundColor: colors.trackOff,
  }
}
