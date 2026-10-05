import { useState } from 'react'
import { router } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Screen } from '@/components/Screen'
import { Card } from '@/components/Card'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { api, ApiError, type MeResponse } from '@/lib/api'
import { useSession } from '@/lib/session'
import { TERMS_VERSION, termsBlocks, termsNeeded, termsSummary } from '@/lib/terms'
import { spacing } from '@/theme'

/** R283: the one plain page (the final text, verbatim), linked from Welcome, Home and Settings. A signed-in user who has not accepted this version agrees here. */
export default function Terms() {
  const { session } = useSession()
  const queryClient = useQueryClient()
  const me = queryClient.getQueryData<MeResponse>(['me'])   // the cached read only: this page also opens signed out, from Welcome
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocks = termsBlocks()
  const asks = session !== null && termsNeeded(me)
  async function accept() {
    setBusy(true)
    setError(null)
    try {
      await api('/api/terms', { method: 'POST', body: { version: TERMS_VERSION } })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      router.back()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that. Try again.')
    } finally {
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
      {asks ? (
        <Card>
          {termsSummary().map((l) => (
            <ThemedText key={l}>{`• ${l}`}</ThemedText>
          ))}
          <Button title="I agree" loading={busy} onPress={accept} />
          {error ? <ThemedText tone="error">{error}</ThemedText> : null}
        </Card>
      ) : null}
    </Screen>
  )
}
