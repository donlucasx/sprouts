import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { TwoWay } from '@/components/TwoWay'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { api, ApiError, type LendingPosition } from '@/lib/api'
import { useInvalidateMe } from '@/lib/me'
import { makeSigner, SignRefused } from '@/lib/sign'
import { COIN_NAME } from '@/lib/format'
import {
  lendAmountProblem, lendMaxText, lendRequest, lendScreenLines, prepareLendWithdraw, withdrawLendAtTap, type LendRequest, type LendWithdrawBuild,
} from '@/lib/lend-withdraw'
import { spacing, type as ramp, useTheme } from '@/theme'

/**
 * One lending position's withdraw screen (R359), the same shape as SKR's: the position's value, All or an amount (with Max), the venue
 * line and the honest notes; Continue shows the plan (the API's brief), Withdraw builds again at the tap, the Seed Vault signs, the line
 * after is the truthful outcome. `busy` and `gate` are the Withdraw screen's own, so the hardware back and the list wait as for SKR.
 */
export function LendWithdraw(props: {
  position: LendingPosition
  user: string
  busy: boolean
  setBusy: (b: boolean) => void
  gate: { enter: () => boolean; leave: () => void }
  onBack: () => void
  onDone: (line: string) => void
}) {
  const { position: p, busy, setBusy, gate } = props
  const { colors } = useTheme()
  const { signTransaction } = useMobileWallet()
  const invalidate = useInvalidateMe()
  const [choice, setChoice] = useState<'all' | 'amount'>('all')
  const [amount, setAmount] = useState('')
  const [plan, setPlan] = useState<(LendWithdrawBuild & { request: LendRequest }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lines = lendScreenLines(p)
  const coin = COIN_NAME[p.asset]
  const problem = choice === 'amount' ? lendAmountProblem(amount, p) : null
  // A position with no rated value cannot be split on screen: All only.
  const canSplit = BigInt(p.underlyingRaw) > 0n
  const build = (body: object) => api<LendWithdrawBuild>('/api/lend/withdraw/build', { method: 'POST', body })

  async function prepare() {
    const request = lendRequest(choice, amount, p)
    if (!request) return
    setBusy(true)
    setError(null)
    try {
      const out = await prepareLendWithdraw({ position: p, request, build })
      if ('stopped' in out) setError(out.stopped)
      else setPlan({ ...out.plan, request })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not prepare the withdrawal.')
    } finally {
      setBusy(false)
    }
  }
  async function sign() {
    if (!plan || !gate.enter()) return
    setBusy(true)
    setError(null)
    try {
      const out = await withdrawLendAtTap({
        user: props.user,
        position: p,
        request: plan.request,
        shown: plan,
        build,
        sign: (flow) => makeSigner(signTransaction, flow),
        confirm: (body) => api('/api/lend/withdraw/confirm', { method: 'POST', body }),
      })
      if ('replanned' in out) {
        setPlan({ ...out.replanned, request: plan.request })
        setError(out.message)
        return
      }
      if ('stopped' in out) {
        setError(out.stopped)
        return
      }
      await invalidate()
      props.onDone(out.line)
    } catch (e) {
      setError(e instanceof ApiError || e instanceof SignRefused ? e.message : 'The withdrawal did not go through. Nothing moved.')
      // Review I1: the transaction may have landed (a 409 "may still go through", a dropped answer). Read the position again and drop the
      // plan, so a second tap is planned from the position as it is now, never the same part signed twice from the old one.
      setPlan(null)
      await invalidate().catch(() => {})
    } finally {
      gate.leave()
      setBusy(false)
    }
  }

  return (
    <Screen back onBack={busy ? () => {} : props.onBack} title={lines.title}>
      {!plan ? (
        <Card>
          <ThemedText variant="heading" numeric>
            {lines.value}
          </ThemedText>
          <ThemedText>What do you want to withdraw?</ThemedText>
          {canSplit ? (
            <TwoWay
              options={[
                { value: 'all', label: 'All of it' },
                { value: 'amount', label: 'An amount' },
              ]}
              value={choice}
              onChange={setChoice}
            />
          ) : null}
          {choice === 'amount' ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                <ThemedText numeric style={{ flex: 1 }}>
                  Available: {lines.value}
                </ThemedText>
                <Button title="Max" kind="quiet" onPress={() => setAmount(lendMaxText(p))} />
              </View>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder={`Amount in ${coin}`}
                placeholderTextColor={colors.textSecondary}
                cursorColor={colors.accent}
                selectionColor={colors.accent}
                accessibilityLabel={`Amount in ${coin}`}
                style={{ ...ramp.title, borderBottomWidth: 1, borderBottomColor: colors.hairline, paddingVertical: spacing.sm, color: colors.text }}
              />
              {problem ? (
                <ThemedText variant="caption" tone={amount.trim() === '' ? 'secondary' : 'error'}>
                  {problem}
                </ThemedText>
              ) : null}
            </>
          ) : null}
          <ThemedText tone="secondary">{lines.venue}</ThemedText>
          {lines.notes.map((n) => (
            <ThemedText key={n} variant="caption" tone={n === lines.notes[1] && lines.poolFull ? 'error' : 'secondary'}>
              {n}
            </ThemedText>
          ))}
          <Button title="Continue" disabled={busy || problem !== null} loading={busy} onPress={prepare} />
        </Card>
      ) : (
        <Card>
          <ThemedText>{plan.brief}</ThemedText>
          <Button title="Withdraw" loading={busy} onPress={sign} />
          {busy ? (
            <ThemedText variant="caption" tone="secondary">
              Waiting for your wallet.
            </ThemedText>
          ) : null}
          <Button title="Change amount" kind="quiet" disabled={busy} onPress={() => setPlan(null)} />
        </Card>
      )}
      <Button title="Back to the list" kind="quiet" disabled={busy} onPress={props.onBack} />
      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
    </Screen>
  )
}
