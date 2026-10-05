import { Fragment, useState, type ReactNode } from 'react'
import { Linking, Pressable, RefreshControl, useWindowDimensions, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { api, ApiError, type ActivityResponse } from '@/lib/api'
import { useMe, useInvalidateMe, useApplyRules } from '@/lib/me'
import { SPLIT_SECTION } from '@/model/manager'
import { foundRow, FOUND_SECTION, groupByDay, lendWithdrawalRow, moveRow, plantingRow, rowTime, spokenLabel, splitRow, swapRow, visibleRows, withdrawalRow, WITHDRAWN_LINE, type ActivityRow } from '@/model/activity'
import { undoSplit } from '@/lib/manager-api'
import { spacing, TARGET, useTheme } from '@/theme'

/** R362: the time column fits "11:13 AM" in the label step (47 dp measured); it grows with the phone's font scale so the time never cuts. */
const TIME_WIDTH = 52

/**
 * R362: ONE line (time, a short label, the amount on the right); a tap opens its details and its transaction on Solscan (a
 * wallet-started withdrawal not yet delivered: the wallet, R165). TalkBack hears the full date, since the day is in the header.
 */
function Row({ row, accountPubkey, right }: { row: ActivityRow; accountPubkey?: string | null; right?: ReactNode }) {
  const { colors } = useTheme()
  const { fontScale } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const link = row.signature
    ? { url: `https://solscan.io/tx/${row.signature}`, label: 'Open on Solscan' }
    : accountPubkey
      ? { url: `https://solscan.io/account/${accountPubkey}`, label: 'Open your wallet on Solscan' }
      : null
  const opens = row.details.length > 0 || link !== null
  const timeWidth = TIME_WIDTH * Math.max(1, fontScale)
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Pressable
          disabled={!opens}
          onPress={() => setOpen((o) => !o)}
          accessibilityRole={opens ? 'button' : 'text'}
          accessibilityLabel={spokenLabel(row)}
          accessibilityState={opens ? { expanded: open } : undefined}
          style={({ pressed }) => ({ flex: 1, minHeight: TARGET - spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, opacity: pressed ? 0.6 : 1 })}
        >
          <ThemedText variant="label" tone="secondary" numeric numberOfLines={1} style={{ width: timeWidth, textAlign: 'right' }}>
            {rowTime(row.ts)}
          </ThemedText>
          <ThemedText variant="label" numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1 }}>
            {row.label}
          </ThemedText>
          {row.amount ? (
            <ThemedText variant="label" numeric numberOfLines={1}>
              {row.amount}
            </ThemedText>
          ) : null}
          {opens ? <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} /> : null}
        </Pressable>
        {right}
      </View>
      {open ? (
        <View style={{ gap: 2, paddingBottom: spacing.sm, paddingLeft: timeWidth + spacing.sm }}>
          {row.details.map((d, i) => (
            <ThemedText key={i} variant="caption" tone="secondary">
              {d}
            </ThemedText>
          ))}
          {link ? (
            <Pressable
              onPress={() => Linking.openURL(link.url)}
              accessibilityRole="link"
              accessibilityLabel={link.label}
              hitSlop={8}
              style={({ pressed }) => ({ minHeight: TARGET - spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, opacity: pressed ? 0.6 : 1 })}
            >
              <ThemedText variant="label" tone="accentText">
                Solscan
              </ThemedText>
              <MaterialCommunityIcons name="open-in-new" size={14} color={colors.accentText} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/**
 * One section: the heading, its one-line explainer, the latest five rows under their day headers (R362), and "Show N more" when
 * more wait (his note 6; it counts rows, not headers). `render` gets each row with its index in the whole section.
 */
function Section({ title, sub, rows, empty, render }: { title: string; sub: string; rows: ActivityRow[]; empty: string; render?: (row: ActivityRow, i: number) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const { shown, hidden } = visibleRows(rows, open)
  let i = 0
  return (
    <Card>
      <ThemedText variant="heading">{title}</ThemedText>
      <ThemedText variant="caption" tone="secondary">
        {sub}
      </ThemedText>
      {rows.length === 0 ? <ThemedText tone="secondary">{empty}</ThemedText> : null}
      {groupByDay(shown).map((day) => (
        <View key={day.key}>
          <ThemedText variant="caption" tone="secondary" accessibilityRole="header" style={{ textTransform: 'uppercase', letterSpacing: 0.6, paddingTop: spacing.xs }}>
            {day.header}
          </ThemedText>
          {day.rows.map((r) => {
            const at = i++
            return render ? <Fragment key={r.key}>{render(r, at)}</Fragment> : <Row key={r.key} row={r} />
          })}
        </View>
      ))}
      {hidden > 0 ? <Button title={`Show ${hidden} more`} kind="quiet" onPress={() => setOpen(true)} style={{ alignSelf: 'flex-start' }} /> : null}
    </Card>
  )
}

/** Every planting, split change, swap, withdrawal, move and found venue of the signed-in Seeker, newest first, one line each. */
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
      applyRules(answer, { managed: false, undoAvailable: false, changedDay: null })
      void invalidate()
      await q.refetch()
    } catch (e) {
      setUndoError(e instanceof ApiError ? e.message : 'Could not undo. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const plantings = a ? a.plantings.flatMap((p) => { const r = plantingRow(p); return r ? [r] : [] }) : []
  const splits = a ? a.splits.map(splitRow) : []
  const swaps = a ? a.swaps.map(swapRow) : []
  const withdrawals = a
    ? [
        ...a.withdrawals.map((w) => ({ row: withdrawalRow(w, skrUsd, me?.basket?.id === w.id ? me.basket.readyAt : undefined), wallet: true })),
        ...(a.lendWithdrawals ?? []).map((w) => ({ row: lendWithdrawalRow(w), wallet: false })),
      ].sort((x, y) => (x.row.ts < y.row.ts ? 1 : x.row.ts > y.row.ts ? -1 : 0))
    : []
  const walletRows = new Set(withdrawals.filter((w) => w.wallet).map((w) => w.row.key))
  const moves = a?.moves ? a.moves.flatMap((m) => { const r = moveRow(m); return r ? [r] : [] }) : []
  const found = a?.found ? a.found.map(foundRow) : []
  return (
    <Screen
      inset="top"
      title="Activity"
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} colors={[colors.accent]} progressBackgroundColor={colors.surface} tintColor={colors.accent} />}
    >
      {!a ? (
        <ThemedText tone="secondary">{q.isError ? 'Could not load your activity just now. Pull down to try again.' : 'Loading your activity.'}</ThemedText>
      ) : null}
      {a ? (
        <>
          <Section title="Plantings" sub="Each time your change was planted." rows={plantings} empty="No planting yet." />
          <Section
            title={SPLIT_SECTION.title}
            sub={SPLIT_SECTION.sub}
            rows={splits}
            empty={SPLIT_SECTION.empty}
            render={(r, i) => {
              const undoable = i === 0 && a.splits[0]?.by === 'manager' && me?.manager.undoAvailable
              return (
                <>
                  <Row row={r} right={undoable ? <Button title="Undo" kind="quiet" loading={busy} onPress={undo} style={{ paddingHorizontal: spacing.sm }} /> : null} />
                  {i === 0 && undoError ? <ThemedText tone="error">{undoError}</ThemedText> : null}
                </>
              )
            }}
          />
          <Section title="Swaps" sub="Each swap and the change it set aside." rows={swaps} empty="No swap seen yet." />
          <Section title="Withdrawals" sub={WITHDRAWN_LINE} rows={withdrawals.map((w) => w.row)} empty="No withdrawal yet." render={(r) => <Row row={r} accountPubkey={walletRows.has(r.key) ? me?.user.pubkey : null} />} />
          {moves.length > 0 ? <Section title="Moves" sub="Moves between lending venues you were asked about." rows={moves} empty="" /> : null}
          {found.length > 0 ? <Section title={FOUND_SECTION.title} sub={FOUND_SECTION.sub} rows={found} empty="" /> : null}
        </>
      ) : null}
    </Screen>
  )
}
