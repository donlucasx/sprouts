import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Pressable, RefreshControl, Image, useWindowDimensions } from 'react-native'
import { Link, Redirect, router, useFocusEffect } from 'expo-router'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useMe, useInvalidateMe, toGardenInput } from '@/lib/me'
import { useQueryClient } from '@tanstack/react-query'
import { activityQuery } from '@/lib/activity-query'
import { recordWatering, wateredPlantsFor } from '@/lib/last-watering'
import { readZeroMarks } from '@/lib/zero-marks'
import { plantLabel } from '@/lib/plant-label'
import { api } from '@/lib/api'
import { buildScene, PLANT_OF } from '@/model/garden'
import { ASSET_OF_PLANT, revealFrom, stagesFor, type Stages } from '@/model/garden2'
import { readSeenStages, writeSeenStages } from '@/lib/garden2-seen'
import { Garden2, garden2Bleeds } from '@/garden2/Garden2'
import { FRUITING, GARDEN2 } from '@/garden2/flag'
import { withDevBud, type DevBud } from '@/lib/dev-bud'
import { frameFor, skyAbove, valuePull } from '@/model/layout'
import { packScene } from '@/model/spread'
import { plantLayouts } from '@/model/scene-to-layout'
import { watcherLine } from '@/model/watcher'
import { Garden } from '@/garden/Garden'
import { COIN_FULL_NAME, COIN_LOGO } from '@/lib/coin-icons'
import type { LendingPosition, MeResponse } from '@/lib/api'
import { earnedLabel } from '@/lib/coin-sheet'
import { CoinSheet } from '@/components/CoinSheet'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { MarkedTitle } from '@/components/Lockup'
import { WatcherLine } from '@/components/WatcherLine'
import { NextPlanting, roomUnderBar } from '@/components/NextPlanting'
import { canSlot } from '@/model/can'
import { nextPlantingFor } from '@/lib/next-planting'
import { RelinkCard } from '@/components/RelinkCard'
import { MoveCard } from '@/components/MoveCard'
import { termsNeeded, termsSummary } from '@/lib/terms'
import { arrivalLine, formatSkr, formatAsOf } from '@/lib/format'
import { useSession } from '@/lib/session'
import { gardenTotals, pauseState, coinRows, valueBlock, walletsLine, lastPlantingLine, type CoinRow } from '@/lib/me-state'
import { FONT, radius, spacing, TARGET, useTheme } from '@/theme'

/** R562: each row of Home's coin list leads with the coin's official round logo (lib/coin-icons), Phantom style. */


/** R199: the Last planting row's hit slop at its bottom and sides; the row is TARGET minus this tall, so its touch target is 48 dp.
 * No slop at its top: that edge meets the garden's row, where the can's touch box ends, and a later sibling's slop would win there. */
const RECEIPT_SLOP = spacing.sm

/** Dev only (the dev menu's split switch, R568): each lending position shown as two halves, one at each venue, so the grouped row can
 * be seen on a device with one real position. Nothing is sent anywhere. */
function devSplitLending(me: MeResponse): MeResponse {
  const other = { kamino_klend: 'jupiter_lend', jupiter_lend: 'kamino_klend' } as const
  const half = (p: LendingPosition): LendingPosition[] => {
    const u = BigInt(p.underlyingRaw), a = u / 2n
    const v = (x: number | null) => (x === null ? null : x / 2)
    return [
      { ...p, underlyingRaw: String(a), valueUsd: v(p.valueUsd), earnedUsd: v(p.earnedUsd), putInCents: Math.round(p.putInCents / 2) },
      { ...p, venue: other[p.venue], ratePct: p.ratePct === null ? null : p.ratePct + 1.1, underlyingRaw: String(u - a), valueUsd: v(p.valueUsd), earnedUsd: v(p.earnedUsd), putInCents: p.putInCents - Math.round(p.putInCents / 2) },
    ]
  }
  return { ...me, positions: (me.positions ?? []).flatMap(half) }
}

export default function Home() {
  const { setSession } = useSession()
  const { colors, dark } = useTheme()
  const { data: me, stale, fresh, refetch, asOf, loading, unauthorized } = useMe()
  const invalidate = useInvalidateMe()
  const [failed, setFailed] = useState(false)
  const [nudged, setNudged] = useState(false)
  // R457: "Add money" is a Pro feature still to come; the greyed button explains itself on a tap instead of doing nothing
  const [addMoneyNote, setAddMoneyNote] = useState(false)
  const [sheetRow, setSheetRow] = useState<CoinRow | null>(null) // R564: the coin whose sheet is open
  const [landed, setLanded] = useState(0) // R195: every landing here and every pull-to-refresh replays the can's wobble
  const now = new Date()
  const today = now.toDateString()
  // R351's device check, DEV builds only: the dev menu's "Grow a bud" adds a local SKR bud; the can then waters it locally (nothing is sent)
  const [devBud, setDevBud] = useState<DevBud | null>(null)
  const [devSplit, setDevSplit] = useState(false) // dev menu: show each lending position split across both venues (R568 check)
  const queryClient = useQueryClient()
  // Perf (10-08): Activity's list is read while Home is up, so the tab opens on data (a failed prefetch is silent; the tab reads again).
  useEffect(() => {
    void queryClient.prefetchQuery(activityQuery)
  }, [queryClient])
  useEffect(() => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      void import('expo-dev-menu')
        .then(({ registerDevMenuItems }) =>
          registerDevMenuItems([
            { name: 'Grow a bud (SKR, local)', callback: () => setDevBud({ budAt: new Date(Date.now() - 1000), wateredAt: null }), shouldCollapse: true },
            { name: 'Clear the dev bud', callback: () => setDevBud(null), shouldCollapse: true },
            { name: 'Garden2 stages', callback: () => router.push('/dev-garden2'), shouldCollapse: true },
            { name: 'Loading screen options', callback: () => router.push('/dev-splash'), shouldCollapse: true },
            { name: 'Split lending across 2 venues (local)', callback: () => setDevSplit((v) => !v), shouldCollapse: true },
          ]),
        )
        .catch(() => {})
    }
  }, [])
  const input = useMemo(
    () => (me ? withDevBud(toGardenInput(me, now, wateredPlantsFor(me.user.wateredAt), readZeroMarks()), devBud) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is taken once per render on purpose; the scene follows the local date
    [me, today, devBud],
  )
  const scene = useMemo(() => (input ? buildScene(input) : null), [input])
  // Garden2 (behind GARDEN2): each coin's stage from its planted dollars (model/garden2.ts stagesFor, the R484G ladder)
  const stages = useMemo(() => (input && GARDEN2 ? stagesFor(input) : null), [input])
  // R521: plants that grew since this phone last showed the garden reveal the step (Garden2 fades it in); then the new stages are seen
  const stagesKey = stages ? JSON.stringify(stages) : ''
  const [shown, setShown] = useState<{ key: string; reveal: Partial<Stages> }>({ key: '', reveal: {} })
  if (stages && shown.key !== stagesKey) setShown({ key: stagesKey, reveal: revealFrom(readSeenStages(), stages) }) // read before the write below
  const reveal = shown.reveal
  useEffect(() => {
    if (stages) writeSeenStages(stages)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per change of the stages' content
  }, [stagesKey])
  // R533: earnings shown only on the two trees, the shared ladder's count (garden-input.ts: SKR from the pot, stORE from its holding);
  // R535: the basket at the mandarin's foot while withdrawn SKR waits out its 48 h unstake (until it is delivered)
  const extras2 = useMemo(
    () => ({
      fruit: FRUITING ? { mandarin: input?.earned.SKR?.count ?? 0, store: input?.earned.stORE?.count ?? 0 } : {}, // R584: none in v1
      basket: !!me?.basket && !me.basket.delivered,
      stakes: true, // R534: each planted plant's stake, its coin name on it (R556: one line; the rest in the tap label)
    }),
    [input, me?.basket],
  )
  // R356, R357 (10-05, the gap above the garden tightened "a bit", then "by another half"): the garden pulled up under the value block
  // into its own empty sky, never closer than SKY_KEEP to its tallest part (layout.ts valuePull); framed as Garden.tsx frames it
  const { width: screenW } = useWindowDimensions()
  const pull = useMemo(() => {
    if (!scene) return spacing.lg
    if (GARDEN2) return 0 // Garden2's plate keeps its own paper sky above the trees
    const packed = packScene(scene), plants = plantLayouts(packed)
    return valuePull(skyAbove(plants, frameFor(packed, plants, screenW - 2 * spacing.edge)))
  }, [scene, screenW])
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
    if (devBud && !devBud.wateredAt) {
      setDevBud({ ...devBud, wateredAt: new Date() }) // DEV only: the dev bud is watered locally, the API is never called
      return true
    }
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


  if (unauthorized) {
    // The token expired or was revoked (R84): back to Welcome.
    void setSession(null)
    return <Redirect href="/" />
  }
  // The first read comes from the cache in one frame; a blank paper ground is quieter than a loading line that would flash (slop: the spinner blink).
  // Audit 10-08: a first read that failed with nothing cached used to leave this blank page for good (no pull-to-refresh either)
  if (!loading && !me)
    return (
      <Screen inset="top">
        <ThemedText tone="secondary">Sprouts could not reach your garden just now.</ThemedText>
        <Button title="Try again" kind="quiet" onPress={() => void refetch()} style={{ alignSelf: 'flex-start' }} />
      </Screen>
    )
  if (loading || !me || !scene) return <View style={{ flex: 1, backgroundColor: colors.background }} />
  const skrUsd = me.pot.skrUsd
  const name = me.user.skrName
  const staked = BigInt(me.pot.skrStakedRaw)
  const value = valueBlock(gardenTotals(me), staked)
  const pause = pauseState(me.wallets)
  // R96, R184 and R186: the one line and the can decided together, so they always agree; the can is in colour only while a bud waits.
  // R186: the Next planting row draws inside the garden (directly under it, the can at its bar's end). R199: the line rides in that
  // row too, tucked into the paper under the bar beside the can (WatcherLine's `tuck`).
  const watcher = watcherLine({
    unrevealed: GARDEN2 ? 0 : scene.unrevealed, // Garden2 has no can and no buds to water (R458: growth needs no action)
    failed,
    nudged,
  })
  const nextRow = nextPlantingFor(me, scene, now)
  const wallets = me.wallets.filter((w) => w.status !== 'revoked')
  const receiptLine = lastPlantingLine(me.lastReceipt)
  const walletsRow = walletsLine(wallets)

  // R199: the last planting closes the garden section: straight under the garden (the screen's gap taken back), its row 40 dp plus an
  // 8 dp slop below, so its touch target stays 48 dp while the block stays tight. With no status line it is the row tucked into the
  // paper under the bar beside the can (10-05, his device note: an empty gap there until a tap brought a line).
  const receipt = (tuck?: { room: number; slot: number }) =>
    receiptLine ? (
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
              marginTop: tuck ? -Math.max(0, tuck.room - spacing.sm) : -spacing.lg,
              paddingRight: tuck ? tuck.slot : 0,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <ThemedText variant="caption" tone="secondary" style={{ flex: 1 }}>
              {receiptLine}
            </ThemedText>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textSecondary} />
          </Pressable>
    ) : null
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
      {/* R448: the switch lives at the top of Rules; R459: Home shows a chip that opens it only while Sprouts is paused */}
      {pause.shown && !pause.on ? (
        <Pressable
          onPress={() => router.push('/rules')}
          accessibilityRole="button"
          accessibilityLabel={`${pause.line}. Open Rules to change it.`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', minHeight: TARGET }}
        >
          <View
            style={{ width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.attention }}
          />
          <ThemedText variant="caption" tone="secondary">
            {pause.line}
          </ThemedText>
          <MaterialCommunityIcons name="chevron-right" size={16} color={colors.textSecondary} />
        </Pressable>
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
      {/* R355 (10-05, "Value on top", his pick): the money in one compact block right under the status line, above the garden: the
          whole garden in dollars big with "in your garden" under it, Put in and Earned small on the right (R146, R150's numbers). */}
      <View style={{ gap: spacing.xs, marginBottom: -pull }}>
        <View accessible accessibilityLabel={value.a11y} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ThemedText variant="display" numeric numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
              {value.big}
            </ThemedText>
            <ThemedText variant="label" tone="secondary">
              {value.label}
            </ThemedText>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2, flexShrink: 0, maxWidth: '50%' }}>
            {value.side.map((t) => (
              <ThemedText key={t.label} variant="label" tone="secondary" numeric numberOfLines={1}>
                {`${t.label} `}
                <ThemedText variant="label" numeric style={t.label === 'Earned' ? { color: colors.success } : undefined /* R563 */}>
                  {t.value}
                </ThemedText>
              </ThemedText>
            ))}
          </View>
        </View>
        {stale && asOf ? (
          <ThemedText variant="caption" tone="error">
            {formatAsOf(asOf, now)}, the chain could not be read just now.
          </ThemedText>
        ) : null}
      </View>
      {GARDEN2 && stages ? (
        <>
          {/* Full bleed in light, and in dark once a dark plate exists (R529); else a paper card inside the gutters (Garden2.tsx) */}
          <View style={{ marginHorizontal: garden2Bleeds(dark) ? -spacing.edge : 0 }}>
            <Garden2
              stages={stages}
              extras={extras2}
              reveal={reveal}
              width={garden2Bleeds(dark) ? screenW : screenW - 2 * spacing.edge}
              labelFor={(p) => plantLabel(me, PLANT_OF[ASSET_OF_PLANT[p]], false)}
            />
          </View>
          <NextPlanting row={nextRow} pendingCents={me.nextPlanting.pendingCents} thresholdCents={me.nextPlanting.thresholdCents} />
          {watcher.line ? <WatcherLine text={watcher.line} /> : null}
        </>
      ) : (
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
            {watcher.line ? (
              <WatcherLine text={watcher.line} tuck={{ room: roomUnderBar(can.s), slot: canSlot(can.s) }} />
            ) : (
              receipt({ room: roomUnderBar(can.s), slot: canSlot(can.s) })
            )}
          </>
        )}
      />
      )}
      {watcher.line || GARDEN2 ? receipt() : null}
      {/* R199: one small step more than the screen's gap before the coins card, so the garden section reads as one block above it. */}
      {/* R236 (10-04, his note): closer under the Last planting row; the row's own touch height already leaves room */}
      <Card style={{ marginTop: -spacing.xs }}>
        {/* R146 and R150: one row per coin, no sentences; R355 moved the total, Put in and Earned to the block above the garden. */}
        {/* R230 (his note, "a more familiar portfolio look, like coinmarketcap's"): one row per coin, the token and the full name with
            the amount under it on the left, the dollars with the coin's status under them on the right; hairlines between rows.
            Replaces R198/R205's one-line rows (the lead rows' larger face goes: every row now has the same two lines). */}
        <View>
          {coinRows(devSplit ? devSplitLending(me) : me).map((r, i) => {
            const earned = earnedLabel(r.earnedUsd)
            return (
            <View key={r.key} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }}>
            <Pressable
              onPress={() => setSheetRow(r)}
              accessibilityRole="button"
              accessibilityLabel={`${COIN_FULL_NAME[r.asset]}, ${r.amount}${earned ? `, earned ${earned.text}` : ''}. Opens its details.`}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingVertical: spacing.md,
                paddingBottom: r.parts ? spacing.xs : spacing.md,
              })}
            >
              <Image source={COIN_LOGO[r.asset]} style={{ width: 40, height: 40, borderRadius: 20 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText variant="body" style={{ fontFamily: FONT.label }} numberOfLines={1}>
                  {COIN_FULL_NAME[r.asset]}
                </ThemedText>
                <ThemedText variant="caption" tone="secondary" numeric numberOfLines={1}>
                  {r.qty}
                </ThemedText>
                {r.locked || r.venue || r.note ? (
                  // R567 (his note): where the coin is, back on the row: locked to the Seed Vault, the lending venue and its rate, or
                  // stORE's mining growth (the earned that positionNote used to append now sits on the right, R563)
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <MaterialCommunityIcons name={r.locked ? 'lock-outline' : r.venue ? 'bank-outline' : 'pickaxe'} size={12} color={colors.textSecondary} />
                    <ThemedText variant="caption" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {r.where}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2, flexShrink: 0, maxWidth: '50%' }}>
                <ThemedText variant="body" numeric style={{ fontFamily: FONT.label }}>
                  {r.usd ?? '–'}
                </ThemedText>
                {earned ? (
                  // R563: what this coin earned, green above zero; where it lives moved into the sheet (R564)
                  <ThemedText variant="caption" numeric numberOfLines={1} style={{ color: earned.positive ? colors.success : colors.textSecondary }}>
                    {`${earned.text} earned`}
                  </ThemedText>
                ) : null}
              </View>
            </Pressable>
            {r.parts?.map((p) => {
              // R568: a coin at several venues lists each venue under it, indented to the name: the venue and rate, its share
              // (and its earned, green above zero); tapping one opens that venue's own sheet and Withdraw
              const pe = earnedLabel(p.earnedUsd)
              return (
                <Pressable
                  key={p.key}
                  onPress={() => setSheetRow(p)}
                  accessibilityRole="button"
                  accessibilityLabel={`${p.where}, ${p.amount}${pe ? `, earned ${pe.text}` : ''}. Opens its details.`}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.7 : 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    marginLeft: 40 + spacing.md,
                    paddingVertical: spacing.xs + 2,
                  })}
                >
                  <MaterialCommunityIcons name="bank-outline" size={12} color={colors.textSecondary} />
                  <ThemedText variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                    {p.where}
                  </ThemedText>
                  <ThemedText variant="caption" numeric numberOfLines={1}>
                    {`${p.qty}  ${p.usd ?? ''}`}
                    {pe?.positive ? <ThemedText variant="caption" numeric style={{ color: colors.success }}>{`  ${pe.text}`}</ThemedText> : null}
                  </ThemedText>
                </Pressable>
              )
            })}
            {r.parts ? <View style={{ height: spacing.sm }} /> : null}
            </View>
            )
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Link href="/withdraw" asChild>
            <Button title="Withdraw" kind="quiet" onPress={() => {}} style={{ flex: 1 }} />
          </Link>
          <Button
            title="Add money"
            kind="quiet"
            onPress={() => setAddMoneyNote((v) => !v)}
            accessibilityLabel="Add money, coming with Pro"
            style={{ flex: 1, opacity: 0.45 }}
          />
        </View>
        {addMoneyNote ? (
          <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
            Coming with Pro: add money to your garden anytime.
          </ThemedText>
        ) : null}
      </Card>
      <MoveCard me={me} />
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
      <CoinSheet me={me} row={sheetRow} onClose={() => setSheetRow(null)} />
    </Screen>
  )
}
