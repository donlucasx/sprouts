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
import { formatUsd, COIN_NAME_LONG } from '@/lib/format'
import { undoSplit } from '@/lib/manager-api'
import {
  splitRows,
  setCoinOn,
  managedPins,
  managedPreview,
  stepPin,
  pinsForOn,
  undoLine,
  SWITCH_LABEL,
  MANAGER_LINE,
  PRO_LINE,
  ROWS_LINE,
  STOP_LINE,
  UNDONE_TEXT,
  STORE_ROW_NOTE,
  canStepUp,
} from '@/model/manager'
import { ORE_DISCLOSURE } from '@/lib/ore-copy'
import { rulesChanges } from '@/lib/forms'
import { pauseState } from '@/lib/me-state'
import { usePauseToggle } from '@/lib/use-pause'
import { weekLine } from '@/lib/week'
import { coinColor } from '@/lib/coin-colors'
import { PauseRow } from '@/components/PauseRow'
import { VenuesPanel } from '@/components/VenuesPanel'
import { radius, spacing, switchColors, TARGET, useTheme } from '@/theme'

type RulesShape = MeResponse['rules']

// D5: the text-to-controls box is hidden; it still compiles and its compile route still answers.
const SHOW_BOX = false as boolean

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
    <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
    {children}
  </View>
)

/** "$5" for whole dollars, "$0.10" otherwise: the chips fit side by side (device 10-08). */
const chipUsd = (c: number) => (c % 100 === 0 ? `$${c / 100}` : formatUsd(c))

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

export default function Rules() {
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
      <Screen inset="top" title="Rules">
        <ThemedText tone="secondary">Loading your rules.</ThemedText>
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
  // The ORE disclosure shows inline once: the first time the manager is switched on, or, off, the first time stORE's pin leaves zero (spec 3.1).
  // F1: switched on but not yet saved, the saved allocation is still the OFF one; the rows preview the stop's split instead.
  const unsavedOn = r.managed && !saved.managed
  // R346: the preview follows the draft's coin switches and stop; with nothing changed, the saved allocation is the truth.
  const coinsChanged =
    r.managed &&
    (unsavedOn || r.stop !== saved.stop || JSON.stringify(managedPins(r.pins)) !== JSON.stringify(managedPins(saved.pins)))
  const preview = coinsChanged ? managedPreview(me.manager.stopSplit, managedPins(r.pins), r.stop) : undefined
  const pause = pauseState(me.wallets)
  const rows = splitRows(r, preview)
  // With the manager on, coins at 0% fold into one line (10-08). With it off every coin shows with its steppers: that is
  // how a free user sets their own split (device review 10-08: folding left SKR alone and looked like the only choice).
  const hiddenRows = showAll || !r.managed ? [] : rows.filter((row) => row.pct === 0 && row.asset !== 'SKR')
  const shownRows = rows.filter((row) => !hiddenRows.includes(row))
  const showDisclosure =
    (r.managed && !saved.managed) || (!r.managed && (r.pins.stORE ?? 0) > 0 && (saved.pins.stORE ?? 0) === 0)

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
        body: { ...patch, ...(r.managed ? { pins: managedPins(r.pins) } : {}), ...(reauth ? { reauth } : {}) },
      })
      // The answer and the draft clear land together, so the screen moves once; the fresh read reconciles in the background.
      applyRules(answer, { undoAvailable: false, changedDay: null })
      setDraft({})
      void invalidate()
    } catch (e) {
      // Dev builds only: the real error for Metro's terminal (09-29: a save after the sign-in failed with only the generic line).
      if (typeof __DEV__ !== 'undefined' && __DEV__)
        console.warn(`[rules] save failed: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
      setError(e instanceof ApiError ? e.message : 'Could not save. Try again.')
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
      setDraft({})
      setUndone(true)
      void invalidate()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not undo. Try again.')
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
      setError(e instanceof ApiError ? e.message : 'Sprouts could not read that. Use the controls below.')
    } finally {
      setAsking(false)
    }
  }

  return (
    <Screen
      inset="top"
      title="Rules"
      footer={
        dirty ? (
          <>
            {raises ? (
              <ThemedText variant="caption" tone="secondary">
                Raising the daily limit asks your wallet to sign in once.
              </ThemedText>
            ) : null}
            {signing ? (
              <ThemedText variant="caption" tone="secondary">
                Waiting for your wallet.
              </ThemedText>
            ) : null}
            {error ? <ThemedText tone="error">{error}</ThemedText> : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button title="Discard" kind="quiet" disabled={busy} onPress={() => setDraft({})} style={{ flex: 1 }} />
              <Button title="Save changes" loading={busy} onPress={saveAll} style={{ flex: 2 }} />
            </View>
          </>
        ) : null
      }
    >
      {SHOW_BOX && (
        <Card>
          <ThemedText>Say it in your words</ThemedText>
          <TextInput
            value={ask}
            onChangeText={setAsk}
            multiline
            maxLength={300}
            placeholder="Plant every $5, and add 1% of swaps over $50"
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel="Your rule in plain English"
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
            title="Ask Sprouts"
            kind="quiet"
            loading={asking}
            disabled={busy || ask.trim() === ''}
            onPress={askWatcher}
          />
          {watcher ? <ThemedText>{[watcher.understood, ...watcher.notes].join(' ')}</ThemedText> : null}
          <ThemedText variant="caption" tone="secondary">
            Sprouts sets the controls below. Nothing changes until you save.
          </ThemedText>
        </Card>
      )}
      {/* R448: Sprouts' own switch leads Rules; R455: this week's round-ups under it */}
      {pause.shown ? (
        <Card>
          <PauseRow
            on={pause.on}
            line={pause.line}
            detail={pause.on ? weekLine(activity.data?.swaps) : 'Round-ups are off. Nothing moves until you turn it back on.'}
            busy={pausing}
            error={pauseError}
            onChange={togglePaused}
          />
        </Card>
      ) : null}
      <Card>
        <ThemedText variant="heading">Round-ups</ThemedText>
        {/* R460: any swap rounds up, the daily limit caps it; an example says what that means */}
        <Row label="Round up every swap">
          <Switch
            {...toggle}
            value={r.roundupOn}
            onValueChange={(v) => edit({ roundupOn: v })}
            accessibilityLabel="Round up every swap"
          />
        </Row>
        <ThemedText variant="caption" tone="secondary" style={{ marginTop: -spacing.sm }}>
          A $3.40 swap saves $0.60.
        </ThemedText>
        <Row label={`Add 1% of swaps over ${chipUsd(r.pctThresholdCents)}`}>
          <Switch
            {...toggle}
            value={r.pctOn}
            onValueChange={(v) => edit({ pctOn: v })}
            accessibilityLabel="Add 1% of larger swaps"
          />
        </Row>
        {/* The limit as a chip; a tap opens the stepper under it. R466: the planting amount left Rules (the saved value stands). */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          <Chip
            label={`Daily limit ${chipUsd(r.dailyCapCents)}`}
            open={picker === 'cap'}
            onPress={() => setPicker((p) => (p === 'cap' ? null : 'cap'))}
          />
        </View>
        {picker === 'cap' ? (
          <Stepper
            label="Daily limit"
            what="daily limit"
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
          Each morning, saved change is planted: Sprouts buys the coins in your split below.
        </ThemedText>
      </Card>
      <Card>
        <ThemedText variant="heading">Where it grows</ThemedText>
        {/* One bar for the split: where the money goes at a glance */}
        <View
          accessible
          accessibilityLabel={rows.map((row) => `${COIN_NAME_LONG[row.asset]} ${row.pct}%`).join(', ')}
          style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.hairline }}
        >
          {rows
            .filter((row) => row.pct > 0)
            .map((row) => (
              <View key={row.asset} style={{ flex: row.pct, backgroundColor: coinColor(row.asset) }} />
            ))}
        </View>
        <ThemedText variant="caption" tone="secondary">
          {saved.managed && !coinsChanged ? "Today's split. " : r.managed ? 'The split after you save. ' : ''}
          {r.managed ? ROWS_LINE.on : ROWS_LINE.off}
        </ThemedText>
        {shownRows.map((row) => (
          <View
            key={row.asset}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
          >
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: coinColor(row.asset) }} />
            {/* The coin on one line; stORE's note on its own line under it (10-01 device check: it wrapped to three lines). */}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
                <ThemedText>{COIN_NAME_LONG[row.asset]}</ThemedText>
                {/* R446: automatic lending is part of Pro (free during launch) */}
                {row.asset === 'USDC_LEND' || row.asset === 'SOL_LEND' ? <ProBadge /> : null}
              </View>
              {row.asset === 'stORE' ? (
                <ThemedText variant="caption" tone="secondary">
                  {STORE_ROW_NOTE}
                </ThemedText>
              ) : null}
            </View>
            <ThemedText numeric style={{ width: 48, textAlign: 'right' }}>
              {row.pct}%
            </ThemedText>
            {r.managed && (
              <Switch
                {...toggle}
                accessibilityLabel={`Use ${COIN_NAME_LONG[row.asset]}`}
                value={row.mode !== 'off'}
                disabled={row.asset === 'SKR'}
                onValueChange={(on) => edit({ pins: setCoinOn(r.pins, row.asset, on) })}
              />
            )}
            {!r.managed && row.mode === 'pinned' && (
              <StepButtons
                what={COIN_NAME_LONG[row.asset]}
                onLess={() => edit({ pins: stepPin(r.pins, row.asset, -1) })}
                onMore={() => edit({ pins: stepPin(r.pins, row.asset, 1) })}
                lessDisabled={busy || row.pct <= 0}
                moreDisabled={busy || !canStepUp(r, row.asset)}
              />
            )}
          </View>
        ))}
        {hiddenRows.length > 0 ? (
          <Pressable onPress={() => setShowAll(true)} accessibilityRole="button" style={{ minHeight: TARGET, justifyContent: 'center' }}>
            <ThemedText variant="caption" style={{ color: colors.accentText }}>
              {`${hiddenRows.map((row) => COIN_NAME_LONG[row.asset]).join(', ')} at 0%. Show`}
            </ThemedText>
          </Pressable>
        ) : null}
        <View style={{ height: 1, backgroundColor: colors.hairline, marginVertical: spacing.xs }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ThemedText variant="heading" style={{ flex: 1 }}>
            {SWITCH_LABEL}
          </ThemedText>
          <ProBadge />
          <Switch
            {...toggle}
            value={r.managed}
            onValueChange={(v) => edit(v ? { managed: true, pins: pinsForOn(r.pins) } : { managed: false })}
            accessibilityLabel={SWITCH_LABEL}
          />
        </View>
        <ThemedText variant="caption" tone="secondary">
          {MANAGER_LINE} {PRO_LINE}
        </ThemedText>
        {r.managed && (
          <>
            <TwoWay
              options={[
                { value: 'careful', label: 'Careful' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'bold', label: 'Bold' },
              ]}
              value={r.stop}
              onChange={(v) => edit({ stop: v })}
            />
            <ThemedText variant="caption" tone="secondary">
              {STOP_LINE}
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
            {UNDONE_TEXT}
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
            <Button title="Undo" kind="quiet" loading={busy} onPress={undo} />
          </View>
        ) : null}
        {showDisclosure ? (
          <ThemedText variant="caption" tone="secondary">
            {ORE_DISCLOSURE}
          </ThemedText>
        ) : null}
        <VenuesPanel />
      </Card>
      {/* R348: unsaved changes get a bar fixed under the scroll (10-05: the switch looked saved while Save sat off screen). */}
      {!dirty ? (
        <View style={{ gap: spacing.sm }}>
          <ThemedText variant="caption" tone="secondary">
            Change what you like, then save.
          </ThemedText>
          {error ? <ThemedText tone="error">{error}</ThemedText> : null}
        </View>
      ) : null}
    </Screen>
  )
}
