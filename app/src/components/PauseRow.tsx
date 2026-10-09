import { Switch, View } from 'react-native'
import { radius, spacing, switchColors, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

/**
 * Sprouts' own switch (R147), at the top of Rules since 10-08 (R448): a dot, "Sprouts is on / paused", a native switch, and one
 * detail line under it (R455: this week's round-ups; paused: what that means). Off pauses every
 * linked wallet (nothing moves until it is turned back on); on asks the wallet once. The state comes from the wallets, never
 * from the tap, so the row always says what the puller will do.
 */
export function PauseRow({
  on,
  line,
  detail,
  busy,
  error,
  onChange,
}: {
  on: boolean
  line: string
  detail?: string | null
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
        <ThemedText variant="heading" style={{ flex: 1 }}>
          {line}
        </ThemedText>
        <Switch
          {...switchColors(colors)}
          value={on}
          disabled={busy}
          onValueChange={onChange}
          accessibilityLabel="Sprouts on"
          accessibilityState={{ busy }}
        />
      </View>
      {detail ? (
        <ThemedText variant="caption" tone="secondary">
          {detail}
        </ThemedText>
      ) : null}
      {busy && !on ? (
        <ThemedText variant="caption" tone="secondary">
          Waiting for your wallet.
        </ThemedText>
      ) : null}
      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
    </View>
  )
}
