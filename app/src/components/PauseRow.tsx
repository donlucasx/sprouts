import { useState } from 'react'
import { Switch, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { radius, spacing, switchColors, useTheme } from '@/theme'
import { ThemedText } from './ThemedText'

/**
 * Sprouts' own switch (R147), at the top of Rules since 10-08 (R448): a dot, "Sprouts is on / paused", a native switch, and one
 * detail line under it (R455: this week's round-ups; paused: what that means). Off pauses every
 * linked wallet (nothing moves until it is turned back on); on asks the wallet once. The state comes from the wallets, never
 * from the tap, so the row always says what the puller will do.
 *
 * 10-27 (his notes): the switch moves at the tap and holds there while the answer is on its way, with a line saying so; a second tap
 * meanwhile does nothing (it used to read the old state and ask to turn Sprouts back on). Paused shows a pause mark, not the brown dot.
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
  // the tapped position, held until the answer lands (then `on`, from the wallets, says what happened; a failure snaps back)
  const [target, setTarget] = useState<boolean | null>(null)
  const [wasBusy, setWasBusy] = useState(busy)
  if (wasBusy !== busy) {
    setWasBusy(busy)
    if (!busy) setTarget(null)
  }
  const shown = target ?? on
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        {on ? (
          <View style={{ width: 10, height: 10, borderRadius: radius.full, backgroundColor: colors.success }} />
        ) : (
          <MaterialCommunityIcons name="pause-circle" size={16} color={colors.textSecondary} />
        )}
        <ThemedText variant="heading" style={{ flex: 1 }}>
          {line}
        </ThemedText>
        <Switch
          {...switchColors(colors)}
          value={shown}
          disabled={busy}
          onValueChange={(v) => {
            if (busy || target !== null) return
            setTarget(v)
            onChange(v)
          }}
          accessibilityLabel={line}
          accessibilityState={{ busy }}
        />
      </View>
      {detail ? (
        <ThemedText variant="caption" tone="secondary">
          {detail}
        </ThemedText>
      ) : null}
      {busy ? (
        <ThemedText variant="caption" tone="secondary">
          {shown ? 'Waiting for your wallet.' : 'Pausing.'}
        </ThemedText>
      ) : null}
      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
    </View>
  )
}
