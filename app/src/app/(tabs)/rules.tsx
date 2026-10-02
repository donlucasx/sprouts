import { useState } from 'react'
import { Switch, TextInput, View } from 'react-native'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { Stepper, StepButtons } from '@/components/Stepper'
import { TwoWay } from '@/components/TwoWay'
import { api, ApiError, type MeResponse } from '@/lib/api'
import { useMe, useInvalidateMe, useApplyRules } from '@/lib/me'
import { freshSignIn } from '@/lib/signin'
import { freshWalletSignIn } from '@/lib/reauth'
import { identity } from '@/lib/identity'
import { formatUsd, COIN_NAME } from '@/lib/format'
import { undoSplit } from '@/lib/manager-api'
import {
  splitRows,
  modeWord,
  togglePin,
  stepPin,
  pinsForOn,
  undoLine,
  SWITCH_LABEL,
  MANAGER_LINE,
  STOP_LINE,
  UNDONE_TEXT,
  STORE_ROW_NOTE,
  canStepUp,
} from '@/model/manager'
import { ORE_DISCLOSURE } from '@/lib/ore-copy'
import { rulesChanges } from '@/lib/forms'
import { spacing, switchColors, useTheme } from '@/theme'

type RulesShape = MeResponse['rules']

// D5: the text-to-controls box is hidden; it still compiles and its compile route still answers.
const SHOW_BOX = false as boolean

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
    <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
    {children}
  </View>
)

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
        body: { ...patch, ...(reauth ? { reauth } : {}) },
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
    <Screen inset="top" title="Rules">
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
      <Card>
        <Row label="Round up to the next dollar">
          <Switch
            {...toggle}
            value={r.roundupOn}
            onValueChange={(v) => edit({ roundupOn: v })}
            accessibilityLabel="Round up to the next dollar"
          />
        </Row>
        <Row label={`1% on swaps of ${formatUsd(r.pctThresholdCents)} or more`}>
          <Switch
            {...toggle}
            value={r.pctOn}
            onValueChange={(v) => edit({ pctOn: v })}
            accessibilityLabel="1% on larger swaps"
          />
        </Row>
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
        <Stepper
          label="Plant at"
          what="planting amount"
          value={r.plantThresholdCents}
          step={50}
          min={50}
          max={2000}
          format={formatUsd}
          onChange={(v) => edit({ plantThresholdCents: v })}
          disabled={busy}
        />
      </Card>
      <Card>
        <ThemedText variant="heading">{SWITCH_LABEL}</ThemedText>
        <Row label="On">
          <Switch
            {...toggle}
            value={r.managed}
            onValueChange={(v) => edit(v ? { managed: true, pins: pinsForOn(r.pins) } : { managed: false })}
            accessibilityLabel={SWITCH_LABEL}
          />
        </Row>
        <ThemedText variant="caption" tone="secondary">
          {MANAGER_LINE}
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
        <ThemedText variant="heading" style={{ marginTop: spacing.xs }}>
          {saved.managed ? "Today's split" : r.managed ? 'The split after you save' : 'Your split'}
        </ThemedText>
        {splitRows(r, unsavedOn ? me.manager.stopSplit : undefined).map((row) => (
          <View
            key={row.asset}
            style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs }}
          >
            {/* The coin on one line; stORE's note on its own line under it (10-01 device check: it wrapped to three lines). */}
            <View style={{ flex: 1 }}>
              <ThemedText>{COIN_NAME[row.asset]}</ThemedText>
              {row.asset === 'stORE' ? (
                <ThemedText variant="caption" tone="secondary">
                  {STORE_ROW_NOTE}
                </ThemedText>
              ) : null}
            </View>
            <ThemedText numeric style={{ width: 48, textAlign: 'right' }}>
              {row.pct}%
            </ThemedText>
            {modeWord(row, r.managed) !== '' && (
              <ThemedText variant="caption" tone="secondary">
                {modeWord(row, r.managed)}
              </ThemedText>
            )}
            {r.managed && (
              <Switch
                {...toggle}
                accessibilityLabel={`Pin ${COIN_NAME[row.asset]}`}
                value={row.mode === 'pinned'}
                onValueChange={(on) => edit({ pins: togglePin(r.pins, row.asset, on, row.pct) })}
              />
            )}
            {row.mode === 'pinned' && (
              <StepButtons
                what={COIN_NAME[row.asset]}
                onLess={() => edit({ pins: stepPin(r.pins, row.asset, -1) })}
                onMore={() => edit({ pins: stepPin(r.pins, row.asset, 1) })}
                lessDisabled={busy || row.pct <= 0}
                moreDisabled={busy || !canStepUp(r, row.asset)}
              />
            )}
          </View>
        ))}
        {saved.managed && me.manager.why ? (
          <ThemedText style={{ marginTop: spacing.xs }}>{me.manager.why}</ThemedText>
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
              marginTop: spacing.xs,
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
      </Card>
      {/* The save and its reason sit under the last control (audit fix F5). */}
      <View style={{ gap: spacing.sm }}>
        {dirty ? (
          <>
            {raises ? (
              <ThemedText variant="caption" tone="secondary">
                Raising the daily limit asks your Seeker to sign in once.
              </ThemedText>
            ) : null}
            <Button title="Save changes" loading={busy} onPress={saveAll} />
            {signing ? (
              <ThemedText variant="caption" tone="secondary">
                Waiting for your Seeker.
              </ThemedText>
            ) : null}
            <Button title="Discard" kind="quiet" disabled={busy} onPress={() => setDraft({})} />
          </>
        ) : (
          <ThemedText variant="caption" tone="secondary">
            Change what you like, then save.
          </ThemedText>
        )}
        {error ? <ThemedText tone="error">{error}</ThemedText> : null}
      </View>
    </Screen>
  )
}
