import { useCallback, useMemo, useState } from 'react'
import { View, RefreshControl } from 'react-native'
import { Link, Redirect, useFocusEffect } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { useMe, useInvalidateMe, toGardenInput } from '@/lib/me'
import { api, ApiError, type MeResponse } from '@/lib/api'
import { buildScene } from '@/model/garden'
import { watcherLine } from '@/model/watcher'
import { Garden } from '@/garden/Garden'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { MarkedTitle } from '@/components/Lockup'
import { WatcherLine } from '@/components/WatcherLine'
import { WaterButton } from '@/components/WaterButton'
import { PauseRow } from '@/components/PauseRow'
import {
  formatUsd,
  formatSkr,
  formatHolding,
  HOLDINGS_NOTE,
  formatAsOf,
  formatWallet,
  COIN_NAME,
  plantedLine,
} from '@/lib/format'
import { useSession } from '@/lib/session'
import { noPlantingLine, gardenTotals, gardenLine, pauseState } from '@/lib/me-state'
import { setPaused } from '@/lib/pause-api'
import { freshWalletSignIn } from '@/lib/reauth'
import { identity } from '@/lib/identity'
import { spacing, useTheme } from '@/theme'

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function Home() {
  const { setSession } = useSession()
  const { colors } = useTheme()
  const { data: me, stale, refetch, asOf, loading, unauthorized } = useMe()
  const invalidate = useInvalidateMe()
  const queryClient = useQueryClient()
  const [justOpened, setJustOpened] = useState<Set<string>>(new Set())
  const [watering, setWatering] = useState(false)
  const [failed, setFailed] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [pauseError, setPauseError] = useState<string | null>(null)
  const now = new Date()
  const today = now.toDateString()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is taken once per render on purpose; the scene follows the local date
  const scene = useMemo(() => (me ? buildScene(toGardenInput(me, now)) : null), [me, today])
  // Coming back to Home reads again: a wallet linked on the web, a planting, a withdrawal show without a pull-down. Leaving it
  // ends the "Opened" line and forgets a failed tap (audits/watering-ux, finding 10).
  useFocusEffect(
    useCallback(() => {
      void refetch()
      return () => {
        setJustOpened(new Set())
        setFailed(false)
      }
    }, [refetch]),
  )

  /**
   * The reveal (R55): the API records the moment, the fresh read opens the buds, then each one blooms in. The state comes from
   * the read, never from the tap. A failed tap says so instead of nothing (finding 8).
   */
  async function water() {
    if (!me || !scene) return
    setFailed(false)
    setWatering(true)
    const opening = new Set(
      scene.parts.filter((p) => p.kind === 'sprout' && p.bud).map((p) => (p as { id: string }).id),
    )
    try {
      await api('/api/water', { method: 'POST', body: {} })
      await invalidate()
      setJustOpened(opening)
    } catch {
      setFailed(true)
    } finally {
      setWatering(false)
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
  // R96: the line and the can decided together, so they always agree; the can is there only while a bud waits.
  const watcher = watcherLine({
    unrevealed: scene.unrevealed,
    hasPlant: scene.parts.some((p) => p.kind === 'plant'),
    neverWatered: me.user.wateredAt === null,
    pendingCents: me.nextPlanting.pendingCents,
    thresholdCents: me.nextPlanting.thresholdCents,
    watering,
    opened: justOpened.size,
    failed,
  })
  const wallets = me.wallets.filter((w) => w.status !== 'revoked')

  return (
    <Screen
      inset="top"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => refetch()}
          colors={[colors.accent]}
          progressBackgroundColor={colors.surface}
          tintColor={colors.accent}
        />
      }
    >
      <MarkedTitle>{name ? `${name}'s garden` : 'Your garden'}</MarkedTitle>
      {pause.shown ? (
        <PauseRow on={pause.on} line={pause.line} busy={pausing} error={pauseError} onChange={togglePaused} />
      ) : null}
      <Garden scene={scene} justOpened={justOpened} />
      <WatcherLine text={watcher.line} />
      {watcher.button ? (
        <View style={{ gap: spacing.sm }}>
          <WaterButton label={watcher.button} busy={watering} onPress={water} />
          {watcher.note ? (
            <ThemedText variant="caption" tone="secondary">
              {watcher.note}
            </ThemedText>
          ) : null}
        </View>
      ) : null}
      <Card>
        {/* R146: the whole garden first, in dollars; then what went in and what it earned; then each coin. */}
        <ThemedText variant="label" tone="secondary">
          In your garden
        </ThemedText>
        <ThemedText variant="display" numeric>
          {totals.valueUsd === null ? formatSkr(staked, null) : formatUsd(Math.round(totals.valueUsd * 100))}
        </ThemedText>
        <ThemedText>{gardenLine(totals)}</ThemedText>
        <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
          <ThemedText variant="heading" numeric>
            {formatSkr(staked, skrUsd)}
          </ThemedText>
          {/* R134: the SKR block's own line carries the lock. */}
          <ThemedText tone="secondary">
            Put in {formatSkr(BigInt(me.pot.skrPutInRaw), skrUsd)}. Earned{' '}
            {formatSkr(BigInt(me.pot.skrEarnedRaw), skrUsd)}. Locked to your Seeker.
          </ThemedText>
          {me.holdings.map((h) => (
            <ThemedText key={h.asset} numeric>
              {formatHolding(h)}
            </ThemedText>
          ))}
          {me.holdings.length > 0 ? (
            <ThemedText variant="caption" tone="secondary">
              {HOLDINGS_NOTE}
            </ThemedText>
          ) : null}
        </View>
        {stale && asOf ? (
          <ThemedText variant="caption" tone="error">
            {formatAsOf(asOf, now)}, the chain could not be read just now.
          </ThemedText>
        ) : asOf ? (
          <ThemedText variant="caption" tone="secondary">
            {formatAsOf(asOf, now)}
          </ThemedText>
        ) : null}
        <Link href="/withdraw" asChild>
          <Button title="Withdraw" kind="quiet" onPress={() => {}} />
        </Link>
      </Card>
      <Card>
        <ThemedText>
          Next planting: {formatUsd(me.nextPlanting.pendingCents)} of {formatUsd(me.nextPlanting.thresholdCents)}
          {me.nextPlanting.asset !== 'SKR' ? `, grows ${COIN_NAME[me.nextPlanting.asset]}` : ''}
        </ThemedText>
        {me.lastReceipt ? (
          <ThemedText variant="caption" tone="secondary">
            Last planting {shortDate(me.lastReceipt.ts)}:{' '}
            {plantedLine({
              usdcInCents: me.lastReceipt.usdcPulledCents - me.lastReceipt.networkFeeCents,
              asset: me.lastReceipt.asset,
              amountOutRaw: me.lastReceipt.amountOutRaw,
              usdPrice: me.lastReceipt.usdPrice,
              feeCents: me.lastReceipt.feeCents,
              feeAmountRaw: me.lastReceipt.feeAmountRaw,
            })}
            , network fee {formatUsd(me.lastReceipt.networkFeeCents)}
          </ThemedText>
        ) : (
          <ThemedText variant="caption" tone="secondary">
            {noPlantingLine(me)}
          </ThemedText>
        )}
      </Card>
      <Card>
        <ThemedText variant="heading">Linked wallets</ThemedText>
        {wallets.length === 0 ? (
          <ThemedText tone="secondary">
            No wallet linked yet. Link one and every swap rounds up into your garden.
          </ThemedText>
        ) : (
          wallets.map((w) => (
            <ThemedText key={w.pubkey} tone="secondary" numeric>
              {formatWallet(w)}
            </ThemedText>
          ))
        )}
        <Link href="/connect" asChild>
          <Button
            title={wallets.length > 0 ? 'Link another wallet' : 'Link a wallet'}
            kind="quiet"
            onPress={() => {}}
          />
        </Link>
      </Card>
      {me.basket ? (
        <Card>
          <ThemedText>
            In the basket: {formatSkr(BigInt(me.basket.amountRaw), skrUsd)}, arrives{' '}
            {new Date(me.basket.readyAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })}
          </ThemedText>
        </Card>
      ) : null}
    </Screen>
  )
}
