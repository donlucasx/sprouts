/** The in-app appearance choice (R153): Light is the default (his note 10-05, replacing R149's System); System follows the phone; Dark overrides it. Pure: no react-native import. */
export type Appearance = 'system' | 'light' | 'dark'

export function parseAppearance(s: string | undefined): Appearance {
  return s === 'system' || s === 'dark' ? s : 'light'
}

/** What React Native's `Appearance.setColorScheme` takes: the scheme itself, or `unspecified` to follow the phone again. */
export function schemeFor(a: Appearance): 'light' | 'dark' | 'unspecified' {
  return a === 'system' ? 'unspecified' : a
}
