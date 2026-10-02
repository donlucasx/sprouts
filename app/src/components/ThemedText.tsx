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

/** The three Outfit steps are headings to a screen reader unless the caller says otherwise. */
const HEADER: Partial<Record<Variant, true>> = { display: true, title: true, heading: true }

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
      accessibilityRole={HEADER[variant] ? 'header' : undefined}
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
