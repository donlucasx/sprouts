/** The in-app appearance choice (R153): System follows the phone (R149's default); Light and Dark override it on this phone. Pure: no react-native import. */
export type Appearance = 'system' | 'light' | 'dark'

export function parseAppearance(s: string | undefined): Appearance {
  return s === 'light' || s === 'dark' ? s : 'system'
}

/** What React Native's `Appearance.setColorScheme` takes: the scheme itself, or `unspecified` to follow the phone again. */
export function schemeFor(a: Appearance): 'light' | 'dark' | 'unspecified' {
  return a === 'system' ? 'unspecified' : a
}
