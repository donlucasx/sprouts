import { useState } from 'react'
import { View } from 'react-native'
import { getBase58Decoder, type Address, type Signature, type Transaction } from '@solana/kit'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Card } from './Card'
import { Button } from './Button'
import { ThemedText } from './ThemedText'
import { api, ApiError, type MeResponse } from '@/lib/api'
import { makeBatchSigner, SignRefused } from '@/lib/sign'
import { useInvalidateMe } from '@/lib/me'
import { MOVE_FAILED, MOVED_LINE, moveAtTap, moveCopy, MoveSent, type MoveBuild } from '@/lib/moves'
import { partialUnwrap, UNWRAP_BUTTON, UNWRAP_DONE, UNWRAP_FAILED, UNWRAP_SENT, unwrapAfterError, unwrapAtTap, wsolAccount } from '@/lib/unwrap'
import { oneAtATime } from '@/lib/withdraw-flow'
import { spacing } from '@/theme'

/** R258, R280: at most one move card, only when the API proposes one (no faked card, spec 7); one approval for both transactions (S3). */
export function MoveCard({ me }: { me: MeResponse }) {
  const p = me.moveProposal ?? null
  const { signTransactions, signAndSendTransactions, client } = useMobileWallet()
  const invalidate = useInvalidateMe()
  const [gate] = useState(oneAtATime)
  // The Move tap's phase: the Seeker is asked, then (signatures back) the API sends both and waits.
  const [phase, setPhase] = useState<null | 'seeker' | 'chain' | 'dismiss'>(null)
  const [line, setLine] = useState<{ text: string; error: boolean } | null>(null)
  // The proposal this card is done with (moved or dismissed): hidden at once, before the refetch drops it.
  const [gone, setGone] = useState<string | null>(null)
  // A SOL move that redeemed but could not deposit: the API's one-instruction unwrap, offered once (it carries a blockhash, so one try).
  const [unwrap, setUnwrap] = useState<string | null>(null)
  const [unwrapping, setUnwrapping] = useState(false)
  const [unwrapAt, setUnwrapAt] = useState(0)

  async function move() {
    if (!p || !gate.enter()) return
    setPhase('seeker')
    setLine(null)
    try {
      const out = await moveAtTap({
        user: me.user.pubkey,
        proposal: p,
        positions: me.positions,
        build: (id) => api<MoveBuild>('/api/moves/build', { method: 'POST', body: { id } }),
        signAll: (flows) => makeBatchSigner((txs) => signTransactions(txs) as Promise<Transaction[]>, flows),
        confirm: (body) => api('/api/moves/confirm', { method: 'POST', body }),
        onSigned: () => setPhase('chain'),
      })
      if ('stopped' in out) setLine({ text: out.stopped, error: true })
      else {
        setGone(p.id)
        setLine({ text: MOVED_LINE, error: false })
      }
    } catch (e) {
      const u = partialUnwrap(e)
      setUnwrap(u)
      setUnwrapAt(Date.now())
      setLine({ text: e instanceof ApiError || e instanceof SignRefused || e instanceof MoveSent ? e.message : MOVE_FAILED, error: true })
    } finally {
      setPhase(null)
      gate.leave()
      void invalidate()
    }
  }
  async function unwrapSol() {
    if (!unwrap || !gate.enter()) return
    setUnwrapping(true)
    try {
      const out = await unwrapAtTap({
        user: me.user.pubkey,
        transaction: unwrap,
        signAndSend: async (tx) => getBase58Decoder().decode(await signAndSendTransactions(tx, 0n)),
        status: async (sig) => {
          const v = (await client.rpc.getSignatureStatuses([sig as Signature]).send()).value[0]
          if (!v) return 'pending'
          if (v.err) return 'failed'
          return v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized' ? 'confirmed' : 'pending'
        },
      })
      // Sent: the one try is spent either way (a retry would be a second send of the same transaction).
      setUnwrap(null)
      if (out === 'confirmed') setLine({ text: UNWRAP_DONE, error: false })
      else if (out === 'failed') setLine({ text: UNWRAP_FAILED, error: true })
      else setLine({ text: UNWRAP_SENT, error: false })
      void invalidate()
    } catch (e) {
      // Read state, not the error (unwrapAfterError): only a refusal or the wallet's explicit decline means nothing was sent.
      const r = await unwrapAfterError({
        error: e,
        ageMs: Date.now() - unwrapAt,
        accountExists: async () => (await client.rpc.getAccountInfo((await wsolAccount(me.user.pubkey)) as Address, { encoding: 'base64' }).send()).value !== null,
      })
      if (!r.keepButton) setUnwrap(null)
      setLine({ text: r.text, error: r.error })
      if (r.invalidate) void invalidate()
    } finally {
      setUnwrapping(false)
      gate.leave()
    }
  }
  async function dismiss() {
    if (!p || !gate.enter()) return
    setPhase('dismiss')
    setLine(null)
    try {
      await api('/api/moves/dismiss', { method: 'POST', body: { id: p.id } })
      setGone(p.id)
      void invalidate()
    } catch (e) {
      setLine({ text: e instanceof ApiError ? e.message : 'Could not dismiss it. Try again.', error: true })
    } finally {
      setPhase(null)
      gate.leave()
    }
  }

  if (!p || p.id === gone)
    return line || unwrap ? (
      <View style={{ gap: spacing.sm }}>
        {line ? <ThemedText tone={line.error ? 'error' : 'accentText'}>{line.text}</ThemedText> : null}
        {unwrap ? <Button title={UNWRAP_BUTTON} loading={unwrapping} disabled={unwrapping} onPress={unwrapSol} /> : null}
      </View>
    ) : null
  const c = moveCopy(p)
  return (
    <Card>
      <ThemedText variant="heading">{c.title}</ThemedText>
      <ThemedText tone="secondary">{c.line}</ThemedText>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <Button title="Move" loading={phase === 'seeker' || phase === 'chain'} disabled={phase !== null} onPress={move} />
        <Button title="Not now" kind="quiet" loading={phase === 'dismiss'} disabled={phase !== null} onPress={dismiss} />
      </View>
      {phase === 'seeker' || phase === 'chain' ? (
        <ThemedText variant="caption" tone="secondary">
          {phase === 'seeker' ? 'Waiting for your Seeker.' : 'Moving. This can take a minute.'}
        </ThemedText>
      ) : null}
      {line ? <ThemedText tone={line.error ? 'error' : 'accentText'}>{line.text}</ThemedText> : null}
      {unwrap ? <Button title={UNWRAP_BUTTON} loading={unwrapping} disabled={unwrapping || phase !== null} onPress={unwrapSol} /> : null}
    </Card>
  )
}
