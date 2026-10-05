import { useEffect, useState } from 'react'
import { BackHandler, Pressable, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { TwoWay } from '@/components/TwoWay'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { withdrawMode } from '@/lib/me-state'
import { amountProblem, maxAmountText, parseSkr } from '@/lib/forms'
import { api, ApiError } from '@/lib/api'
import { useMe, useInvalidateMe } from '@/lib/me'
import { useSession } from '@/lib/session'
import { makeSigner, SignRefused } from '@/lib/sign'
import { arrivalLine, formatSkr } from '@/lib/format'
import { withdrawRows } from '@/lib/withdraw-list'
import { oneAtATime, withdrawAtTap, type WithdrawPlan, type WithdrawRequest } from '@/lib/withdraw-flow'
import { withdrawLendAtTap, WITHDRAWN_LEND_LINE, type LendWithdrawBuild } from '@/lib/lend-withdraw'
import type { LendingPosition } from '@/lib/api'
import { spacing, TARGET, type as ramp, useTheme } from '@/theme'

const Waiting = () => (
  <ThemedText variant="caption" tone="secondary">
    Waiting for your Seeker.
  </ThemedText>
)

export default function Withdraw() {
  const { data: me } = useMe()
  const { session } = useSession()
  const { colors } = useTheme()
  const { signTransaction } = useMobileWallet()
  const invalidate = useInvalidateMe()
  const [chosen, setMode] = useState<'earned' | 'amount' | null>(null)
  const [amount, setAmount] = useState('')
  // The plan on screen and the request that built it; the tap builds again from the same request (round 3, item 7).
  const [plan, setPlan] = useState<(WithdrawPlan & { request: WithdrawRequest }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<'SKR' | null>(null)
  const [lendBusy, setLendBusy] = useState<string | null>(null)
  const [lendError, setLendError] = useState<{ key: string; text: string } | null>(null)
  const [lendDone, setLendDone] = useState(false)
  // One wallet action at a time across the screen (SKR withdraw, Put it back, each lending row), checked before any await.
  const [gate] = useState(oneAtATime)
  // The one way back to the coin list: "Back to the list", the top Back and Android's back all call it (R165).
  function backToList() {
    setPicked(null)
    setPlan(null)
    setMode(null)
    setAmount('')
    setError(null)
  }
  // While a coin is picked, the hardware back steps to the list like the buttons do (and waits while a request is out, as they do).
  useEffect(() => {
    if (picked === null) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busy) backToList()
      return true
    })
    return () => sub.remove()
  }, [picked, busy])
  if (!me)
    return (
      <Screen back title="Withdraw">
        <ThemedText tone="secondary">Loading your garden.</ThemedText>
      </Screen>
    )
  const skrUsd = me.pot.skrUsd
  const earned = BigInt(me.pot.skrEarnedRaw)
  const canEarned = earned >= 1_000_000n
  const mode = withdrawMode(earned, chosen)
  const held = BigInt(me.pot.skrStakedRaw)
  const problem = mode === 'amount' ? amountProblem(amount, held) : null

  const buildPlan = (request: WithdrawRequest) => api<WithdrawPlan>('/api/withdraw/build', { method: 'POST', body: request })
  async function prepare() {
    setBusy(true)
    setError(null)
    try {
      const request: WithdrawRequest = { mode, amountRaw: mode === 'amount' ? String(parseSkr(amount)) : undefined }
      setPlan({ ...(await buildPlan(request)), request })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not prepare the withdrawal.')
    } finally {
      setBusy(false)
    }
  }
  async function sign() {
    if (!plan || !session || !gate.enter()) return
    setBusy(true)
    setError(null)
    try {
      const out = await withdrawAtTap({
        request: plan.request,
        shown: plan,
        build: buildPlan,
        // Checked against the plan the tap rebuilt (its amount equals the one on screen): only those shares, from this position.
        sign: (p) => makeSigner(signTransaction, { kind: 'withdraw', user: session.pubkey, shares: p.shares }),
        confirm: (signedTransaction) => api('/api/withdraw/confirm', { method: 'POST', body: { signedTransaction } }),
      })
      if ('replanned' in out) {
        setPlan({ ...out.replanned, request: plan.request })   // the garden moved since the amount was picked: show it, tap again
        setError(out.message)
        return
      }
      await invalidate()
      router.replace('/home')
    } catch (e) {
      setError(e instanceof ApiError || e instanceof SignRefused ? e.message : 'The withdrawal did not go through. Nothing moved.')
    } finally {
      gate.leave()
      setBusy(false)
    }
  }
  async function putBack() {
    if (!session || !gate.enter()) return
    setBusy(true)
    setError(null)
    try {
      const t = await api<{ transaction: string }>('/api/withdraw/cancel/build', { method: 'POST', body: {} })
      const signed = await makeSigner(signTransaction, { kind: 'cancel', user: session.pubkey })(t.transaction)
      await api('/api/withdraw/cancel/confirm', { method: 'POST', body: { signedTransaction: signed } })
      await invalidate()
      router.replace('/home')
    } catch (e) {
      setError(e instanceof ApiError || e instanceof SignRefused ? e.message : 'Could not put it back. Try again.')
    } finally {
      gate.leave()
      setBusy(false)
    }
  }
  /** Spec 7: one tap per lending position; the Seed Vault signs only what the pinned check passes. */
  async function withdrawLend(key: string, position: LendingPosition) {
    if (!session || !gate.enter()) return
    setLendBusy(key)
    setLendError(null)
    setLendDone(false)
    try {
      const out = await withdrawLendAtTap({
        user: session.pubkey,
        position,
        build: (body) => api<LendWithdrawBuild>('/api/lend/withdraw/build', { method: 'POST', body }),
        sign: (flow) => makeSigner(signTransaction, flow),
        confirm: (body) => api('/api/lend/withdraw/confirm', { method: 'POST', body }),
      })
      if ('stopped' in out) setLendError({ key, text: out.stopped })
      else setLendDone(true)
      await invalidate()
    } catch (e) {
      setLendError({ key, text: e instanceof ApiError || e instanceof SignRefused ? e.message : 'The withdrawal did not go through. Nothing moved.' })
    } finally {
      gate.leave()
      setLendBusy(null)
    }
  }

  if (picked === null) {
    const rows = withdrawRows(me)
    return (
      <Screen back title="Withdraw">
        <Card style={{ gap: 0 }}>
          <ThemedText style={{ marginBottom: spacing.sm }}>What do you want to withdraw?</ThemedText>
          {lendDone ? <ThemedText tone="accentText">{WITHDRAWN_LEND_LINE}</ThemedText> : null}
          {rows.length === 0 ? <ThemedText tone="secondary">Nothing in your garden yet.</ThemedText> : null}
          {rows.map((r, i) => {
            const inner = (
              <>
                <View style={{ flex: 1, gap: 2 }}>
                  {r.label ? <ThemedText>{r.label}</ThemedText> : null}
                  <ThemedText numeric>{r.amount}</ThemedText>
                  <ThemedText variant="caption" tone="secondary">
                    {r.note}
                  </ThemedText>
                </View>
                {r.opens ? <MaterialCommunityIcons name="chevron-right" size={22} color={colors.accentText} /> : null}
              </>
            )
            const rowStyle = { minHeight: TARGET, flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline }
            if (r.position) {
              const p = r.position
              return (
                <View key={r.key} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.hairline, paddingVertical: spacing.sm, gap: spacing.xs }}>
                  <View style={{ minHeight: TARGET, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    {inner}
                    <Button title="Withdraw" kind="quiet" accessibilityLabel={r.label} disabled={p.poolFull || (lendBusy !== null && lendBusy !== r.key)} loading={lendBusy === r.key} onPress={() => withdrawLend(r.key, p)} />
                  </View>
                  {lendBusy === r.key ? <Waiting /> : null}
                  {lendError?.key === r.key ? <ThemedText tone="error">{lendError.text}</ThemedText> : null}
                </View>
              )
            }
            return r.opens ? (
              <Pressable key={r.key} onPress={() => setPicked('SKR')} accessibilityRole="button" accessibilityLabel={r.label} style={({ pressed }) => ({ ...rowStyle, opacity: pressed ? 0.7 : 1 })}>
                {inner}
              </Pressable>
            ) : (
              <View key={r.key} style={rowStyle}>
                {inner}
              </View>
            )
          })}
        </Card>
      </Screen>
    )
  }

  if (me.basket) {
    return (
      <Screen back onBack={busy ? () => {} : backToList} title="In the basket">
        <Card>
          <ThemedText variant="heading" numeric>
            {formatSkr(BigInt(me.basket.amountRaw), skrUsd)}
          </ThemedText>
          <ThemedText tone="secondary">
            {arrivalLine(me.basket.readyAt, new Date(), true)}. It stopped earning when you signed. One withdrawal at a time.
          </ThemedText>
          <Button title="Put it back" kind="quiet" loading={busy} onPress={putBack} />
          {busy ? <Waiting /> : null}
        </Card>
        <Button title="Back to the list" kind="quiet" disabled={busy} onPress={backToList} />
        {error ? <ThemedText tone="error">{error}</ThemedText> : null}
      </Screen>
    )
  }

  return (
    <Screen back onBack={busy ? () => {} : backToList} title="Withdraw SKR">
      {!plan ? (
        <Card>
          <ThemedText>What do you want to withdraw?</ThemedText>
          <TwoWay
            options={[
              { value: 'earned', label: 'Your earnings' },
              { value: 'amount', label: 'An amount' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <ThemedText tone="secondary">
            {mode === 'earned'
              ? 'Only your earnings. What you put in keeps earning.'
              : 'Up to everything. Going past your earnings prunes a plant.'}
          </ThemedText>
          {mode === 'earned' ? (
            <>
              <ThemedText numeric>Earned so far: {formatSkr(earned, skrUsd)}</ThemedText>
              {!canEarned ? (
                <ThemedText tone="secondary">You can withdraw once your earnings reach 1 SKR.</ThemedText>
              ) : null}
            </>
          ) : (
            <>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}
              >
                <ThemedText numeric style={{ flex: 1 }}>
                  Available: {formatSkr(held, skrUsd)}
                </ThemedText>
                <Button title="Max" kind="quiet" onPress={() => setAmount(maxAmountText(held))} />
              </View>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="Amount in SKR"
                placeholderTextColor={colors.textSecondary}
                cursorColor={colors.accent}
                selectionColor={colors.accent}
                accessibilityLabel="Amount in SKR"
                style={{
                  ...ramp.title,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.hairline,
                  paddingVertical: spacing.sm,
                  color: colors.text,
                }}
              />
              {problem ? (
                <ThemedText variant="caption" tone={amount.trim() === '' ? 'secondary' : 'error'}>
                  {problem}
                </ThemedText>
              ) : null}
            </>
          )}
          <ThemedText variant="caption" tone="secondary">
            {"It arrives in your Seeker's wallet 48 hours after you sign."}
          </ThemedText>
          <Button
            title="Continue"
            disabled={busy || (mode === 'earned' && !canEarned) || problem !== null}
            onPress={prepare}
          />
        </Card>
      ) : (
        <Card>
          {plan.brief.map((l, i) => (
            <ThemedText key={i}>{l}</ThemedText>
          ))}
          <Button title="Withdraw" kind={plan.prunes ? 'danger' : 'primary'} loading={busy} onPress={sign} />
          {busy ? <Waiting /> : null}
          <Button title="Change amount" kind="quiet" disabled={busy} onPress={() => setPlan(null)} />
        </Card>
      )}
      <Button title="Back to the list" kind="quiet" disabled={busy} onPress={backToList} />
      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
    </Screen>
  )
}
