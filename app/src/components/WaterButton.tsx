import { useEffect } from 'react'
import { Pressable } from 'react-native'
import Svg from 'react-native-svg'
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated'
import { WateringCan } from '@/garden/parts'
import { radius, spacing, TARGET, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

/**
 * The can as a button (audits/watering-ux, findings 2 and 4): a 48 dp pill with a green outline, the glyph and a word, on its own
 * row; Home shows it only while a bud waits (R96). While the request runs the word says "Watering..." and the can tilts to pour.
 */
export function WaterButton({
  label,
  busy,
  onPress,
}: {
  label: 'Water' | 'Watering...'
  busy: boolean
  onPress: () => void
}) {
  const { colors } = useTheme()
  const tilt = useSharedValue(0)
  useEffect(() => {
    // The can sprite's spout faces LEFT (toward the garden above), so pouring tips it counter-clockwise
    tilt.value = withTiming(busy ? -24 : 0, { duration: 350, easing: Easing.out(Easing.cubic) })
  }, [busy, tilt])
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }))
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Water the garden"
      accessibilityState={{ busy }}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        height: TARGET,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.full,
        borderWidth: 1.5,
        borderColor: colors.accent,
        backgroundColor: colors.background,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Animated.View style={[{ width: 27, height: 18 }, style]}>
        <Svg width={27} height={18} viewBox="-1 -2 36 24">
          <WateringCan />
        </Svg>
      </Animated.View>
      <ThemedText variant="button" tone="accentText">
        {label}
      </ThemedText>
    </Pressable>
  )
}
