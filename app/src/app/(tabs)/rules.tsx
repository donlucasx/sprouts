import { useState } from 'react'
import { Pressable, Switch, TextInput, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { ProBadge } from '@/components/ProBadge'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { Stepper, StepButtons } from '@/components/Stepper'
import { TwoWay } from '@/components/TwoWay'
import { api, ApiError, type MeResponse } from '@/lib/api'
import { activityQuery } from '@/lib/activity-query'
import { useMe, useInvalidateMe, useApplyRules } from '@/lib/me'
import { freshSignIn } from '@/lib/signin'
import { freshWalletSignIn } from '@/lib/reauth'
import { identity } from '@/lib/identity'
import { formatUsd, coinNameLong } from '@/lib/format'
import { usdTrimmed } from '@/i18n/format'
import { undoSplit } from '@/lib/manager-api'
import {
  splitRows,
  setCoinOn,
  setManualCoinOn,
  saveSwitches,
  managedPins,
  managedPreview,
  stepPin,
  pinsForOn,
  pinsForOff,
  undoLine,
  stopLabel,
  STORE_FLOOR,
  canStepUp,
  canSwitchOff,
  explicitPins,
  draftShares,
  splitTotal,
} from '@/model/manager'
import type { Pins } from '@/lib/coins'
import { rulesChanges } from '@/lib/forms'
import { pauseState } from '@/lib/me-state'
import { usePauseToggle } from '@/lib/use-pause'
import { weekLine } from '@/lib/week'
import { joinsLine } from '@/lib/opening'
import { coinColor } from '@/lib/coin-colors'
import { PauseRow } from '@/components/PauseRow'
import { VenuesPanel } from '@/components/VenuesPanel'
import { radius, spacing, switchColors, TARGET, useTheme } from '@/theme'
import { t } from '@/i18n'
import { useLang } from '@/i18n/useLang'

type RulesShape = MeResponse['rules']

// D5: the text-to-controls box is hidden; it still compiles and its compile route still answers.
const SHOW_BOX = false as boolean

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
    <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
    {children}
  </View>
)

/** "$5" for whole dollars, "$0.10" otherwise (es "$0,10"): the chips fit side by side (device 10-08). */
const chipUsd = (c: number) => usdTrimmed(c)

/** A setting shown as its value; a tap opens its stepper under the chips (10-08 Rules redesign). */
function Chip({ label, open, onPress }: { label: string; open: boolean; onPress: () => void }) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: TARGET,
        paddingHorizontal: spacing.sm + 2,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: open ? colors.accent : colors.hairline,
        backgroundColor: open ? colors.surface : 'transparent',
      }}
    >
      <ThemedText>{label}</ThemedText>
      <ThemedText tone="secondary">{open ? '▴' : '▾'}</ThemedText>
    </Pressable>
  )
}

/** 0.1.10: a small set of choices shown side by side, the picked one outlined (the add-to-every-swap amount, the 1% start). */
function OptionChips<T extends number>({ options, value, format, onChange, label, optionLabel }: { options: readonly T[]; value: number; format: (v: T) => string; onChange: (v: T) => void; label: string; optionLabel: (v: T) => string }) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: -spacing.xs }}>
      {options.map((o) => {
        const on = o === value
        return (
          <Pressable
            key={o}
            onPress={() => onChange(o)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={optionLabel(o)}
            style={{
              minHeight: TARGET,
              minWidth: TARGET,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: spacing.sm + 2,
              borderRadius: radius.full,
              borderWidth: 1,
              borderColor: on ? colors.accent : colors.hairline,
              backgroundColor: on ? colors.surface : 'transparent',
            }}
          >
            <ThemedText tone={on ? undefined : 'secondary'}>{format(o)}</ThemedText>
          </Pressable>
        )
      })}
    </View>
  )
}

/** 0.1.10 (his rulings 11-12): the amounts "Add to every swap" offers, and where the 1% can start. */
const PER_SWAP_OPTIONS = [5, 10, 25] as const
const PCT_START_OPTIONS = [100, 1_000, 10_000] as const
const cents = (c: number) => `${c}\u00a2`

export default function Rules() {
  useLang()
  const { data: me } = useMe()
  const { colors } = useTheme()
  const toggle = switchColors(colors)
  const invalidate = useInvalidateMe()
  const applyRules = useApplyRules()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [undone, setUndone] = useState(false)
  // True only while the Seeker is asked to sign (a save that raises the limit): the caption under the button.
  const [signing, setSigning] = useState(false)
  // Changes are a draft until Save (09-29: each "+" asked for its own approval, and the first tap looked like nothing happened).
  const [draft, setDraft] = useState<Partial<RulesShape>>({})
  // Addendum 11-15: true once a manager-off split change has pinned every on coin at its shown share (explicitPins); the draft's pins
  // are then the user's own numbers, read as they are (draftShares), and Save waits for a total of exactly 100.
  const [explicit, setExplicit] = useState(false)
  // The watcher (spec 6): a rule in plain English becomes a proposal, set on the controls as the draft; Save is the confirmation.
  const [ask, setAsk] = useState('')
  const [asking, setAsking] = useState(false)
  const [watcher, setWatcher] = useState<{ understood: string; notes: string[] } | null>(null)
  // 10-08 redesign: which chip's stepper is open, and whether the 0% coins are unfolded
  const [picker, setPicker] = useState<'cap' | null>(null)
  const [showAll, setShowAll] = useState(false)
  const { pausing, pauseError, togglePaused } = usePauseToggle()
  const activity = useQuery(activityQuery)
  if (!me)
    return (
      <Screen inset="top" title={t('tabs.rules')}>
        <ThemedText tone="secondary">{t('rules.loading')}</ThemedText>
      </Screen>
    )
  const saved = me.rules
  const r = { ...saved, ...draft }
  const { patch, raises } = rulesChanges(saved, draft)
  const dirty = Object.keys(patch).length > 0
  // While a request runs the controls stay live but a tap does nothing (10-01 device check: the whole screen greyed for each request).
  const edit = (p: Partial<RulesShape>) => {
    if (busy) return
    setUndone(false)
    setDraft((d) => ({ ...d, ...p }))
  }
  // Manager off: the split's draft as explicit pins (an untouched user's SKR 90 / stORE 10 included), and its shares and total.
  const manualPins: Pins = explicit ? r.pins : explicitPins(r.pins)
  const total = r.managed ? null : splitTotal(draftShares(manualPins))
  const editManual = (f: (pins: Pins) => Pins) => {
    if (busy) return
    setExplicit(true)
    edit({ pins: f(manualPins) })
  }
  const clearDraft = () => {
    setDraft({})
    setExplicit(false)
  }
  // The ORE disclosure shows inline once: the first time the manager is switched on, or, off, the first time stORE gets a pin above
  // zero (spec 3.1; since R-O1 a first "+" pins it at 15, over the 10% floor every split keeps).
  // F1: switched on but not yet saved, the saved allocation is still the OFF one; the rows preview the stop's split instead.
  const unsavedOn = r.managed && !saved.managed
  // R346: the preview follows the draft's coin switches and stop; with nothing changed, the saved allocation is the truth.
  const coinsChanged =
    r.managed &&
    (unsavedOn || r.stop !== saved.stop || JSON.stringify(managedPins(r.pins)) !== JSON.stringify(managedPins(saved.pins)))
  const preview = coinsChanged ? managedPreview(me.manager.stopSplit, managedPins(r.pins), r.stop) : undefined
  const pause = pauseState(me.wallets)
  const rows = splitRows(r, r.managed ? preview : draftShares(manualPins))
  // With the manager on, coins at 0% fold into one line (10-08). With it off every coin shows with its steppers: that is
  // how a free user sets their own split (device review 10-08: folding left SKR alone and looked like the only choice).
  // His note 10-08: a coin he switched off stays in the list with its switch off; only coins the manager left at 0% fold.
  const hiddenRows = showAll || !r.managed ? [] : rows.filter((row) => row.pct === 0 && row.asset !== 'SKR' && row.mode !== 'off')
  const shownRows = rows.filter((row) => !hiddenRows.includes(row))
  const showDisclosure =
    (r.managed && !saved.managed) ||
    // (stORE pinned at the 10 it already had, by the first change of the split (explicitPins, addendum 11-15), is not a first pin.)
    (!r.managed && (r.pins.stORE ?? 0) > 0 && (saved.pins.stORE ?? 0) === 0 && !(saved.pins.stORE === undefined && r.pins.stORE === STORE_FLOOR)) ||
    // 10-23: stORE switched back on with the manager off
    (!r.managed && r.pins.stORE !== 0 && saved.pins.stORE === 0)

  /** Saves the whole draft at once; if it raises the daily limit, the Seeker signs in once for all of it (R84). */
  async function saveAll() {
    setUndone(false)
    setBusy(true)
    setSigning(raises)
    setError(null)
    try {
      const reauth = raises ? await freshSignIn(freshWalletSignIn(identity)) : undefined
      const answer = await api<MeResponse['rules']>('/api/rules', {
        method: 'PUT',
        // R346: with the manager on, the only pins saved are the coins switched off (an old non-zero pin becomes "on" here).
        // 10-23: off, the split goes with its switches as `off` (without it the API reads a 0 pin as "no share", for old builds).
        body: {
          ...patch,
          // Addendum 11-15: the user's own numbers sum to 100; stORE on at 0 goes switched off (pinsToSave).
          // Device bug 11-16: on, `off` goes too, so a coin switched on (SKR included) is on at the API (saveSwitches).
          ...saveSwitches(r, explicit, 'pins' in patch || 'managed' in patch),
          ...(reauth ? { reauth } : {}),
        },
      })
      // The answer and the draft clear land together, so the screen moves once; the fresh read reconciles in the background.
      applyRules(answer, { undoAvailable: false, changedDay: null })
      clearDraft()
      void invalidate()
    } catch (e) {
      // Dev builds only: the real error for Metro's terminal (09-29: a save after the sign-in failed with only the generic line).
      if (typeof __DEV__ !== 'undefined' && __DEV__)
        console.warn(`[rules] save failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
      setError(e instanceof ApiError ? e.message : t('rules.saveFailed'))
    } finally {
      setBusy(false)
      setSigning(false)
    }
  }

  /** The one-tap undo (spec 4.5): yesterday's split back and the manager off; no sign-in. */
  async function undo() {
    setBusy(true)
    setError(null)
    try {
      const answer = await undoSplit()
      applyRules(answer, { managed: false, undoAvailable: false, changedDay: null })
      clearDraft()
      setUndone(true)
      void invalidate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('activity.undoFailed'))
    } finally {
      setBusy(false)
      setSigning(false)
    }
  }

  /** The typed rule to the watcher; its patch lands on the controls as the draft, so the existing Save confirms it. */
  async function askWatcher() {
    setAsking(true)
    setError(null)
    try {
      const r = await api<{ patch: Partial<RulesShape>; understood: string; notes: string[] }>('/api/watcher/compile', {
        method: 'POST',
        body: { text: ask.trim() },
      })
      setDraft((d) => ({ ...d, ...r.patch }))
      setWatcher({ understood: r.understood, notes: r.notes })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('rules.box.failed'))
    } finally {
      setAsking(false)
    }
  }

  return (
    <Screen
      inset="top"
      title={t('tabs.rules')}
      footer={
        dirty ? (
          <>
            {raises ? (
              <ThemedText variant="caption" tone="secondary">
                {t('rules.raises')}
              </ThemedText>
            ) : null}
            {signing ? (
              <ThemedText variant="caption" tone="secondary">
                {t('wallet.waiting')}
              </ThemedText>
            ) : null}
            {error ? <ThemedText tone="error">{error}</ThemedText> : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title={t('rules.discard')} kind="quiet" disabled={busy} onPress={clearDraft} style={{ flex: 1 }} />
              {/* Addendum 11-15: manager off, Save waits for a total of exactly 100 */}
              <Button title={t('rules.save')} loading={busy} disabled={total !== null && !total.ok} onPress={saveAll} style={{ flex: 2 }} />
            </View>
          </>
        ) : null
      }
    >
      {SHOW_BOX && (
        <Card>
          <ThemedText>{t('rules.box.title')}</ThemedText>
          <TextInput
            value={ask}
            onChangeText={setAsk}
            multiline
            maxLength={300}
            placeholder={t('rules.box.placeholder')}
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel={t('rules.box.a11y')}
            editable={!busy && !asking}
            style={{
              fontFamily: 'AlbertSans_400Regular',
              fontSize: 16,
              lineHeight: 22,
              minHeight: 48,
              borderBottomWidth: 1,
              borderBottomColor: colors.hairline,
              paddingVertical: spacing.sm,
              color: colors.text,
            }}
          />
          <Button
            title={t('rules.box.ask')}
            kind="quiet"
            loading={asking}
            disabled={busy || ask.trim() === ''}
            onPress={askWatcher}
          />
          {watcher ? <ThemedText>{[watcher.understood, ...watcher.notes].join(' ')}</ThemedText> : null}
          <ThemedText variant="caption" tone="secondary">
            {t('rules.box.note')}
          </ThemedText>
        </Card>
      )}
      {/* R448: Sprouts' own switch leads Rules; R455: this week's round-ups under it */}
      {pause.shown ? (
        <Card>
          <PauseRow
            on={pause.on}
            line={pause.line}
            detail={pause.on ? weekLine(activity.data?.swaps) : t('rules.off.detail')}
            busy={pausing}
            error={pauseError}
            onChange={togglePaused}
          />
        </Card>
      ) : null}
      <Card>
        <ThemedText variant="heading">{t('rules.roundups')}</ThemedText>
        {/* R460: any swap rounds up, the daily limit caps it; an example says what that means */}
        <Row label={t('rules.every')}>
          <Switch
            {...toggle}
            value={r.roundupOn}
            onValueChange={(v) => edit({ roundupOn: v })}
            accessibilityLabel={t('rules.every')}
          />
        </Row>
        <ThemedText variant="caption" tone="secondary" style={{ marginTop: -spacing.sm }}>
          {t('rules.every.example', { swap: formatUsd(340), saved: formatUsd(60) })}
        </ThemedText>
        {/* 0.1.10 (his rulings 11-12): swaps under $1 count when this is on; under 10 cents never does (dust) */}
        <Row label={t('rules.small', { one: chipUsd(100) })}>
          <Switch
            {...toggle}
            value={r.smallOn}
            onValueChange={(v) => edit({ smallOn: v })}
            accessibilityLabel={t('rules.small', { one: chipUsd(100) })}
          />
        </Row>
        <ThemedText variant="caption" tone="secondary" style={{ marginTop: -spacing.sm }}>
          {t('rules.small.example', { swap: formatUsd(40), saved: formatUsd(60), dust: cents(10) })}
        </ThemedText>
        {/* 0.1.10: a set amount on every swap, for small regular buys in whole dollars (a daily DCA saves nothing by rounding) */}
        <Row label={t('rules.perSwap', { amount: cents(r.perSwapCents) })}>
          <Switch
            {...toggle}
            value={r.perSwapOn}
            onValueChange={(v) => edit({ perSwapOn: v })}
            accessibilityLabel={t('rules.perSwap.a11y')}
          />
        </Row>
        {r.perSwapOn ? (
          <OptionChips options={PER_SWAP_OPTIONS} value={r.perSwapCents} format={cents} onChange={(v) => edit({ perSwapCents: v })} label={t('rules.perSwap.group')} optionLabel={(v) => t('rules.perSwap.option', { amount: cents(v) })} />
        ) : null}
        <ThemedText variant="caption" tone="secondary" style={{ marginTop: r.perSwapOn ? 0 : -spacing.sm }}>
          {t('rules.perSwap.example', { amount: cents(10), total: chipUsd(200) })}
        </ThemedText>
        <Row label={t('rules.pct', { amount: chipUsd(r.pctThresholdCents) })}>
          <Switch
            {...toggle}
            value={r.pctOn}
            onValueChange={(v) => edit({ pctOn: v })}
            accessibilityLabel={t('rules.pct.a11y')}
          />
        </Row>
        {r.pctOn ? (
          <OptionChips options={PCT_START_OPTIONS} value={r.pctThresholdCents} format={chipUsd} onChange={(v) => edit({ pctThresholdCents: v })} label={t('rules.pct.group')} optionLabel={(v) => t('rules.pct', { amount: chipUsd(v) })} />
        ) : null}
        {/* The limit as a chip; a tap opens the stepper under it. R466: the planting amount left Rules (the saved value stands). */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip
            label={t('rules.cap.chip', { amount: chipUsd(r.dailyCapCents) })}
            open={picker === 'cap'}
            onPress={() => setPicker((p) => (p === 'cap' ? null : 'cap'))}
          />
        </View>
        {picker === 'cap' ? (
          <Stepper
            label={t('rules.cap')}
            what={t('rules.cap.what')}
            value={r.dailyCapCents}
            step={100}
            min={100}
            max={500}
            format={formatUsd}
            onChange={(v) => edit({ dailyCapCents: v })}
            disabled={busy}
          />
        ) : null}
        {/* R466: what "planting" means, once, where the change is set aside */}
        <ThemedText variant="caption" tone="secondary">
          {t('rules.planted.note')}
        </ThemedText>
      </Card>
      <Card>
        <ThemedText variant="heading">{t('rules.grows')}</ThemedText>
        {/* One bar for the split: where the money goes at a glance */}
        <View
          accessible
          accessibilityLabel={rows.map((row) => t('rules.bar.item', { coin: coinNameLong(row.asset), pct: row.pct })).join(', ')}
          style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.hairline }}
        >
          {rows
            .filter((row) => row.pct > 0)
            .map((row) => (
              <View key={row.asset} style={{ flex: row.pct, backgroundColor: coinColor(row.asset) }} />
            ))}
        </View>
        <ThemedText variant="caption" tone="secondary">
          {[
            r.managed && saved.managed && !coinsChanged ? t('rules.split.today') : r.managed ? t('rules.split.after') : null,
            r.managed ? t('manager.rows.on') : t('manager.rows.off'),
            t('manager.storeFloor'),
          ]
            .filter(Boolean)
            .join(' ')}
        </ThemedText>
        {shownRows.map((row) => (
          <View
            key={row.asset}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
          >
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: coinColor(row.asset) }} />
            {/* The coin on one line; stORE's note on its own line under it (10-01 device check: it wrapped to three lines). */}
            <View style={{ flex: 1 }}>
              {/* 10-23 device check: with steppers beside it, the Pro badge ran into the percent; it wraps under the name instead. */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs }}>
                <ThemedText>{coinNameLong(row.asset)}</ThemedText>
                {/* R446: automatic lending is part of Pro (free during launch) */}
                {row.asset === 'USDC_LEND' || row.asset === 'SOL_LEND' ? <ProBadge /> : null}
              </View>
              {row.asset === 'stORE' ? (
                <ThemedText variant="caption" tone="secondary">
                  {t('manager.storeNote')}
                </ThemedText>
              ) : null}
              {row.mode !== 'off' && joinsLine(me, row.asset) ? (
                <ThemedText variant="caption" tone="secondary">
                  {joinsLine(me, row.asset)}
                </ThemedText>
              ) : null}
            </View>
            <ThemedText numeric style={{ width: 48, textAlign: 'right' }}>
              {row.pct}%
            </ThemedText>
            {/* R346, and 10-23 with the manager off too: 11-15 ruling: every coin has its switch, SKR included; at least one stays on. */}
            <Switch
              {...toggle}
              accessibilityLabel={t('rules.use', { coin: coinNameLong(row.asset) })}
              value={row.mode !== 'off'}
              disabled={busy || (row.mode !== 'off' && !canSwitchOff(r, row.asset))}
              onValueChange={(on) =>
                r.managed ? edit({ pins: setCoinOn(r.pins, row.asset, on) }) : editManual((p) => setManualCoinOn(p, row.asset, on))
              }
            />
            {!r.managed && row.mode === 'pinned' && (
              <StepButtons
                what={coinNameLong(row.asset)}
                onLess={() => editManual((p) => stepPin(p, row.asset, -1))}
                onMore={() => editManual((p) => stepPin(p, row.asset, 1))}
                lessDisabled={busy || row.pct <= 0}
                moreDisabled={busy || !canStepUp({ ...r, pins: manualPins }, row.asset)}
              />
            )}
          </View>
        ))}
        {/* Addendum 11-15: no rest; the total, and what to fix while it is not 100 */}
        {total ? (
          <ThemedText variant="caption" tone={total.ok ? 'secondary' : undefined}>
            {total.fix ? `${total.line} ${total.fix}` : total.line}
          </ThemedText>
        ) : null}
        {hiddenRows.length > 0 ? (
          <Pressable onPress={() => setShowAll(true)} accessibilityRole="button" style={{ minHeight: TARGET, justifyContent: 'center' }}>
            <ThemedText variant="caption" style={{ color: colors.accentText }}>
              {t('rules.hidden', { coins: hiddenRows.map((row) => coinNameLong(row.asset)).join(', ') })}
            </ThemedText>
          </Pressable>
        ) : null}
        <View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: spacing.xs }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ThemedText variant="heading" style={{ flex: 1 }}>
            {t('manager.switch')}
          </ThemedText>
          <ProBadge />
          <Switch
            {...toggle}
            value={r.managed}
            onValueChange={(v) => {
              if (busy) return
              if (v) {
                setExplicit(false)
                edit({ managed: true, pins: pinsForOn(r.pins) })
                return
              }
              // Device bug 11-16: off starts the manual draft from the split being planted, as explicit pins (total 100).
              const changed = r.stop !== saved.stop || JSON.stringify(managedPins(r.pins)) !== JSON.stringify(managedPins(saved.pins))
              if (!saved.managed && !changed) {
                // Switched on and back off with nothing else changed: the saved manual split, untouched, as before.
                setUndone(false)
                setExplicit(false)
                setDraft(({ managed: _m, pins: _p, ...rest }) => rest)
                return
              }
              const planted = changed ? managedPreview(me.manager.stopSplit, managedPins(r.pins), r.stop) : saved.allocation
              setExplicit(true)
              edit({ managed: false, pins: pinsForOff(planted, managedPins(r.pins)) })
            }}
            accessibilityLabel={t('manager.switch')}
          />
        </View>
        <ThemedText variant="caption" tone="secondary">
          {`${t('manager.line')} ${t('manager.proLine')}`}
        </ThemedText>
        {r.managed && (
          <>
            <TwoWay
              options={[
                { value: 'careful', label: stopLabel('careful') },
                { value: 'balanced', label: stopLabel('balanced') },
                { value: 'bold', label: stopLabel('bold') },
              ]}
              value={r.stop}
              onChange={(v) => edit({ stop: v })}
            />
            <ThemedText variant="caption" tone="secondary">
              {t('manager.stopLine')}
            </ThemedText>
          </>
        )}
        {saved.managed && me.manager.why ? (
          <View style={{ borderLeftWidth: 2, borderLeftColor: colors.hairline, paddingLeft: spacing.sm }}>
            <ThemedText variant="caption" tone="secondary">
              {me.manager.why}
            </ThemedText>
          </View>
        ) : null}
        {undone ? (
          <ThemedText variant="caption" tone="secondary">
            {t('manager.undone')}
          </ThemedText>
        ) : null}
        {!undone && me.manager.undoAvailable && undoLine(me.manager.changedDay) ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: spacing.sm,
            }}
          >
            <ThemedText variant="caption" tone="secondary">
              {undoLine(me.manager.changedDay)}
            </ThemedText>
            <Button title={t('activity.undo')} kind="quiet" loading={busy} onPress={undo} />
          </View>
        ) : null}
        {showDisclosure ? (
          <ThemedText variant="caption" tone="secondary">
            {t('ore.disclosure')}
          </ThemedText>
        ) : null}
        <VenuesPanel />
      </Card>
      {/* R348: unsaved changes get a bar fixed under the scroll (10-05: the switch looked saved while Save sat off screen). */}
      {!dirty ? (
        <View style={{ gap: spacing.sm }}>
          <ThemedText variant="caption" tone="secondary">
            {t('rules.hint')}
          </ThemedText>
          {error ? <ThemedText tone="error">{error}</ThemedText> : null}
        </View>
      ) : null}
    </Screen>
  )
}
