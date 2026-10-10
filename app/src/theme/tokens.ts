/**
 * The brand's constants, from the brand manual v1.0 (brand/manual/sprouts-brand-manual.html, RB24): the palette and its roles, the
 * two faces and the six-step ramp, the grid. Pure, so tests can read it; the hook that picks light or dark lives in ./index.ts.
 * Values the manual does not name (a muted ink, the dark surface, hairlines, the error brick) were derived in the UI pass of
 * 2026-10-01 and are marked so. Nothing outside src/theme/ writes a colour or a size.
 */

/** Two faces (manual 5): Outfit for the name, titles and big numbers; Albert Sans for everything people read. Loaded in app/_layout.tsx. */
export const FONT = {
  display: 'Outfit_600SemiBold',
  /** Below 24 px the word is set in Outfit 700 so its counters hold (manual 3). */
  displayBold: 'Outfit_700Bold',
  body: 'AlbertSans_400Regular',
  label: 'AlbertSans_500Medium',
} as const

export type Palette = {
  /** Paper: page and card ground. Dark: the manual's Dark. */
  background: string
  /** Cream: tiles and panels on paper. Dark: a step above the ground (derived). */
  surface: string
  /** The app icon background and the splash (app.json). */
  iconGround: string
  /** Ink: text and the wordmark. Dark: paper ("the ink becomes paper"). */
  text: string
  /** Secondary text. Light: ink at about two thirds on paper (derived, 5.5:1). Dark: Pale mint. */
  textSecondary: string
  /** Sprout green: the mark and primary actions, the only green on the mark. Dark: Mint. */
  accent: string
  /** Text on the accent. */
  onAccent: string
  /** Deep green: small text and links on paper. Dark: Mint. */
  accentText: string
  /** Leaf green: good, success (manual 4, "each paired with a word, never colour alone"). */
  success: string
  /** Soil: attention. */
  attention: string
  /** A desaturated brick: error (the manual leaves the value to the UI pass). */
  error: string
  /** Hairlines and the off state of a switch track (derived). */
  hairline: string
  /** A disabled control's fill (derived). */
  disabled: string
  /** A switch's off track: visible on the surface in both themes (R138; the review's dark finding). */
  trackOff: string
  /** A switch's thumb: paper in both themes. */
  thumb: string
  /** A disabled control's label (derived). */
  disabledText: string
}

export const palette: { light: Palette; dark: Palette } = {
  light: {
    background: '#FFFCF6',
    surface: '#FBF7EF',
    iconGround: '#F4EEDF',
    text: '#2B2622',
    textSecondary: '#6E6A64',
    accent: '#1E6B44',
    onAccent: '#FFFFFF',
    accentText: '#145A3C',
    success: '#2E8B57',
    attention: '#7A6248',
    error: '#9E4B3F',
    hairline: '#E6DFD2',
    disabled: '#D9D2C6',
    trackOff: '#D9D2C6',
    thumb: '#FFFCF6',
    disabledText: '#6E6A64',
  },
  // Manual 4, dark theme: the greens lighten to the mints, the paper becomes dark, the ink becomes paper; never a mechanical invert.
  dark: {
    background: '#0E1A14',
    surface: '#16261D',
    iconGround: '#0E1A14',
    text: '#FFFCF6',
    textSecondary: '#E3FBD9',
    accent: '#A7F0B6',
    onAccent: '#0E1A14',
    accentText: '#A7F0B6',
    success: '#A7F0B6',
    attention: '#C9A98A',
    error: '#E8998C',
    hairline: '#243A2E',
    disabled: '#2A3F33',
    trackOff: '#3A5546',
    thumb: '#FFFCF6',
    disabledText: '#7E9A86',
  },
}

/** The six steps (manual 5). Sizes are the manual's; line heights are the pass's, about 1.15 for display, 1.5 for body. */
export const type = {
  /** Screen titles, the big number on Home and the widget. */
  display: { fontFamily: FONT.display, fontSize: 40, lineHeight: 48 },
  /** Section titles. */
  title: { fontFamily: FONT.display, fontSize: 28, lineHeight: 34 },
  /** Card titles. */
  heading: { fontFamily: FONT.display, fontSize: 20, lineHeight: 26 },
  /** Running text, explanations, the AI lines. */
  body: { fontFamily: FONT.body, fontSize: 16, lineHeight: 24 },
  /** Buttons, field labels, the tagline. */
  label: { fontFamily: FONT.label, fontSize: 13, lineHeight: 18 },
  /** Buttons and the control bar, one step up from the label (R144: 13 reads small in a 48 dp pill). */
  button: { fontFamily: FONT.label, fontSize: 15, lineHeight: 20 },
  /** Timestamps, hints; never below 11. */
  caption: { fontFamily: FONT.body, fontSize: 11, lineHeight: 15 },
} as const

/** Garden2's painted signs (R557): the coin name lettered on a stake's plank. One ink in both themes: the garden is always the light plate (R530). */
export const GARDEN_INK = { sign: '#3B2A1A', signOpacity: 0.9 } as const

/** The 4-point grid. `edge` is the screen's side padding: the garden draws at the window width minus twice this. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, edge: 20, xl: 24, xxl: 32 } as const

export const radius = { sm: 8, md: 12, lg: 16, full: 999 } as const

/** The wordmark's tracking, -0.02 em (manual 3), in React Native's pixel units. */
export const wordmarkTracking = (fontSize: number): number => -0.02 * fontSize

/** Touch targets: 48 dp on Android. */
export const TARGET = 48
