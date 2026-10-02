import { Pressable, View } from 'react-native'
import { radius, spacing, TARGET, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

/** Two or three options in one outlined bar, the chosen one filled, so each reads as a choice (09-29: a filled button beside plain text did not). */
export function TwoWay<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  const { colors } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        borderWidth: 1.5,
        borderColor: colors.accent,
        borderRadius: radius.md,
        borderCurve: 'continuous',
        overflow: 'hidden',
      }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: TARGET - spacing.xs,
              paddingVertical: spacing.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? colors.accent : 'transparent',
              opacity: pressed && !on ? 0.7 : 1,
            })}
          >
            <ThemedText variant="label" style={{ color: on ? colors.onAccent : colors.accentText }}>
              {o.label}
            </ThemedText>
          </Pressable>
        )
      })}
    </View>
  )
}
