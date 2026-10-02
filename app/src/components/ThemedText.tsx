import { Text, type TextProps } from 'react-native'
import { type as ramp, useTheme, type Palette } from '@/theme'

export type Variant = keyof typeof ramp
export type Tone = 'text' | 'secondary' | 'accent' | 'accentText' | 'onAccent' | 'success' | 'attention' | 'error'

const toneKey: Record<Tone, keyof Palette> = {
  text: 'text',
  secondary: 'textSecondary',
  accent: 'accent',
  accentText: 'accentText',
  onAccent: 'onAccent',
  success: 'success',
  attention: 'attention',
  error: 'error',
}

/** Every piece of text: one of the manual's six steps, in one of the palette's tones. `numeric` sets tabular figures for amounts. */
export function ThemedText({
  variant = 'body',
  tone = 'text',
  numeric = false,
  style,
  ...props
}: TextProps & { variant?: Variant; tone?: Tone; numeric?: boolean }) {
  const { colors } = useTheme()
  return (
    <Text
      style={[
        ramp[variant],
        { color: colors[toneKey[tone]] },
        numeric ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
      {...props}
    />
  )
}
