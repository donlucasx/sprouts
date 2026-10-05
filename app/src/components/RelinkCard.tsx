import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { api, ApiError, type MeResponse } from '@/lib/api'
import { makeSigner, SignRefused } from '@/lib/sign'
import { useInvalidateMe } from '@/lib/me'
import { RELINK, relinkThisPhone, relinkView, relinkWebLines } from '@/lib/relink'
import { oneAtATime } from '@/lib/withdraw-flow'
import { FONT, spacing } from '@/theme'

const short = (pk: string) => `${pk.slice(0, 4)}...${pk.slice(-4)}`

/** R287: the re-link card on Home, shown only while /api/me says relink.needed (the API turns that on at go-live, spec 6.5). */
export function RelinkCard({ me }: { me: MeResponse }) {
  const view = relinkView(me)
  const user = me.user.pubkey
  const webKey = view.web.join(',')
  const { signTransaction } = useMobileWallet()
  const invalidate = useInvalidateMe()
  const [gate] = useState(oneAtATime)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  // C6: each web wallet's leash address, derived on the phone, so the user can compare it with the one the link page shows.
  const [leashes, setLeashes] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!webKey) return
    let live = true
    void relinkWebLines(user, webKey.split(',')).then((lines) => {
      if (live) setLeashes(Object.fromEntries(lines.map((l) => [l.pubkey, l.leash])))
    })
    return () => {
      live = false
    }
  }, [user, webKey])

  async function relinkHere() {
    if (!gate.enter()) return
    setBusy(true)
    setError(null)
    try {
      await relinkThisPhone({
        user,
        build: () => api<{ transaction: string }>('/api/relink/build', { method: 'POST', body: {} }),
        sign: (flow) => makeSigner(signTransaction, flow),
        confirm: (body) => api('/api/relink/confirm', { method: 'POST', body }),
      })
      setDone(true)
      await invalidate()
    } catch (e) {
      setError(e instanceof ApiError || e instanceof SignRefused ? e.message : 'The re-link did not go through. Nothing changed.')
    } finally {
      gate.leave()
      setBusy(false)
    }
  }
  async function getCode() {
    if (!gate.enter()) return
    setBusy(true)
    setError(null)
    try {
      setCode((await api<{ code: string }>('/api/link/new', { method: 'POST', body: {} })).code)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not make a code. Try again.')
    } finally {
      gate.leave()
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Card>
        <ThemedText tone="accentText">{RELINK.done}</ThemedText>
      </Card>
    )
  }
  if (!view.show) return null
  return (
    <Card>
      <ThemedText variant="heading">{RELINK.title}</ThemedText>
      <ThemedText>{RELINK.body}</ThemedText>
      {view.thisPhone ? (
        <View style={{ gap: spacing.sm }}>
          <ThemedText tone="secondary">{RELINK.thisPhone}</ThemedText>
          <Button title={RELINK.button} loading={busy} onPress={relinkHere} />
        </View>
      ) : null}
      {view.web.map((pk) => (
        <View key={pk} style={{ gap: spacing.xs }}>
          <ThemedText tone="secondary">{RELINK.web(short(pk))}</ThemedText>
          <ThemedText variant="caption" tone="secondary">
            {RELINK.leashLine} {RELINK.compare}
          </ThemedText>
          {leashes[pk] ? (
            <ThemedText variant="caption" selectable style={{ fontFamily: FONT.label }}>
              {leashes[pk]}
            </ThemedText>
          ) : null}
        </View>
      ))}
      {view.web.length > 0 ? (
        code ? (
          <ThemedText variant="display" numeric style={{ fontFamily: FONT.displayBold, letterSpacing: 6 }}>
            {code}
          </ThemedText>
        ) : (
          <Button title="Get a code" kind="quiet" loading={busy} onPress={getCode} style={{ alignSelf: 'flex-start' }} />
        )
      ) : null}
      <ThemedText variant="caption" tone="secondary">
        {RELINK.exposed}
      </ThemedText>
      {busy ? (
        <ThemedText variant="caption" tone="secondary">
          Waiting for your Seeker.
        </ThemedText>
      ) : null}
      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
    </Card>
  )
}
