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
import { TERMS_VERSION, agreedLine, termsAction, termsPage, termsSummary, termsText, withAccepted } from '@/lib/terms'
import { spacing } from '@/theme'
import { useLang } from '@/i18n/useLang'
import { t } from '@/i18n'

/** R283: the one plain page (the final text, verbatim), linked from Welcome, Home and Settings. A signed-in user who has not accepted this version agrees here. */
export default function Terms() {
  const lang = useLang()
  // P10: Spanish shows the courtesy translation, one tap from the binding English. Accepting is the same version either way.
  const [binding, setBinding] = useState(false)
  const md = termsText(lang, binding)
  const { session } = useSession()
  const queryClient = useQueryClient()
  // The same read Home's card is driven by: the live read, or the last verified one when the live fetch failed.
  const me = useMe().data ?? readLastMe()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const page = termsPage(md)
  // Controller ruling (Task 11 review, risk 3): the card only. New sign-ins accept at /api/auth/verify; there is no hard block on other screens.
  const action = session !== null ? termsAction(me) : null
  async function accept() {
    // termsAction only offers "agree" when the API's version is at or below the bundled version; accept posts the API's own version.
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
      setError(ctl.signal.aborted ? t('terms.slow') : e instanceof ApiError ? e.message : t('terms.saveFailed'))
    } finally {
      clearTimeout(timer)
      setBusy(false)
    }
  }
  return (
    <Screen back title={page.title}>
      {lang === 'es' ? (
        <Button kind="quiet" title={binding ? t('terms.readSpanish') : t('terms.readEnglish')} onPress={() => setBinding((b) => !b)} />
      ) : null}
      {page.body.map((b, i) =>
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
          {termsSummary(md).map((l) => (
            <ThemedText key={l}>{`• ${l}`}</ThemedText>
          ))}
          {action === 'agree' ? (
            <Button title={t('terms.agree')} loading={busy} onPress={accept} />
          ) : (
            <ThemedText>{t('terms.update')}</ThemedText>
          )}
          {error ? <ThemedText tone="error">{error}</ThemedText> : null}
        </Card>
      ) : null}
      {action === null && session !== null && agreedLine(me) ? <ThemedText variant="caption" tone="secondary">{agreedLine(me)}</ThemedText> : null}
    </Screen>
  )
}
