import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Screen } from '@/components/Screen'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ThemedText } from '@/components/ThemedText'
import { api, ApiError } from '@/lib/api'
import { makeSigner } from '@/lib/sign'
import { useInvalidateMe, useMe } from '@/lib/me'
import { newlyLinked } from '@/lib/newly-linked'
import { formatWallet } from '@/lib/format'
import { useSession } from '@/lib/session'
import { FONT, spacing } from '@/theme'

/**
 * Confirms the link; when the delegation is late on chain the API answers 409 and the same code is confirmed again (no new signature,
 * no new code), so a late approval never leaves a stray delegation behind a fresh one (review I7).
 */
async function confirmWithRetries(code: string, wallet: string, signedTransaction: string) {
  let body: Record<string, string> = { code, wallet, signedTransaction }
  for (let attempt = 0; ; attempt++) {
    try {
      await api('/api/link/confirm', { method: 'POST', body })
      return
    } catch (e) {
      const late = e instanceof ApiError && e.status === 409 && e.message.includes('No delegation found')
      if (!late || attempt >= 4) throw e
      body = { code, wallet } // the approval was sent; only the delegation read is pending
      await new Promise((r) => setTimeout(r, 4_000))
    }
  }
}

export default function Connect() {
  const { session } = useSession()
  const { signTransaction } = useMobileWallet()
  const invalidate = useInvalidateMe()
  const [code, setCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: me, refetch } = useMe()
  const [before, setBefore] = useState<string[]>([])
  // Derived, not stored: the wallet that appeared since this code was made.
  const linked = code && me ? newlyLinked(before, me.wallets) : null

  // While a code is on screen, look for the wallet the web page links (the Saga, 2026-09-29: the app never noticed).
  useEffect(() => {
    if (!code || linked) return
    const t = setInterval(() => void refetch(), 4_000)
    return () => clearInterval(t)
  }, [code, linked, refetch])

  /** This phone's wallet is the trading wallet: the Seed Vault key approves the delegation for itself. */
  async function linkThisPhone() {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      const { code } = await api<{ code: string }>('/api/link/new', { method: 'POST', body: {} })
      const t = await api<{ transaction: string; cap: number }>(`/api/link/${code}?wallet=${session.pubkey}`)
      const signed = await makeSigner(signTransaction)(t.transaction)
      await confirmWithRetries(code, session.pubkey, signed)
      await invalidate()
      router.replace('/home')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The approval did not go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function codeForAnotherWallet() {
    setBusy(true)
    setError(null)
    try {
      setBefore((me?.wallets ?? []).filter((w) => w.status !== 'revoked').map((w) => w.pubkey))
      setCode((await api<{ code: string }>('/api/link/new', { method: 'POST', body: {} })).code)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not make a code. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen back title="Link a wallet">
      <ThemedText>
        Every swap from a linked wallet rounds up to the next dollar. Once a day Sprouts plants the change, up to $5.
        Approve once; revoke any time.
      </ThemedText>
      <ThemedText variant="caption" tone="secondary">
        Under a dollar of rent, refunded when you revoke. The approval itself is unlimited; the program holds it to your
        limit on chain.
      </ThemedText>
      <Card>
        <ThemedText variant="heading">{"This phone's wallet"}</ThemedText>
        <ThemedText tone="secondary">One fingerprint. Daily limit $5.</ThemedText>
        <Button title="Approve" loading={busy} onPress={linkThisPhone} />
        {busy ? (
          <ThemedText variant="caption" tone="secondary">
            Waiting for your Seeker.
          </ThemedText>
        ) : null}
      </Card>
      <Card>
        <ThemedText variant="heading">Another wallet</ThemedText>
        {linked ? (
          <View style={{ gap: spacing.sm }}>
            <ThemedText tone="accentText">{`Linked ${formatWallet(linked)}.`}</ThemedText>
            <ThemedText tone="secondary">Its swaps now round up into your garden.</ThemedText>
            <Button title="Done" onPress={() => router.replace('/home')} />
          </View>
        ) : code ? (
          <View style={{ gap: spacing.sm }}>
            <ThemedText variant="display" numeric style={{ fontFamily: FONT.displayBold, letterSpacing: 6 }}>
              {code}
            </ThemedText>
            <ThemedText tone="secondary">
              On the computer with that wallet, open sprouts.money/link, enter this code and approve. It lasts 15
              minutes, one wallet.
            </ThemedText>
            <Button title="Get a new code" kind="quiet" disabled={busy} onPress={codeForAnotherWallet} />
          </View>
        ) : (
          <Button title="Get a code" kind="quiet" disabled={busy} onPress={codeForAnotherWallet} />
        )}
      </Card>
      {error ? <ThemedText tone="error">{error}</ThemedText> : null}
    </Screen>
  )
}
