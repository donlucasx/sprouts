import { Fragment, useState, type ReactNode } from 'react'
import { Linking, Pressable, RefreshControl, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { api, ApiError, type ActivityResponse } from '@/lib/api'
import { useMe, useInvalidateMe, useApplyRules } from '@/lib/me'
import { splitRowLine, SPLIT_SECTION } from '@/model/manager'
import { plantingRowLine, swapRowLine, withdrawalRowLine, visibleRows, WITHDRAWN_LINE } from '@/model/activity'
import { undoSplit } from '@/lib/manager-api'
import { spacing, TARGET, useTheme } from '@/theme'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const solscan = (sig: string) => Linking.openURL(`https://solscan.io/tx/${sig}`)
const solscanAccount = (pubkey: string) => Linking.openURL(`https://solscan.io/account/${pubkey}`)

/** One row: its text, and the transaction on Solscan as a real target. A row with no signature (a wallet-started withdrawal not yet delivered) links the user's wallet account instead (R165). */
function Line({ text, signature, accountPubkey }: { text: string; signature?: string | null; accountPubkey?: string | null }) {
  const { colors } = useTheme()
  const link = signature
    ? { open: () => solscan(signature), label: 'Open on Solscan' }
    : accountPubkey
      ? { open: () => solscanAccount(accountPubkey), label: 'Open your wallet on Solscan' }
      : null
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm }}>
      <ThemedText style={{ flex: 1 }}>{text}</ThemedText>
      {link ? (
        <Pressable
          onPress={link.open}
          accessibilityRole="link"
          accessibilityLabel={link.label}
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

/** One section: the heading, its one-line explainer, the latest five rows, and "Show N more" when more wait (his note 6; "more", not "all", since the API caps at fifty). */
function Section<T>({ title, sub, rows, empty, render }: { title: string; sub: string; rows: T[]; empty: string; render: (row: T, i: number) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const { shown, hidden } = visibleRows(rows, open)
  return (
    <Card>
      <ThemedText variant="heading">{title}</ThemedText>
      <ThemedText variant="caption" tone="secondary">
        {sub}
      </ThemedText>
      {rows.length === 0 ? <ThemedText tone="secondary">{empty}</ThemedText> : null}
      {shown.map(render)}
      {hidden > 0 ? <Button title={`Show ${hidden} more`} kind="quiet" onPress={() => setOpen(true)} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  )
}

/** Every planting, split change, swap and withdrawal of the signed-in Seeker, newest first. */
export default function Activity() {
  const { data: me } = useMe()
  const { colors } = useTheme()
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
    <Screen
      inset="top"
      title="Activity"
      refreshControl={
        <RefreshControl
          refreshing={q.isRefetching}
          onRefresh={() => q.refetch()}
          colors={[colors.accent]}
          progressBackgroundColor={colors.surface}
          tintColor={colors.accent}
        />
      }
    >
      {!a ? (
        <ThemedText tone="secondary">
          {q.isError ? 'Could not load your activity just now. Pull down to try again.' : 'Loading your activity.'}
        </ThemedText>
      ) : null}
      {a ? (
        <>
          {/* R94: one plain line under each section title saying what it lists. */}
          <Section
            title="Plantings"
            sub="Each time your change became a coin in your garden."
            rows={a.plantings}
            empty="No planting yet."
            render={(p) => <Line key={p.id} text={plantingRowLine(day(p.ts), p)} signature={p.signature} />}
          />
          <Section
            title={SPLIT_SECTION.title}
            sub={SPLIT_SECTION.sub}
            rows={a.splits}
            empty={SPLIT_SECTION.empty}
            render={(s, i) => (
              <Fragment key={`${s.ts}-${i}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                  <ThemedText style={{ flex: 1 }}>{splitRowLine(s)}</ThemedText>
                  {i === 0 && s.by === 'manager' && me?.manager.undoAvailable ? (
                    <Button title="Undo" kind="quiet" loading={busy} onPress={undo} />
                  ) : null}
                </View>
                {i === 0 && undoError ? <ThemedText tone="error">{undoError}</ThemedText> : null}
              </Fragment>
            )}
          />
          <Section
            title="Swaps"
            sub="Each swap and the change it set aside."
            rows={a.swaps}
            empty="No swap seen yet."
            render={(s) => <Line key={s.signature} text={swapRowLine(day(s.ts), s)} signature={s.signature} />}
          />
          <Section
            title="Withdrawals"
            sub={WITHDRAWN_LINE}
            rows={a.withdrawals}
            empty="No withdrawal yet."
            render={(w) => (
              <Line key={w.id} text={withdrawalRowLine(day(w.ts), w, skrUsd, me?.basket?.id === w.id ? me.basket.readyAt : undefined)} signature={w.withdrawSignature ?? w.unstakeSignature} accountPubkey={me?.user.pubkey} />
            )}
          />
        </>
      ) : null}
    </Screen>
  )
}
