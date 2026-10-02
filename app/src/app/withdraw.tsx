import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { router } from 'expo-router'
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
import { makeSigner } from '@/lib/sign'
import { formatSkr } from '@/lib/format'
import { FONT, spacing, useTheme } from '@/theme'

type Plan = { transaction: string; shares: string; amountRaw: string; prunes: boolean; brief: string[] }

const Waiting = () => (
  <ThemedText variant="caption" tone="secondary">
    Waiting for your Seeker.
  </ThemedText>
)

export default function Withdraw() {
  const { data: me } = useMe()
  const { colors } = useTheme()
  const { signTransaction } = useMobileWallet()
  const invalidate = useInvalidateMe()
  const [chosen, setMode] = useState<'earned' | 'amount' | null>(null)
  const [amount, setAmount] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  async function prepare() {
    setBusy(true)
    setError(null)
    try {
      const amountRaw = mode === 'amount' ? String(parseSkr(amount)) : undefined
      setPlan(await api<Plan>('/api/withdraw/build', { method: 'POST', body: { mode, amountRaw } }))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not prepare the withdrawal.')
    } finally {
      setBusy(false)
    }
  }
  async function sign() {
    if (!plan) return
    setBusy(true)
    setError(null)
    try {
      const signed = await makeSigner(signTransaction)(plan.transaction)
      await api('/api/withdraw/confirm', { method: 'POST', body: { signedTransaction: signed } })
      await invalidate()
      router.replace('/home')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The withdrawal did not go through. Nothing moved.')
    } finally {
      setBusy(false)
    }
  }
  async function putBack() {
    setBusy(true)
    setError(null)
    try {
      const t = await api<{ transaction: string }>('/api/withdraw/cancel/build', { method: 'POST', body: {} })
      const signed = await makeSigner(signTransaction)(t.transaction)
      await api('/api/withdraw/cancel/confirm', { method: 'POST', body: { signedTransaction: signed } })
      await invalidate()
      router.replace('/home')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not put it back. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (me.basket) {
    return (
      <Screen back title="In the basket">
        <Card>
          <ThemedText variant="heading" numeric>
            {formatSkr(BigInt(me.basket.amountRaw), skrUsd)}
          </ThemedText>
          <ThemedText tone="secondary">
            Arrives{' '}
            {new Date(me.basket.readyAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })}.
            It stopped earning when you signed. One withdrawal at a time until it arrives.
          </ThemedText>
          <Button title="Put it back" kind="quiet" loading={busy} onPress={putBack} />
          {busy ? <Waiting /> : null}
        </Card>
        {error ? <ThemedText tone="error">{error}</ThemedText> : null}
      </Screen>
    )
  }

  return (
    <Screen back title="Withdraw">
      {!plan ? (
        <Card>
          <ThemedText>What do you want to take out?</ThemedText>
          <TwoWay
            options={[
              { value: 'earned', label: 'What it earned' },
              { value: 'amount', label: 'An amount' },
            ]}
            value={mode}
            onChange={setMode}
          />
          <ThemedText tone="secondary">
            {mode === 'earned'
              ? 'Only what your garden earned. What you put in stays planted and keeps earning.'
              : 'Any amount, up to everything in your garden. Taking more than it earned prunes a plant.'}
          </ThemedText>
          {mode === 'earned' ? (
            <>
              <ThemedText numeric>Earned so far: {formatSkr(earned, skrUsd)}</ThemedText>
              {!canEarned ? (
                <ThemedText tone="secondary">You can withdraw once your earned SKR reaches 1 SKR.</ThemedText>
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
                accessibilityLabel="Amount in SKR"
                style={{
                  fontFamily: FONT.display,
                  fontSize: 28,
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
            {"It reaches your Seeker's wallet 48 hours after you sign."}
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
          <Button title="Back" kind="quiet" disabled={busy} onPress={() => setPlan(null)} />
        </Card>
      )}
      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
    </Screen>
  )
}
