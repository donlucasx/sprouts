import { View } from 'react-native'
import { radius, spacing, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'
import type { NextPlantingRow } from '@/lib/next-planting'

/**
 * Home's progress row (R164): the label left, the value right, a thin determinate bar under them. One element for a screen
 * reader; at the largest text the value wraps under the label.
 */
export function NextPlanting({ row, pendingCents, thresholdCents }: { row: NextPlantingRow; pendingCents: number; thresholdCents: number }) {
  const { colors } = useTheme()
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${row.label}, ${row.value}`}
      accessibilityValue={{ min: 0, max: thresholdCents, now: Math.min(pendingCents, thresholdCents) }}
      style={{ gap: spacing.xs }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: spacing.sm }}>
        <ThemedText tone="secondary">{row.label}</ThemedText>
        <ThemedText numeric>{row.value}</ThemedText>
      </View>
      <View style={{ height: 4, borderRadius: radius.full, backgroundColor: colors.surface, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(row.fraction * 100)}%`, height: 4, borderRadius: radius.full, backgroundColor: colors.accent }} />
      </View>
    </View>
  )
}
