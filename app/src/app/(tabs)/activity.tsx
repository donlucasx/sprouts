import { useState, type ReactNode } from 'react'
import { Linking, Pressable, RefreshControl, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { SigninSprout } from '@/components/SigninSprout'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { ApiError } from '@/lib/api'
import { useMe, useInvalidateMe, useApplyRules } from '@/lib/me'
import { coinColor } from '@/lib/coin-colors'
import { activityQuery } from '@/lib/activity-query'
import { filterRows, foundRow, groupByDay, KIND_FILTERS, KIND_TAG, lendWithdrawalRow, mergeRows, moveRow, plantingRow, rowTime, spokenLabel, splitRow, swapRow, visibleRows, withdrawalRow, type ActivityKind, type ActivityRow } from '@/model/activity'
import { undoSplit } from '@/lib/manager-api'
import { radius, spacing, TARGET, useTheme } from '@/theme'

/** R450: the type tag's colour per kind (plantings take the coin green; lending tones for moves and finds). */
const KIND_COLOR: Record<ActivityKind, string> = {
  plant: coinColor('SKR'),
  swap: '#7A6248',
  withdraw: '#9E4B3F',
  split: coinColor('SOL_LEND'),
  move: coinColor('USDC_LEND'),
  found: '#6E6A64',
}

/**
 * R362: ONE line (time, a short label, the amount on the right); a tap opens its details and its transaction on Solscan (a
 * wallet-started withdrawal not yet delivered: the wallet, R165). TalkBack hears the full date, since the day is in the header.
 */
function Row({ row, kind, accountPubkey, right }: { row: ActivityRow; kind: ActivityKind; accountPubkey?: string | null; right?: ReactNode }) {
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
          accessibilityLabel={spokenLabel(row)}
          accessibilityState={opens ? { expanded: open } : undefined}
          style={({ pressed }) => ({ flex: 1, minHeight: TARGET - spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ width: 26, height: 26, borderRadius: radius.sm, backgroundColor: KIND_COLOR[kind], alignItems: 'center', justifyContent: 'center' }}>
            <ThemedText variant="caption" style={{ color: '#FFFFFF', fontWeight: '700' }}>
              {KIND_TAG[kind]}
            </ThemedText>
          </View>
          <View style={{ flex: 1 }}>
            <ThemedText variant="label" numberOfLines={1} ellipsizeMode="tail">
              {row.label}
            </ThemedText>
            <ThemedText variant="caption" tone="secondary" numeric numberOfLines={1}>
              {rowTime(row.ts)}
            </ThemedText>
          </View>
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
        <View style={{ gap: 2, paddingBottom: spacing.sm, paddingLeft: 26 + spacing.sm }}>
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

/** Every planting, split change, swap, withdrawal, move and found venue of the signed-in Seeker, newest first, one line each. */
export default function Activity() {
  const { data: me } = useMe()
  const { colors } = useTheme()
  const skrUsd = me?.pot.skrUsd ?? null
  const q = useQuery(activityQuery)
  const a = q.data
  const invalidate = useInvalidateMe()
  const applyRules = useApplyRules()
  const [busy, setBusy] = useState(false)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | ActivityKind>('all')
  const [more, setMore] = useState(false)

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
  const plantings = a ? a.plantings.flatMap((p) => { const r = plantingRow(p); return r ? [{ row: r }] : [] }) : []
  const splits = a ? a.splits.map((x, i) => ({ row: splitRow(x, i) })) : []
  const swaps = a ? a.swaps.map((x) => ({ row: swapRow(x) })) : []
  const withdrawals = a
    ? [
        ...a.withdrawals.map((w) => ({ row: withdrawalRow(w, skrUsd, me?.basket?.id === w.id ? me.basket.readyAt : undefined), walletAccount: true })),
        ...(a.lendWithdrawals ?? []).map((w) => ({ row: lendWithdrawalRow(w), walletAccount: false })),
      ]
    : []
  const moves = a?.moves ? a.moves.flatMap((m) => { const r = moveRow(m); return r ? [{ row: r }] : [] }) : []
  const found = a?.found ? a.found.map((f) => ({ row: foundRow(f) })) : []
  const all = mergeRows({ plant: plantings, split: splits, swap: swaps, withdraw: withdrawals, move: moves, found })
  const rows = filterRows(all, filter)
  const { shown, hidden } = visibleRows(rows, more, 25)
  // The undo sits on the newest split row when the manager made it (as before, now in the one list)
  const undoKey = a?.splits[0]?.by === 'manager' && me?.manager.undoAvailable ? splits[0]?.row.key : null
  return (
    <Screen
      inset="top"
      title="Activity"
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} colors={[colors.accent]} progressBackgroundColor={colors.surface} tintColor={colors.accent} />}
    >
      {!a && q.isError ? <ThemedText tone="secondary">Could not load your activity just now. Pull down to try again.</ThemedText> : null}
      {/* His note 10-08: the first read can take a few seconds; the sign-in sprout sways meanwhile instead of a near-empty page */}
      {!a && !q.isError ? (
        <View style={{ alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl }} accessibilityLabel="Loading your activity">
          <SigninSprout />
          <ThemedText variant="caption" tone="secondary">
            Loading your activity
          </ThemedText>
        </View>
      ) : null}
      {a ? (
        <>
          {/* R450: one list with filter chips (Jupiter Mobile's pattern); every row the same shape, a tap shows details + Solscan */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
            {KIND_FILTERS.map((f) => {
              const on = filter === f.value
              return (
                <Pressable
                  key={f.value}
                  onPress={() => { setFilter(f.value); setMore(false) }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={{
                    minHeight: TARGET - spacing.sm,
                    justifyContent: 'center',
                    paddingHorizontal: spacing.md,
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: on ? colors.accent : colors.hairline,
                    backgroundColor: on ? colors.accent : 'transparent',
                  }}
                >
                  <ThemedText variant="label" style={{ color: on ? colors.onAccent : colors.text }}>
                    {f.label}
                  </ThemedText>
                </Pressable>
              )
            })}
          </View>
          {rows.length === 0 ? <ThemedText tone="secondary">Nothing here yet.</ThemedText> : null}
          {groupByDay(shown.map((t) => t.row)).map((day, d) => (
            <View key={`${day.key}-${d}`} style={{ gap: spacing.xs }}>
              <ThemedText variant="caption" tone="secondary" accessibilityRole="header" style={{ textTransform: 'uppercase', letterSpacing: 0.6, paddingTop: spacing.xs }}>
                {day.header}
              </ThemedText>
              <Card>
                {day.rows.map((r) => {
                  const t = shown.find((x) => x.row.key === r.key)!
                  return (
                    <View key={r.key}>
                      <Row
                        row={r}
                        kind={t.kind}
                        accountPubkey={t.walletAccount ? me?.user.pubkey : null}
                        right={r.key === undoKey ? <Button title="Undo" kind="quiet" loading={busy} onPress={undo} style={{ paddingHorizontal: spacing.sm }} /> : null}
                      />
                      {r.key === undoKey && undoError ? <ThemedText tone="error">{undoError}</ThemedText> : null}
                    </View>
                  )
                })}
              </Card>
            </View>
          ))}
          {hidden > 0 ? <Button title={`Show ${hidden} more`} kind="quiet" onPress={() => setMore(true)} style={{ alignSelf: 'flex-start' }} /> : null}
        </>
      ) : null}
    </Screen>
  )
}
