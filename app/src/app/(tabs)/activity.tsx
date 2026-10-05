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
import { SPLIT_SECTION } from '@/model/manager'
import { foundRow, FOUND_SECTION, lendWithdrawalRow, moveRow, plantingRow, splitRow, swapRow, visibleRows, withdrawalRow, WITHDRAWN_LINE, type ActivityRow } from '@/model/activity'
import { undoSplit } from '@/lib/manager-api'
import { spacing, TARGET, useTheme } from '@/theme'

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** R284: one plain line; a tap opens its details and its transaction on Solscan (a wallet-started withdrawal not yet delivered: the wallet, R165). */
function Row({ row, accountPubkey, right }: { row: ActivityRow; accountPubkey?: string | null; right?: ReactNode }) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const link = row.signature
    ? { url: `https://solscan.io/tx/${row.signature}`, label: 'Open on Solscan' }
    : accountPubkey
      ? { url: `https://solscan.io/account/${accountPubkey}`, label: 'Open your wallet on Solscan' }
      : null
  const opens = row.details.length > 0 || link !== null
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Pressable
          disabled={!opens}
          onPress={() => setOpen((o) => !o)}
          accessibilityRole={opens ? 'button' : 'text'}
          accessibilityState={opens ? { expanded: open } : undefined}
          style={({ pressed }) => ({ flex: 1, minHeight: TARGET - spacing.xs, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, opacity: pressed ? 0.6 : 1 })}
        >
          <ThemedText style={{ flex: 1 }}>{row.line}</ThemedText>
          {opens ? <MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} /> : null}
        </Pressable>
        {right}
      </View>
      {open ? (
        <View style={{ gap: 2, paddingBottom: spacing.sm }}>
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

/** One section: the heading, its one-line explainer, the latest five rows, and "Show N more" when more wait (his note 6). */
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
  const plantings = a ? a.plantings.flatMap((p) => { const r = plantingRow(day(p.ts), p); return r ? [r] : [] }) : []
  const withdrawals = a
    ? [
        ...a.withdrawals.map((w) => ({ ts: w.ts, row: withdrawalRow(day(w.ts), w, skrUsd, me?.basket?.id === w.id ? me.basket.readyAt : undefined), wallet: true })),
        ...(a.lendWithdrawals ?? []).map((w) => ({ ts: w.ts, row: lendWithdrawalRow(day(w.ts), w), wallet: false })),
      ].sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0))
    : []
  const moves = a?.moves ? a.moves.flatMap((m) => { const r = moveRow(day(m.ts), m); return r ? [r] : [] }) : []
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
          <Section title="Plantings" sub="Each time your change was planted." rows={plantings} empty="No planting yet." render={(r) => <Row key={r.key} row={r} />} />
          <Section
            title={SPLIT_SECTION.title}
            sub={SPLIT_SECTION.sub}
            rows={a.splits}
            empty={SPLIT_SECTION.empty}
            render={(s, i) => (
              <Fragment key={`${s.ts}-${i}`}>
                <Row row={splitRow(s, i)} right={i === 0 && s.by === 'manager' && me?.manager.undoAvailable ? <Button title="Undo" kind="quiet" loading={busy} onPress={undo} /> : null} />
                {i === 0 && undoError ? <ThemedText tone="error">{undoError}</ThemedText> : null}
              </Fragment>
            )}
          />
          <Section title="Swaps" sub="Each swap and the change it set aside." rows={a.swaps} empty="No swap seen yet." render={(s) => <Row key={s.signature} row={swapRow(day(s.ts), s)} />} />
          <Section title="Withdrawals" sub={WITHDRAWN_LINE} rows={withdrawals} empty="No withdrawal yet." render={(w) => <Row key={w.row.key} row={w.row} accountPubkey={w.wallet ? me?.user.pubkey : null} />} />
          {moves.length > 0 ? <Section title="Moves" sub="Moves between lending venues you were asked about." rows={moves} empty="" render={(r) => <Row key={r.key} row={r} />} /> : null}
          {found.length > 0 ? <Section title={FOUND_SECTION.title} sub={FOUND_SECTION.sub} rows={found} empty="" render={(r) => <Row key={r.key} row={r} />} /> : null}
        </>
      ) : null}
    </Screen>
  )
}
