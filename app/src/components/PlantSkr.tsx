import { useState } from 'react'
import { View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { TwoWay } from '@/components/TwoWay'
import { api } from '@/lib/api'
import { makeSigner } from '@/lib/sign'
import { oneAtATime } from '@/lib/withdraw-flow'
import { PLANT_DEFAULT, PlantFailed, plantAmountRaw, plantOptions, plantSkrThisPhone, plantUsdText, skrAmountText, type IdleSkr, type PlantShare } from '@/lib/plant-skr'
import { t } from '@/i18n'
import { useLang } from '@/i18n/useLang'
import { radius, spacing, useTheme } from '@/theme'
import type { Key } from '@/i18n/en'

/** 11-27 (his ruling): what staking here is, as three chips in place of a sentence. */
export const STAKE_CHIPS: readonly Key[] = ['plant.chip.noSwap', 'plant.chip.earns', 'plant.chip.unstake']

/**
 * 0.1.13 Stake SKR (his rulings 11-25; renamed from "Plant my SKR" 11-27): the SKR coin sheet's section. [25%] [50%] [All], All picked
 * first, no typing; the amount and its dollars; the button; three chips (No swap, Earns staking, 48 h to unstake). One Seed Vault signature stakes this wallet's own SKR into its garden position. After any
 * outcome /api/me and Activity are read again, so the marker goes once the SKR is planted (and a 409 "balance changed" re-offers).
 */
export function PlantSkr({ user, idle }: { user: string; idle: IdleSkr | null }) {
  const lang = useLang()
  const { colors } = useTheme()
  // After a planting /api/me answers no idle SKR (the marker goes); the outcome line stays on screen until the sheet closes.
  const options = idle ? plantOptions(idle) : []
  const [share, setShare] = useState<PlantShare>(PLANT_DEFAULT)
  const picked = options.some((o) => o.value === share) ? share : (options[options.length - 1]?.value ?? PLANT_DEFAULT)
  const amountRaw = idle ? plantAmountRaw(idle.raw, picked) : 0n
  const amount = skrAmountText(amountRaw)
  const { signTransaction } = useMobileWallet()
  const qc = useQueryClient()
  const [gate] = useState(oneAtATime)
  const [phase, setPhase] = useState<null | 'wallet' | 'chain'>(null)
  const [line, setLine] = useState<{ text: string; error: boolean } | null>(null)
  const [landed, setLanded] = useState(false)

  async function plant() {
    if (!gate.enter()) return
    setPhase('wallet')
    setLine(null)
    const shown = amount
    try {
      const outcome = await plantSkrThisPhone({
        user,
        amountRaw,
        build: (body) => api<{ transaction: string; amountRaw: string }>('/api/stake/build', { method: 'POST', body }),
        sign: (flow) => makeSigner(signTransaction, flow),
        confirm: (body) => api<{ status?: string }>('/api/stake/confirm', { method: 'POST', body }),
        onSigned: () => setPhase('chain'),
      })
      setLine({ text: outcome === 'confirmed' ? t('plant.done', { amount: shown }) : t('plant.sent'), error: false })
      if (outcome === 'confirmed') setLanded(true)
    } catch (e) {
      setLine({ text: e instanceof PlantFailed ? e.message : t('plant.failedBefore'), error: true })
    } finally {
      setPhase(null)
      gate.leave()
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['me-usdc'] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
    }
  }

  if ((!idle || options.length === 0) && !line) return null
  return (
    <View style={{ gap: spacing.xs }}>
      <ThemedText variant="label" tone="secondary">
        {t('plant.title')}
      </ThemedText>
      {landed || !idle || options.length === 0 ? null : (
        <>
          {phase || options.length < 2 ? null : <TwoWay options={options} value={picked} onChange={(v) => setShare(v)} />}
          <ThemedText variant="body" numeric>
            {t('plant.amount', { amount, usd: plantUsdText(amountRaw, idle) })}
          </ThemedText>
          <Button title={t('plant.button', { amount })} loading={phase !== null} onPress={plant} />
          {phase ? (
            <ThemedText variant="caption" tone="secondary">
              {phase === 'wallet' ? t('wallet.waiting') : t('wallet.checking')}
            </ThemedText>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
              {STAKE_CHIPS.map((k) => (
                <View key={k} style={{ paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full, borderWidth: 1, borderColor: colors.hairline }}>
                  <ThemedText variant="caption" tone="secondary">
                    {t(k, undefined, lang)}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </>
      )}
      {line ? (
        <ThemedText tone={line.error ? 'error' : 'accentText'} style={{ fontSize: 14, lineHeight: 20 }}>
          {line.text}
        </ThemedText>
      ) : null}
    </View>
  )
}
