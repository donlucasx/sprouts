import { Switch, View } from 'react-native'
import { radius, spacing, switchColors, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

/**
 * Sprouts' own switch on Home (R147): one row under the title, a dot, the state in a line, a native switch. Off pauses every
 * linked wallet (nothing moves until it is turned back on); on asks the Seeker once. The state comes from the wallets, never
 * from the tap, so the row always says what the puller will do.
 */
export function PauseRow({
  on,
  line,
  busy,
  error,
  onChange,
}: {
  on: boolean
  line: string
  busy: boolean
  error: string | null
  onChange: (on: boolean) => void
}) {
  const { colors } = useTheme()
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: radius.full,
            backgroundColor: on ? colors.success : colors.attention,
          }}
        />
        <ThemedText style={{ flex: 1 }}>{line}</ThemedText>
        <Switch
          {...switchColors(colors)}
          value={on}
          disabled={busy}
          onValueChange={onChange}
          accessibilityLabel="Sprouts on"
          accessibilityState={{ busy }}
        />
      </View>
      {busy && !on ? (
        <ThemedText variant="caption" tone="secondary">
          Waiting for your Seeker.
        </ThemedText>
      ) : null}
      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
    </View>
  )
}
