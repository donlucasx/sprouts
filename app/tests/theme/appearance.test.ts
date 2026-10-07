import { describe, it, expect } from 'vitest'
import { isDark, parseAppearance, schemeFor } from '@/theme/appearance'

describe('appearance (R153: an in-app choice over the phone setting)', () => {
  it('schemeFor: dark and light force the scheme, system hands it back to the phone', () => {
    expect(schemeFor('dark')).toBe('dark')
    expect(schemeFor('light')).toBe('light')
    expect(schemeFor('system')).toBe('unspecified')
  })
  it('parseAppearance: only the three words; anything else is light, the default (his note 10-05)', () => {
    expect(parseAppearance('dark')).toBe('dark')
    expect(parseAppearance('light')).toBe('light')
    expect(parseAppearance(undefined)).toBe('light')
    expect(parseAppearance('blue')).toBe('light')
    expect(parseAppearance('system')).toBe('system')
  })
})

// 10-06 (the Seeker, phone in dark mode, app on Light): parts of the screen kept dark colours after Android briefly reported the
// phone's scheme. A Light or Dark choice now decides the colours by itself; only System follows what the phone reports.
describe('isDark: the in-app choice wins over what Android reports', () => {
  it('Light is light and Dark is dark, whatever the phone says', () => {
    for (const sys of ['dark', 'light', null, undefined] as const) {
      expect(isDark('light', sys)).toBe(false)
      expect(isDark('dark', sys)).toBe(true)
    }
  })
  it('System follows the phone', () => {
    expect(isDark('system', 'dark')).toBe(true)
    expect(isDark('system', 'light')).toBe(false)
    expect(isDark('system', null)).toBe(false)
  })
})
