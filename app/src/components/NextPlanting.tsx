import { useState } from 'react'
import { Image, View } from 'react-native'
import { spacing, useTheme } from '@/theme'
import { SPRITES } from '@/garden/sprites'
import { ThemedText } from './ThemedText'
import type { NextPlantingRow } from '@/lib/next-planting'

/** R169: the baked strokes' box height at 1x (both are the same box); the painted stroke inside is about 5.5 tall. */
const BAR_H = Math.ceil(Math.max(SPRITES['bar-track']?.h ?? 12, SPRITES['bar-fill']?.h ?? 12))
/** The pale track on the dark ground: the Mint wash would glare at full strength there. */
const DARK_TRACK_OPACITY = 0.35

/**
 * Home's progress row (R164): the label left, the value right, a thin determinate bar under them. One element for a screen
 * reader; at the largest text the value wraps under the label. R169: the bar is painted, a pale Mint wash for the track and a Leaf
 * green wash stroke for the fill (baked by brand/garden/bake.py, stretched to the row). The fill shows its RIGHT end through a clip
 * as wide as the fraction, so the stroke's pooled, darker end always leads.
 */
export function NextPlanting({ row, pendingCents, thresholdCents }: { row: NextPlantingRow; pendingCents: number; thresholdCents: number }) {
  const { dark } = useTheme()
  const [width, setWidth] = useState(0)
  const track = SPRITES['bar-track'], fill = SPRITES['bar-fill']
  const stroke = (m: NonNullable<typeof track>, opacity = 1) => (
    <Image source={m.src} resizeMode="stretch" style={{ position: 'absolute', right: 0, top: BAR_H / 2 - m.ay, width, height: m.h, opacity }} />
  )
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
      <View style={{ height: BAR_H }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && track ? stroke(track, dark ? DARK_TRACK_OPACITY : 1) : null}
        {width > 0 && fill ? (
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(row.fraction * 100)}%`, overflow: 'hidden' }}>
            {stroke(fill)}
          </View>
        ) : null}
      </View>
    </View>
  )
}
