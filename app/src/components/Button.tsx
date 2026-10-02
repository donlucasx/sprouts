import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native'
import { radius, spacing, TARGET, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

export type ButtonKind = 'primary' | 'quiet' | 'danger'

/**
 * The one button. Primary is Sprout green with paper text; quiet is text only in Deep green; danger is the brick. A pressed button
 * dims, a loading one shows a spinner beside its label and keeps its name for TalkBack, a disabled one blocks the press.
 * `style` merges last so a caller can place it (alignment, width), never recolour it.
 */
export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled = false,
  loading = false,
  style,
}: {
  title: string
  onPress: () => void
  kind?: ButtonKind
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useTheme()
  const off = disabled || loading
  const filled = kind !== 'quiet'
  const background = !filled
    ? 'transparent'
    : disabled
      ? colors.disabled
      : kind === 'danger'
        ? colors.error
        : colors.accent
  const foreground = !filled ? colors.accentText : disabled ? colors.disabledText : colors.onAccent
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: off, busy: loading }}
      disabled={off}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        {
          backgroundColor: background,
          minHeight: TARGET,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          borderCurve: 'continuous',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          opacity: pressed ? 0.7 : disabled && !filled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={foreground} /> : null}
      <ThemedText variant="label" style={{ color: foreground }}>
        {title}
      </ThemedText>
    </Pressable>
  )
}
