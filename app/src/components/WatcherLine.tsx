import { View } from 'react-native'
import { spacing } from '@/theme'
import { ThemedText } from './ThemedText'

/**
 * The one line beside the garden (spec 6): under 25 words, spoken as Sprouts.
 * R199 (device check 2, his note: the line "should be smaller"): Caption in the secondary ink, the same step as the Last planting row
 * under it, so the two read as the garden section's small print rather than running text.
 * `tuck` (R199): the Next planting row keeps `room` px under its bar for the can's touch box, empty paper left of the can's `slot`. The
 * line climbs into it, starting a small step under the bar, and keeps clear of the can by ending `slot` px before the right edge. It
 * stays in the layout's flow, so a line taller than the room (the largest text) pushes what follows down instead of overlapping it.
 * The line takes no touches, so lying under the can's box-none overlay costs nothing.
 */
export function WatcherLine({ text, tuck }: { text: string; tuck?: { room: number; slot: number } }) {
  return (
    <View style={tuck ? { marginTop: -Math.max(0, tuck.room - spacing.sm), paddingRight: tuck.slot } : null}>
      <ThemedText variant="caption" tone="secondary">
        {text}
      </ThemedText>
    </View>
  )
}
