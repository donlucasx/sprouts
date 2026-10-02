import { Text, View } from 'react-native'
import { FONT, spacing, useTheme, wordmarkTracking } from '@/theme'
import { Mark } from './Mark'

/** The wordmark alone: Outfit 600, lowercase, -0.02 em; 700 below 24 px (manual 3). */
export function Wordmark({ size = 28 }: { size?: number }) {
  const { colors } = useTheme()
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontFamily: size < 24 ? FONT.displayBold : FONT.display,
        fontSize: size,
        lineHeight: Math.round(size * 1.15),
        letterSpacing: wordmarkTracking(size),
        color: colors.text,
      }}
    >
      sprouts
    </Text>
  )
}

/** The stacked lockup (manual 3): the mark 2.3 x the word size above the word, a gap of 0.2 x, centred. Welcome's header. */
export function Lockup({ wordSize = 40 }: { wordSize?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: Math.round(0.2 * wordSize) }}>
      <Mark size={Math.round(2.3 * wordSize)} />
      <Wordmark size={wordSize} />
    </View>
  )
}

/** A screen header with the mark standing on the left of a title (manual 3: the mark on the left, 1.18 x the word size, a gap of 0.26 x). */
export function MarkedTitle({ children, size = 28 }: { children: string; size?: number }) {
  const { colors } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Math.round(0.26 * size) }}>
      <Mark size={Math.round(1.18 * size)} />
      <Text
        accessibilityRole="header"
        style={{
          fontFamily: FONT.display,
          fontSize: size,
          lineHeight: Math.round(size * 1.2),
          color: colors.text,
          flexShrink: 1,
          marginLeft: spacing.xs,
        }}
      >
        {children}
      </Text>
    </View>
  )
}
