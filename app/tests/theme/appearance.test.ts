import { describe, it, expect } from 'vitest'
import { parseAppearance, schemeFor } from '@/theme/appearance'

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
