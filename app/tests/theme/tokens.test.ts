import { describe, it, expect } from 'vitest'
import { palette, type, spacing, radius, FONT } from '@/theme/tokens'

// The brand manual v1.0 (brand/manual, RB24) is the source: every constant here is the manual's, so a drift shows as a red test.
describe("the brand tokens carry the manual's constants", () => {
  it("palette, light: the manual's values and roles", () => {
    expect(palette.light).toMatchObject({
      background: '#FFFCF6', // Paper: page and card ground
      surface: '#FBF7EF', // Cream: tiles, panels
      iconGround: '#F4EEDF', // the app icon background and splash
      text: '#2B2622', // Ink
      accent: '#1E6B44', // Sprout green: the mark, primary actions
      onAccent: '#FFFFFF',
      accentText: '#145A3C', // Deep green: small text on paper
      success: '#2E8B57', // Leaf green
      attention: '#7A6248', // Soil
      trackOff: '#D9D2C6', // a switch's off track (R138: never reads as greyed out)
      thumb: '#FFFCF6',
      disabledText: '#6E6A64',
    })
  })
  it("palette, dark: the manual's dark theme, never a mechanical invert", () => {
    expect(palette.dark).toMatchObject({
      trackOff: '#3A5546',
      thumb: '#FFFCF6',
      disabledText: '#7E9A86',
      background: '#0E1A14',
      text: '#FFFCF6',
      textSecondary: '#E3FBD9',
      accent: '#A7F0B6',
      onAccent: '#0E1A14',
    })
  })
  it('light and dark name the same roles', () => {
    expect(Object.keys(palette.dark).sort()).toEqual(Object.keys(palette.light).sort())
  })
  it('the type ramp: two faces, six steps', () => {
    expect(FONT).toEqual({
      display: 'Outfit_600SemiBold',
      displayBold: 'Outfit_700Bold',
      body: 'AlbertSans_400Regular',
      label: 'AlbertSans_500Medium',
    })
    expect([
      type.display.fontSize,
      type.title.fontSize,
      type.heading.fontSize,
      type.body.fontSize,
      type.label.fontSize,
      type.caption.fontSize,
    ]).toEqual([40, 28, 20, 16, 13, 11])
    expect([type.display, type.title, type.heading].every((t) => t.fontFamily === FONT.display)).toBe(true)
    expect(type.body.fontFamily).toBe(FONT.body)
    expect(type.label.fontFamily).toBe(FONT.label)
    expect(type.caption.fontFamily).toBe(FONT.body)
    for (const t of Object.values(type)) expect(t.lineHeight).toBeGreaterThan(t.fontSize)
  })
  it("spacing on the 4-point grid with the garden's 20 edge; radii 8 / 12 / 16 and the capsule", () => {
    expect(spacing).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, edge: 20, xl: 24, xxl: 32 })
    expect(radius).toEqual({ sm: 8, md: 12, lg: 16, full: 999 })
  })
})
