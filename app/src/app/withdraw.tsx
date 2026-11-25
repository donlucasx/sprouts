import { useEffect, useState } from 'react'
import { BackHandler, Pressable, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
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
import { droppedNothingSent, isSessionDropped } from '@/lib/wallet-errors'
import { arrivalParts, formatSkr } from '@/lib/format'
import { withdrawRows } from '@/lib/withdraw-list'
import { oneAtATime, withdrawAtTap, type WithdrawPlan, type WithdrawRequest } from '@/lib/withdraw-flow'
import { LendWithdraw } from '@/components/LendWithdraw'
import { spacing, TARGET, type as ramp, useTheme } from '@/theme'
import { t } from '@/i18n'
import { useLang } from '@/i18n/useLang'

const Waiting = () => {
  useLang()
  return (
  <ThemedText variant="caption" tone="secondary">
    {t('wallet.waiting')}
  </ThemedText>
  )
}

export default function Withdraw() {
  // P1 carry-over (Kimi): this screen renders formatSkr and the arrival line, so a language change must re-render it
  useLang()
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
  // 'SKR' or a lending position's row key ("USDC_LEND:jupiter_lend"): every withdrawal opens its own screen (R359).
  // R564: Home's coin sheet opens this screen on its coin (?pick=<row key>); a key that is not a withdraw row lands on the list.
  const { pick } = useLocalSearchParams<{ pick?: string }>()
  const [picked, setPicked] = useState<string | null>(typeof pick === 'string' && pick.length > 0 ? pick : null)
  const [lendDone, setLendDone] = useState<string | null>(null)
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
      <Screen back title={t('home.withdraw')}>
        <ThemedText tone="secondary">{t('withdraw.loading')}</ThemedText>
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
      setError(e instanceof ApiError ? e.message : t('withdraw.prepareFailed'))
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
      setError(e instanceof ApiError || e instanceof SignRefused ? e.message : isSessionDropped(e) ? droppedNothingSent() : t('withdraw.failed'))
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
      const built = await api<{ transaction: string }>('/api/withdraw/cancel/build', { method: 'POST', body: {} })
      const signed = await makeSigner(signTransaction, { kind: 'cancel', user: session.pubkey })(built.transaction)
      await api('/api/withdraw/cancel/confirm', { method: 'POST', body: { signedTransaction: signed } })
      await invalidate()
      router.replace('/home')
    } catch (e) {
      setError(e instanceof ApiError || e instanceof SignRefused ? e.message : isSessionDropped(e) ? droppedNothingSent() : t('withdraw.putBackFailed'))
    } finally {
      gate.leave()
      setBusy(false)
    }
  }
  // A picked lending position that is gone (withdrawn in full, or moved since) shows the list.
  const pickedGone = picked !== null && picked !== 'SKR' && !withdrawRows(me).some((r) => r.key === picked && r.position)
  if (picked === null || pickedGone) {
    const rows = withdrawRows(me)
    return (
      <Screen back title={t('home.withdraw')}>
        <Card style={{ gap: 0 }}>
          <ThemedText style={{ marginBottom: spacing.sm }}>{t('withdraw.what')}</ThemedText>
          {lendDone ? <ThemedText tone="accentText">{lendDone}</ThemedText> : null}
          {rows.length === 0 ? <ThemedText tone="secondary">{t('withdraw.empty')}</ThemedText> : null}
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
            return r.opens ? (
              <Pressable key={r.key} onPress={() => { setLendDone(null); setPicked(r.key) }} accessibilityRole="button" accessibilityLabel={r.label} style={({ pressed }) => ({ ...rowStyle, opacity: pressed ? 0.7 : 1 })}>
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

  if (picked !== 'SKR') {
    const position = withdrawRows(me).find((r) => r.key === picked)?.position
    // The position is gone (withdrawn in full, or moved): back to the list.
    if (!position || !session)
      return (
        <Screen back onBack={backToList} title={t('home.withdraw')}>
          <ThemedText tone="secondary">{t('withdraw.loading')}</ThemedText>
        </Screen>
      )
    return (
      <LendWithdraw
        key={picked}
        position={position}
        user={session.pubkey}
        busy={busy}
        setBusy={setBusy}
        gate={gate}
        onBack={backToList}
        onDone={(line) => {
          backToList()
          setLendDone(line)
        }}
      />
    )
  }

  if (me.basket) {
    return (
      <Screen back onBack={busy ? () => {} : backToList} title={t('withdraw.basket.title')}>
        <Card>
          <ThemedText variant="heading" numeric>
            {formatSkr(BigInt(me.basket.amountRaw), skrUsd)}
          </ThemedText>
          <ThemedText tone="secondary">
            {(() => {
              const a = arrivalParts(me.basket.readyAt, new Date())
              return a.today ? t('withdraw.basket.today') : t('withdraw.basket.arrives', { when: a.when })
            })()}
          </ThemedText>
          <Button title={t('withdraw.putBack')} kind="quiet" loading={busy} onPress={putBack} />
          {busy ? <Waiting /> : null}
        </Card>
        <Button title={t('withdraw.backToList')} kind="quiet" disabled={busy} onPress={backToList} />
        {error ? <ThemedText tone="error">{error}</ThemedText> : null}
      </Screen>
    )
  }

  return (
    <Screen back onBack={busy ? () => {} : backToList} title={t('withdraw.skr')}>
      {!plan ? (
        <Card>
          <ThemedText>{t('withdraw.what')}</ThemedText>
          <TwoWay
            options={[
              { value: 'earned', label: t('withdraw.earnings') },
              { value: 'amount', label: t('withdraw.anAmount') },
            ]}
            value={mode}
            onChange={setMode}
          />
          <ThemedText tone="secondary">
            {mode === 'earned'
              ? t('withdraw.earnedOnly')
              : t('withdraw.upTo')}
          </ThemedText>
          {mode === 'earned' ? (
            <>
              <ThemedText numeric>{t('withdraw.earnedSoFar', { amount: formatSkr(earned, skrUsd) })}</ThemedText>
              {!canEarned ? (
                <ThemedText tone="secondary">{t('withdraw.min1')}</ThemedText>
              ) : null}
            </>
          ) : (
            <>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}
              >
                <ThemedText numeric style={{ flex: 1 }}>
                  {t('withdraw.available', { amount: formatSkr(held, skrUsd) })}
                </ThemedText>
                <Button title={t('withdraw.max')} kind="quiet" onPress={() => setAmount(maxAmountText(held))} />
              </View>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder={t('withdraw.amountIn', { coin: 'SKR' })}
                placeholderTextColor={colors.textSecondary}
                cursorColor={colors.accent}
                selectionColor={colors.accent}
                accessibilityLabel={t('withdraw.amountIn', { coin: 'SKR' })}
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
            {t('withdraw.48h')}
          </ThemedText>
          <Button
            title={t('withdraw.continue')}
            disabled={busy || (mode === 'earned' && !canEarned) || problem !== null}
            onPress={prepare}
          />
        </Card>
      ) : (
        <Card>
          {plan.brief.map((l, i) => (
            <ThemedText key={i}>{l}</ThemedText>
          ))}
          <Button title={t('home.withdraw')} kind={plan.prunes ? 'danger' : 'primary'} loading={busy} onPress={sign} />
          {busy ? <Waiting /> : null}
          <Button title={t('withdraw.changeAmount')} kind="quiet" disabled={busy} onPress={() => setPlan(null)} />
        </Card>
      )}
      <Button title={t('withdraw.backToList')} kind="quiet" disabled={busy} onPress={backToList} />
      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
    </Screen>
  )
}
