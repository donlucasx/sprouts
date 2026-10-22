import { useState } from 'react'
import { View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { api } from '@/lib/api'
import { makeSigner } from '@/lib/sign'
import { TOPUP, TopUpFailed, topUpThisPhone } from '@/lib/topup'
import { oneAtATime } from '@/lib/withdraw-flow'
import { spacing } from '@/theme'

/**
 * The SOL top-up button (10-22): one Seed Vault signature swaps this phone's wallet's SOL to `cents` of USDC. Shown wherever USDC is
 * short for THIS phone's wallet (Home's no-USDC pause, Link a wallet's note). After it lands, /api/me and /api/me/usdc are read again,
 * so the pause line and the note go by themselves. `done` is the confirmation line (Home's names the next run; Link's does not).
 */
export function TopUpButton({ user, cents, done, onDone }: { user: string; cents: number; done: (cents: number) => string; onDone?: () => void }) {
  const { signTransaction } = useMobileWallet()
  const qc = useQueryClient()
  const [gate] = useState(oneAtATime)
  const [phase, setPhase] = useState<null | 'wallet' | 'chain'>(null)
  const [line, setLine] = useState<{ text: string; error: boolean } | null>(null)

  async function topUp() {
    if (!gate.enter()) return
    setPhase('wallet')
    setLine(null)
    try {
      const outcome = await topUpThisPhone({
        user,
        cents,
        build: (c) => api<{ transaction: string; usdcRaw: string }>('/api/topup/build', { method: 'POST', body: { cents: c } }),
        sign: (flow) => makeSigner(signTransaction, flow),
        confirm: (body) => api<{ status?: string }>('/api/topup/confirm', { method: 'POST', body }),
        onSigned: () => setPhase('chain'),
      })
      setLine(outcome === 'confirmed' ? { text: done(cents), error: false } : { text: TOPUP.sent, error: false })
      if (outcome === 'confirmed') onDone?.()
    } catch (e) {
      setLine({ text: e instanceof TopUpFailed ? e.message : TOPUP.failedBefore, error: true })
    } finally {
      setPhase(null)
      gate.leave()
      // Whatever happened, read the wallet again: a top-up that landed lifts the note and (at the next run) the pause.
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['me-usdc'] })
      void qc.invalidateQueries({ queryKey: ['activity'] })
    }
  }

  const landed = line !== null && !line.error && line.text === done(cents)
  return (
    <View style={{ gap: spacing.xs }}>
      {landed ? null : <Button title={TOPUP.button(cents)} loading={phase !== null} onPress={topUp} />}
      {phase ? (
        <ThemedText variant="caption" tone="secondary">
          {phase === 'wallet' ? TOPUP.waiting : TOPUP.checking}
        </ThemedText>
      ) : landed ? null : (
        <ThemedText variant="caption" tone="secondary">
          {TOPUP.how}
        </ThemedText>
      )}
      {line ? (
        <ThemedText tone={line.error ? 'error' : 'accentText'} style={{ fontSize: 14, lineHeight: 20 }}>
          {line.text}
        </ThemedText>
      ) : null}
    </View>
  )
}
