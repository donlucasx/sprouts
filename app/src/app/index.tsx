import { useState } from 'react'
import { View } from 'react-native'
import { Redirect, router } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { freshWalletSignIn } from '@/lib/reauth'
import { identity } from '@/lib/identity'
import { Screen } from '@/components/Screen'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { Lockup } from '@/components/Lockup'
import { useSession } from '@/lib/session'
import { signInWithSeeker } from '@/lib/signin'
import { isSessionDropped, isWalletDeclined } from '@/lib/wallet-errors'
import { ApiError } from '@/lib/api'
import { spacing } from '@/theme'
import { SLOGAN } from '@/lib/slogan'
import { termsSummary } from '@/lib/terms'

/** Welcome, the manual's specimen (section 7): the stacked lockup, the slogan under it in Albert Sans 500 at half the word size, the one button. */
export default function Welcome() {
  const { session, setSession } = useSession()
  const [busy, setBusy] = useState(false)
  const { disconnect } = useMobileWallet()
  const [error, setError] = useState<string | null>(null)
  if (session) return <Redirect href="/home" />
  return (
    <Screen scroll={false}>
      <View
        style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.xl, paddingBottom: spacing.xxl }}
      >
        <Lockup wordSize={40} />
        <ThemedText variant="label" style={{ fontSize: 20, lineHeight: 28, textAlign: 'center', maxWidth: 320 }}>
          {SLOGAN}
        </ThemedText>
        {/* R283: signing in accepts the Terms; the three lines say what, the full page is one tap away */}
        <View style={{ alignSelf: 'stretch', gap: spacing.xs }}>
          <ThemedText variant="caption" tone="secondary">
            By signing in you agree to the Terms and Privacy:
          </ThemedText>
          {termsSummary().map((l) => (
            <ThemedText key={l} variant="caption" tone="secondary">
              {`• ${l}`}
            </ThemedText>
          ))}
          <Button title="Read the Terms and Privacy" kind="quiet" onPress={() => router.push('/terms')} style={{ alignSelf: 'flex-start' }} />
        </View>
        <View style={{ alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.lg }}>
          <Button
            title="Sign in with your Seeker"
            loading={busy}
            onPress={async () => {
              setBusy(true)
              setError(null)
              try {
                // The token-free authorize (reauth.ts): the kit's own signIn sends its saved token, which Solflare declines once it is stale (-1; the Saga, 10-01 after a sign-out).
                const session = await signInWithSeeker(freshWalletSignIn(identity))
                // Drop the kit's cached authorization (storage only): the next transaction authorizes afresh instead of reusing a stale token.
                await disconnect().catch(() => {})
                await setSession(session)
              } catch (e) {
                // Dev builds only: the raw error for Metro's terminal (10-01: the Saga showed the generic line and nothing else).
                if (typeof __DEV__ !== 'undefined' && __DEV__)
                  console.warn(
                    `[signin] failed: ${e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e)}`,
                    e,
                  )
                // A wallet that declines (a scam-screen block reports as a cancel) gets its own line instead of silence (10-01 device check).
                // A drop already had its one retry inside freshSignIn (audits/signin-drop); a decline is the wallet's own no.
                setError(
                  isSessionDropped(e)
                    ? 'Your wallet closed before answering. Tap Sign in to try again.'
                    : isWalletDeclined(e)
                    ? "Your wallet did not sign. Try again, or sign in with another wallet app that holds your Seeker's seed."
                    : e instanceof ApiError
                      ? e.message
                      : 'Sign-in did not go through. Try again.',
                )
              } finally {
                setBusy(false)
              }
            }}
          />
          {busy ? (
            <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
              Waiting for your Seeker.
            </ThemedText>
          ) : null}
          {error ? (
            <ThemedText tone="error" style={{ textAlign: 'center' }}>
              {error}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          No transaction, no fee. Sprouts needs a Seeker, or a Saga with its Genesis Token.
        </ThemedText>
      </View>
    </Screen>
  )
}
