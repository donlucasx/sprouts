import { useEffect, useState } from 'react'
import { Image, View } from 'react-native'
import { spacing, useTheme } from '@/theme'
import { SPRITES } from '@/garden/sprites'
import { ThemedText } from './ThemedText'
import type { NextPlantingRow } from '@/lib/next-planting'
import type { CanRow } from '@/garden/Garden'
import { canRoomBelow, canSlot } from '@/model/can'

/** R169: the baked strokes' box height at 1x (both are the same box); the painted stroke inside is about 5.5 tall. */
const BAR_H = Math.ceil(Math.max(SPRITES['bar-track']?.h ?? 12, SPRITES['bar-fill']?.h ?? 12))
/** R199: the room this row keeps under its bar for the can's touch box (canRoomBelow at the baked bar's height), at can scale `s`.
 * Left of the can's slot that room is empty paper, so Home lays the one status line into it (WatcherLine's `tuck`) and the garden,
 * the bar, the line and the last planting read as one block. */
export const roomUnderBar = (s: number) => canRoomBelow(s, BAR_H)
/** The pale track on the dark ground: the Mint wash would glare at full strength there. */
const DARK_TRACK_OPACITY = 0.35

/**
 * Home's progress row (R164): the label left, the value right, a thin determinate bar under them. One element for a screen
 * reader; at the largest text the value wraps under the label. R169: the bar is painted, a pale Mint wash for the track and a Leaf
 * green wash stroke for the fill (baked by brand/garden/bake.py, stretched to the row). The fill shows its RIGHT end through a clip
 * as wide as the fraction, so the stroke's pooled, darker end always leads.
 * R186: with `can`, the row keeps a slot at its right for the watering can (drawn by the garden's overlay, not here): the label, the
 * value and the bar end before it, so the bar runs into the can, and the row keeps room under the bar for the can's touch box. It
 * reports where its bar's centre lies and its own height, so the can is seated on the bar.
 */
export function NextPlanting({ row, pendingCents, thresholdCents, can }: { row: NextPlantingRow; pendingCents: number; thresholdCents: number; can?: CanRow }) {
  const { dark } = useTheme()
  const [width, setWidth] = useState(0)
  const [barY, setBarY] = useState<number | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const report = can?.onLayout
  useEffect(() => {
    if (report && barY !== null && height !== null) report({ bar: barY + BAR_H / 2, height })
  }, [report, barY, height])
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
      style={{ gap: spacing.xs, paddingRight: can ? canSlot(can.s) : 0 }}
      onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: spacing.sm }}>
        <ThemedText tone="secondary">{row.label}</ThemedText>
        <ThemedText numeric>{row.value}</ThemedText>
      </View>
      <View
        style={{ height: BAR_H, marginBottom: can ? canRoomBelow(can.s, BAR_H) : 0 }}
        onLayout={(e) => {
          setWidth(e.nativeEvent.layout.width)
          setBarY(e.nativeEvent.layout.y)
        }}
      >
        {width > 0 && track ? stroke(track, dark ? DARK_TRACK_OPACITY : 1) : null}
        {width > 0 && fill ? (
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(row.fraction * 100)}%`, overflow: 'hidden' }}>
            {stroke(fill, row.state === 'paused' ? 0.35 : 1)}
          </View>
        ) : null}
      </View>
    </View>
  )
}
