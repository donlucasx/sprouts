import { useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { api, ApiError, type ActivityResponse } from '@/lib/api'
import { useMe, useInvalidateMe, useApplyRules } from '@/lib/me'
import { splitRowLine, SPLIT_SECTION } from '@/model/manager'
import { plantingRowLine, swapRowLine, withdrawalRowLine } from '@/model/activity'
import { undoSplit } from '@/lib/manager-api'
import { spacing, TARGET, useTheme } from '@/theme'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const solscan = (sig: string) => Linking.openURL(`https://solscan.io/tx/${sig}`)

/** One row: its text, and the transaction on Solscan as a real target. */
function Line({ text, signature }: { text: string; signature?: string | null }) {
  const { colors } = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
      <ThemedText style={{ flex: 1 }}>{text}</ThemedText>
      {signature ? (
        <Pressable
          onPress={() => solscan(signature)}
          accessibilityRole="link"
          accessibilityLabel="Open on Solscan"
          hitSlop={8}
          style={({ pressed }) => ({
            minHeight: TARGET - spacing.xs,
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ThemedText variant="label" tone="accentText">
            Solscan
          </ThemedText>
          <MaterialCommunityIcons name="open-in-new" size={14} color={colors.accentText} />
        </Pressable>
      ) : null}
    </View>
  )
}

/** Every planting, split change, swap and withdrawal of the signed-in Seeker, newest first. */
export default function Activity() {
  const { data: me } = useMe()
  const skrUsd = me?.pot.skrUsd ?? null
  const q = useQuery({ queryKey: ['activity'], queryFn: () => api<ActivityResponse>('/api/activity') })
  const a = q.data
  const invalidate = useInvalidateMe()
  const applyRules = useApplyRules()
  const [busy, setBusy] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)

  async function undo() {
    setBusy(true)
    setUndoError(null)
    try {
      const answer = await undoSplit()
      // The answer lands on the cached read at once; the rows refresh before the button settles.
      applyRules(answer, { managed: false, undoAvailable: false, changedDay: null })
      void invalidate()
      await q.refetch()
    } catch (e) {
      setUndoError(e instanceof ApiError ? e.message : 'Could not undo. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Screen inset="top" title="Activity">
      {!a ? (
        <ThemedText tone="secondary">
          {q.isError ? 'Could not load your activity just now. Pull down to try again.' : 'Loading your activity.'}
        </ThemedText>
      ) : null}
      {a ? (
        <>
          <Card>
            <ThemedText variant="heading">Plantings</ThemedText>
            {a.plantings.length === 0 ? <ThemedText tone="secondary">No planting yet.</ThemedText> : null}
            {a.plantings.map((p) => (
              <Line key={p.id} text={plantingRowLine(day(p.ts), p)} signature={p.signature} />
            ))}
          </Card>
          <Card>
            <ThemedText variant="heading">{SPLIT_SECTION.title}</ThemedText>
            <ThemedText variant="caption" tone="secondary">
              {SPLIT_SECTION.sub}
            </ThemedText>
            {a.splits.length === 0 ? <ThemedText tone="secondary">{SPLIT_SECTION.empty}</ThemedText> : null}
            {a.splits.map((s, i) => (
              <View
                key={`${s.ts}-${i}`}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}
              >
                <ThemedText style={{ flex: 1 }}>{splitRowLine(s)}</ThemedText>
                {i === 0 && s.by === 'manager' && me?.manager.undoAvailable ? (
                  <Button title="Undo" kind="quiet" loading={busy} onPress={undo} />
                ) : null}
              </View>
            ))}
            {undoError ? <ThemedText tone="error">{undoError}</ThemedText> : null}
          </Card>
          <Card>
            <ThemedText variant="heading">Swaps</ThemedText>
            <ThemedText variant="caption" tone="secondary">
              Each swap and the change it set aside.
            </ThemedText>
            {a.swaps.length === 0 ? <ThemedText tone="secondary">No swap seen yet.</ThemedText> : null}
            {a.swaps.map((s) => (
              <Line key={s.signature} text={swapRowLine(day(s.ts), s)} signature={s.signature} />
            ))}
          </Card>
          <Card>
            <ThemedText variant="heading">Withdrawals</ThemedText>
            {a.withdrawals.length === 0 ? <ThemedText tone="secondary">No withdrawal yet.</ThemedText> : null}
            {a.withdrawals.map((w) => (
              <Line
                key={w.id}
                text={withdrawalRowLine(day(w.ts), w, skrUsd)}
                signature={w.withdrawSignature ?? w.unstakeSignature}
              />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  )
}
