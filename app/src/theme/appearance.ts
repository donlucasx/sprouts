/** The in-app appearance choice (R153): Light is the default (his note 10-05, replacing R149's System); System follows the phone; Dark overrides it. Pure: no react-native import. */
export type Appearance = 'system' | 'light' | 'dark'

export function parseAppearance(s: string | undefined): Appearance {
  return s === 'system' || s === 'dark' ? s : 'light'
}

/** What React Native's `Appearance.setColorScheme` takes: the scheme itself, or `unspecified` to follow the phone again. */
export function schemeFor(a: Appearance): 'light' | 'dark' | 'unspecified' {
  return a === 'system' ? 'unspecified' : a
}

/**
 * Dark or not, from the in-app choice first (10-06): Light and Dark decide by themselves; only System reads what the phone reports.
 * Android can briefly report the phone's own scheme (a wallet in front, a fresh activity), and colours read from that report alone
 * left parts of the screen dark while the rest was light (the Seeker, phone in dark mode, app on Light).
 */
export function isDark(choice: Appearance, phone: string | null | undefined): boolean {
  return choice === 'dark' || (choice === 'system' && phone === 'dark')
}
