import { View, type StyleProp, type ViewStyle } from 'react-native'
import type { PropsWithChildren } from 'react'
import { radius, spacing, useTheme } from '@/theme'

/** A cream tile on the paper ground (manual 4): rounded, padded, no border, no shadow. */
export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { colors } = useTheme()
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderCurve: 'continuous',
          padding: spacing.lg,
          gap: spacing.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}
