import { Pressable, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { radius, spacing, TARGET, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

/** The two round buttons of a stepper, named for TalkBack after what they move ("Less hSOL", "More hSOL"). */
export function StepButtons({
  what,
  onLess,
  onMore,
  lessDisabled = false,
  moreDisabled = false,
}: {
  what: string
  onLess: () => void
  onMore: () => void
  lessDisabled?: boolean
  moreDisabled?: boolean
}) {
  const { colors } = useTheme()
  const one = (label: string, icon: 'minus' | 'plus', onPress: () => void, disabled: boolean) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={4}
      style={({ pressed }) => ({
        width: TARGET - spacing.xs,
        height: TARGET - spacing.xs,
        borderRadius: radius.full,
        borderWidth: 1.5,
        borderColor: disabled ? colors.hairline : colors.accent,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <MaterialCommunityIcons name={icon} size={20} color={disabled ? colors.hairline : colors.accentText} />
    </Pressable>
  )
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      {one(`Less ${what}`, 'minus', onLess, lessDisabled)}
      {one(`More ${what}`, 'plus', onMore, moreDisabled)}
    </View>
  )
}

/** A labelled value with its two buttons: the daily limit, the planting threshold (Rules). */
export function Stepper({
  label,
  value,
  step,
  min,
  max,
  format,
  onChange,
  disabled = false,
}: {
  label: string
  value: number
  step: number
  min: number
  max: number
  format: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
      <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
      <ThemedText numeric style={{ minWidth: 64, textAlign: 'center' }}>
        {format(value)}
      </ThemedText>
      <StepButtons
        what={label}
        onLess={() => onChange(Math.max(min, value - step))}
        onMore={() => onChange(Math.min(max, value + step))}
        lessDisabled={disabled || value <= min}
        moreDisabled={disabled || value >= max}
      />
    </View>
  )
}
