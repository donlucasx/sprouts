import { useState } from 'react'
import { router } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { api, ApiError, type MeResponse } from '@/lib/api'
import { useSession } from '@/lib/session'
import { readLastMe, useMe, writeLastMe } from '@/lib/me'
import { TERMS_VERSION, termsAction, termsBlocks, termsSummary, withAccepted } from '@/lib/terms'
import { spacing } from '@/theme'

/** R283: the one plain page (the final text, verbatim), linked from Welcome, Home and Settings. A signed-in user who has not accepted this version agrees here. */
export default function Terms() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  // The same read Home's card is driven by: the live read, or the last verified one when the live fetch failed.
  const me = useMe().data ?? readLastMe()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocks = termsBlocks()
  // Controller ruling (Task 11 review, risk 3): the card only. New sign-ins accept at /api/auth/verify; there is no hard block on other screens.
  const action = session !== null ? termsAction(me) : null
  async function accept() {
    // Post the version the API asks for (termsAction only offers "agree" when it is the bundled one).
    const version = me?.terms?.currentVersion ?? TERMS_VERSION
    setBusy(true)
    setError(null)
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 15000)
    try {
      await api('/api/terms', { method: 'POST', body: { version }, signal: ctl.signal })
      // Put the accepted version straight into the cached read (and the saved last read) so Home moves at once; reconcile in the background.
      queryClient.setQueryData<MeResponse>(['me'], (old) => (old ? withAccepted(old, version) : old))
      const last = readLastMe()
      if (last) writeLastMe(withAccepted(last, version))
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      router.back()
    } catch (e) {
      setError(ctl.signal.aborted ? 'That took too long. Try again.' : e instanceof ApiError ? e.message : 'Could not save that. Try again.')
    } finally {
      clearTimeout(timer)
      setBusy(false)
    }
  }
  return (
    <Screen back title={blocks[0]?.text}>
      {blocks.slice(1).map((b, i) =>
        b.kind === 'heading' ? (
          <ThemedText key={i} variant="heading" style={{ marginTop: spacing.sm }}>
            {b.text}
          </ThemedText>
        ) : (
          <ThemedText key={i}>{b.kind === 'bullet' ? `• ${b.text}` : b.text}</ThemedText>
        ),
      )}
      {action !== null ? (
        <Card>
          {termsSummary().map((l) => (
            <ThemedText key={l}>{`• ${l}`}</ThemedText>
          ))}
          {action === 'agree' ? (
            <Button title="I agree" loading={busy} onPress={accept} />
          ) : (
            <ThemedText>Update the app to read the new Terms.</ThemedText>
          )}
          {error ? <ThemedText tone="error">{error}</ThemedText> : null}
        </Card>
      ) : null}
    </Screen>
  )
}
