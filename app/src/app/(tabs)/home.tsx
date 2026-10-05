import { useCallback, useMemo, useState } from 'react'
import { View, Pressable, RefreshControl, Image } from 'react-native'
import { Link, Redirect, router, useFocusEffect } from 'expo-router'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import { useMe, useInvalidateMe, toGardenInput } from '@/lib/me'
import { recordWatering, wateredPlantsFor } from '@/lib/last-watering'
import { plantLabel } from '@/lib/plant-label'
import { api, ApiError, type MeResponse } from '@/lib/api'
import { buildScene } from '@/model/garden'
import { watcherLine } from '@/model/watcher'
import { Garden } from '@/garden/Garden'
import { SPRITES } from '@/garden/sprites'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { MarkedTitle } from '@/components/Lockup'
import { WatcherLine } from '@/components/WatcherLine'
import { NextPlanting, roomUnderBar } from '@/components/NextPlanting'
import { canSlot } from '@/model/can'
import { nextPlantingRow } from '@/lib/next-planting'
import { PauseRow } from '@/components/PauseRow'
import { RelinkCard } from '@/components/RelinkCard'
import { termsNeeded, termsSummary } from '@/lib/terms'
import { arrivalLine, formatUsd, formatSkr, formatAsOf } from '@/lib/format'
import { useSession } from '@/lib/session'
import { gardenTotals, pauseState, coinRows, statTiles, walletsLine, lastPlantingLine } from '@/lib/me-state'
import { setPaused } from '@/lib/pause-api'
import { freshWalletSignIn } from '@/lib/reauth'
import { identity } from '@/lib/identity'
import { FONT, radius, spacing, TARGET, useTheme } from '@/theme'
import type { LiveAsset } from '@/lib/coins'

/** R230: each row of Home's coin list leads with the coin's painted token (the garden's fruit) and its full name, portfolio style. */
const COIN_ICON: Record<LiveAsset, number> = {
  SKR: SPRITES['token-skr'].src,
  stORE: SPRITES['token-ore'].src,
  USDC_LEND: SPRITES['token-jitosol'].src,
  SOL_LEND: SPRITES['token-jitosol'].src,
  hSOL: SPRITES['token-hsol'].src,
  cbBTC: SPRITES['token-cbbtc'].src,
}
const COIN_FULL_NAME: Record<LiveAsset, string> = {
  SKR: 'Seeker',
  stORE: 'Staked ORE',
  USDC_LEND: 'USDC lending',
  SOL_LEND: 'SOL lending',
  hSOL: 'Helius Staked SOL',
  cbBTC: 'Coinbase Wrapped BTC',
}
/** USDC has no painted token yet (contracts 10.6): a plain dollar glyph in USDC's blue. SOL lending shows the Solana-glyph token. */
const USDC_BLUE = '#2775CA'

/** R199: the Last planting row's hit slop at its bottom and sides; the row is TARGET minus this tall, so its touch target is 48 dp.
 * No slop at its top: that edge meets the garden's row, where the can's touch box ends, and a later sibling's slop would win there. */
const RECEIPT_SLOP = spacing.sm

export default function Home() {
  const { setSession } = useSession()
  const { colors } = useTheme()
  const { data: me, stale, fresh, refetch, asOf, loading, unauthorized } = useMe()
  const invalidate = useInvalidateMe()
  const queryClient = useQueryClient()
  const [failed, setFailed] = useState(false)
  const [nudged, setNudged] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [pauseError, setPauseError] = useState<string | null>(null)
  const [landed, setLanded] = useState(0) // R195: every landing here and every pull-to-refresh replays the can's wobble
  const now = new Date()
  const today = now.toDateString()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is taken once per render on purpose; the scene follows the local date
  const scene = useMemo(() => (me ? buildScene(toGardenInput(me, now, wateredPlantsFor(me.user.wateredAt))) : null), [me, today])
  // Coming back to Home reads again: a wallet linked on the web, a planting, a withdrawal show without a pull-down. Leaving it
  // forgets a failed watering and the greyed can's hint (audits/watering-ux, finding 10).
  useFocusEffect(
    useCallback(() => {
      void refetch()
      setLanded((n) => n + 1)
      return () => {
        setFailed(false)
        setNudged(false)
      }
    }, [refetch]),
  )

  /**
   * The reveal (R55): the API records the moment, the fresh read opens the buds, then the garden plays each one opening from the
   * scene diff. The state comes from the read, never from the gesture. The can's drag onto a plant and its tap send this same
   * watering: the API opens every bud, and the garden opens the plant the can was dropped on first. The can holds its pour while
   * this runs; a failure says so instead of nothing (finding 8) and sends the can home. R199: a success adds no line; the buds
   * opening are the confirmation.
   */
  async function water(): Promise<boolean> {
    if (!me || !scene) return false
    setFailed(false)
    // R249: the plants with a bud as the watering begins are the ones it opens; kept with the answer's time for the rings
    const buds = [...new Set(scene.parts.flatMap((q) => (q.kind === 'sprout' && q.bud ? [q.plant] : [])))]
    try {
      const answer = await api<{ wateredAt: string }>('/api/water', { method: 'POST', body: {} })
      if (answer?.wateredAt) recordWatering(answer.wateredAt, buds)
      await invalidate()
      return true
    } catch {
      setFailed(true)
      return false
    }
  }

  /** The switch (R147): the answer's statuses land on the cached read at once, so the row settles with the switch; the fresh read reconciles after. */
  async function togglePaused(on: boolean) {
    setPausing(true)
    setPauseError(null)
    try {
      const answer = await setPaused(!on, freshWalletSignIn(identity))
      queryClient.setQueryData<MeResponse>(['me'], (old) =>
        old
          ? {
              ...old,
              wallets: old.wallets.map((w) => ({
                ...w,
                status: answer.wallets.find((a) => a.pubkey === w.pubkey)?.status ?? w.status,
              })),
            }
          : old,
      )
      void invalidate()
    } catch (e) {
      setPauseError(
        e instanceof ApiError
          ? e.message
          : on
            ? 'Could not turn Sprouts back on. Try again.'
            : 'Could not pause. Try again.',
      )
    } finally {
      setPausing(false)
    }
  }

  if (unauthorized) {
    // The token expired or was revoked (R84): back to Welcome.
    void setSession(null)
    return <Redirect href="/" />
  }
  // The first read comes from the cache in one frame; a blank paper ground is quieter than a loading line that would flash (slop: the spinner blink).
  if (loading || !me || !scene) return <View style={{ flex: 1, backgroundColor: colors.background }} />
  const skrUsd = me.pot.skrUsd
  const name = me.user.skrName
  const staked = BigInt(me.pot.skrStakedRaw)
  const totals = gardenTotals(me)
  const pause = pauseState(me.wallets)
  // R96, R184 and R186: the one line and the can decided together, so they always agree; the can is in colour only while a bud waits.
  // R186: the Next planting row draws inside the garden (directly under it, the can at its bar's end). R199: the line rides in that
  // row too, tucked into the paper under the bar beside the can (WatcherLine's `tuck`).
  const watcher = watcherLine({
    unrevealed: scene.unrevealed,
    failed,
    nudged,
  })
  const nextRow = nextPlantingRow({
    pendingCents: me.nextPlanting.pendingCents,
    thresholdCents: me.nextPlanting.thresholdCents,
    hasPlant: scene.parts.some((p) => p.kind === 'plant'),
    now,
  })
  const wallets = me.wallets.filter((w) => w.status !== 'revoked')
  const receiptLine = lastPlantingLine(me.lastReceipt)
  const walletsRow = walletsLine(wallets)

  return (
    <Screen
      inset="top"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            setLanded((n) => n + 1)
            void refetch()
          }}
          colors={[colors.accent]}
          progressBackgroundColor={colors.surface}
          tintColor={colors.accent}
        />
      }
    >
      <MarkedTitle size={22}>{name ? `${name}'s garden` : 'Your garden'}</MarkedTitle>
      {pause.shown ? (
        <PauseRow on={pause.on} line={pause.line} busy={pausing} error={pauseError} onChange={togglePaused} />
      ) : null}
      <RelinkCard me={me} />
      {termsNeeded(me) ? (
        <Card>
          <ThemedText variant="heading">Terms and Privacy</ThemedText>
          {termsSummary().map((l) => (
            <ThemedText key={l} tone="secondary">{`• ${l}`}</ThemedText>
          ))}
          <Button title="Read and agree" onPress={() => router.push('/terms')} />
        </Card>
      ) : null}
      <Garden
        scene={scene}
        labelFor={(plant, bud) => plantLabel(me, plant, bud)}
        live={fresh}
        canReady={watcher.can === 'ready'}
        wobble={landed}
        onWater={water}
        onNudge={() => setNudged(true)}
        row={(can) => (
          <>
            <NextPlanting
              row={nextRow}
              pendingCents={me.nextPlanting.pendingCents}
              thresholdCents={me.nextPlanting.thresholdCents}
              can={can}
            />
            {watcher.line ? <WatcherLine text={watcher.line} tuck={{ room: roomUnderBar(can.s), slot: canSlot(can.s) }} /> : null}
          </>
        )}
      />
      {/* R199: the last planting closes the garden section: it sits straight under the garden (the screen's gap taken back), its row
          40 dp plus an 8 dp slop below, so its touch target stays 48 dp while the block stays tight. */}
      {receiptLine ? (
        <Pressable
          onPress={() => router.push('/activity')}
          accessibilityRole="button"
          accessibilityLabel={`${receiptLine}. Opens Activity.`}
          hitSlop={{ top: 0, bottom: RECEIPT_SLOP, left: RECEIPT_SLOP, right: RECEIPT_SLOP }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.xs,
            minHeight: TARGET - RECEIPT_SLOP,
            marginTop: -spacing.lg,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ThemedText variant="caption" tone="secondary" style={{ flex: 1 }}>
            {receiptLine}
          </ThemedText>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
      {/* R199: one small step more than the screen's gap before the pot card, so the garden section reads as one block above it. */}
      {/* R236 (10-04, his note): closer under the Last planting row; the row's own touch height already leaves room */}
      <Card style={{ marginTop: -spacing.xs }}>
        {/* R146 and R150: the whole garden in dollars, two stat tiles, then one row per coin; no sentences. */}
        <ThemedText variant="label" tone="secondary">
          In your garden
        </ThemedText>
        <ThemedText variant="display" numeric>
          {totals.valueUsd === null ? formatSkr(staked, null) : formatUsd(Math.round(totals.valueUsd * 100))}
        </ThemedText>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {statTiles(totals).map((t) => (
            <View
              key={t.label}
              style={{
                flex: 1,
                backgroundColor: colors.background,
                borderRadius: radius.md,
                padding: spacing.md,
                gap: 2,
              }}
            >
              <ThemedText variant="label" tone="secondary">
                {t.label}
              </ThemedText>
              <ThemedText variant="heading" numeric>
                {t.value}
              </ThemedText>
            </View>
          ))}
        </View>
        {/* R230 (his note, "a more familiar portfolio look, like coinmarketcap's"): one row per coin, the token and the full name with
            the amount under it on the left, the dollars with the coin's status under them on the right; hairlines between rows.
            Replaces R198/R205's one-line rows (the lead rows' larger face goes: every row now has the same two lines). */}
        <View style={{ marginTop: spacing.xs }}>
          {coinRows(me).map((r, i) => (
            <View
              key={r.key}
              accessible
              accessibilityLabel={`${COIN_FULL_NAME[r.asset]}, ${r.amount}${r.locked ? ', locked to your Seeker' : r.note ? `, ${r.note}` : ''}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: spacing.md,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: colors.hairline,
              }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.iconGround, alignItems: 'center', justifyContent: 'center' }}>
                {r.asset === 'USDC_LEND' ? (
                  <MaterialCommunityIcons name="currency-usd" size={26} color={USDC_BLUE} />
                ) : (
                  <Image source={COIN_ICON[r.asset]} style={{ width: 30, height: 30 }} resizeMode="contain" />
                )}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText variant="body" style={{ fontFamily: FONT.label }} numberOfLines={1}>
                  {COIN_FULL_NAME[r.asset]}
                </ThemedText>
                <ThemedText variant="caption" tone="secondary" numeric numberOfLines={1}>
                  {r.qty}
                </ThemedText>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2, flexShrink: 0, maxWidth: '50%' }}>
                <ThemedText variant="body" numeric style={{ fontFamily: FONT.label }}>
                  {r.usd ?? '–'}
                </ThemedText>
                {r.locked || r.note ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialCommunityIcons name={r.locked ? 'lock-outline' : r.venue ? 'bank-outline' : 'pickaxe'} size={12} color={colors.textSecondary} />
                    <ThemedText variant="caption" tone="secondary" numberOfLines={1}>
                      {r.locked ? 'Locked to your Seeker' : r.note}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
        {stale && asOf ? (
          <ThemedText variant="caption" tone="error">
            {formatAsOf(asOf, now)}, the chain could not be read just now.
          </ThemedText>
        ) : null}
        <Link href="/withdraw" asChild>
          <Button title="Withdraw" kind="quiet" onPress={() => {}} />
        </Link>
      </Card>
      {walletsRow ? (
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel={`${walletsRow}. Opens Settings.`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            minHeight: TARGET,
            paddingHorizontal: spacing.lg,
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            borderCurve: 'continuous',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <ThemedText style={{ flex: 1 }}>{walletsRow}</ThemedText>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.accentText} />
        </Pressable>
      ) : (
        <Card>
          <ThemedText variant="heading">Linked wallets</ThemedText>
          <ThemedText tone="secondary">
            No wallet linked yet. Link one and every swap rounds up into your garden.
          </ThemedText>
          <Link href="/connect" asChild>
            <Button title="Link a wallet" kind="quiet" onPress={() => {}} />
          </Link>
        </Card>
      )}
      {me.basket ? (
        <Card>
          <ThemedText>
            In the basket: {formatSkr(BigInt(me.basket.amountRaw), skrUsd)}, {arrivalLine(me.basket.readyAt, now)}
          </ThemedText>
        </Card>
      ) : null}
    </Screen>
  )
}
