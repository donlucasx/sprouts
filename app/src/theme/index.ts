import { useColorScheme } from 'react-native'
import { palette, type Palette } from './tokens'

export * from './tokens'

/** The palette for the phone's appearance, read at render time; the one way a component gets a colour. */
export function useTheme(): { colors: Palette; dark: boolean } {
  const dark = useColorScheme() === 'dark'
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
