import { useState } from 'react'
import { Text, View } from 'react-native'
import { Redirect, router } from 'expo-router'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { freshWalletSignIn } from '@/lib/reauth'
import { identity } from '@/lib/identity'
import { Screen } from '@/components/Screen'
import { Button } from '@/components/Button'
import { ThemedText } from '@/components/ThemedText'
import { Wordmark } from '@/components/Lockup'
import { SigninSprout } from '@/components/SigninSprout'
import { SLOGAN_LINES } from '@/lib/slogan'
import { useSession } from '@/lib/session'
import { signInWithSeeker } from '@/lib/signin'
import { isSessionDropped, isWalletDeclined, SIGN_IN_DID_NOT_FINISH } from '@/lib/wallet-errors'
import { ApiError } from '@/lib/api'
import { spacing, useTheme } from '@/theme'


/** Welcome (R445, design B2 of 10-07): the swaying sprout over the wordmark, the slogan under it, the agreement and the one button. */
export default function Welcome() {
  const { session } = useSession()
  if (session) return <Redirect href="/home" />
  return <WelcomeView />
}

/** The screen itself, apart from the redirect, so a dev build can preview it signed in (src/app/dev-welcome.tsx). */
export function WelcomeView() {
  const { setSession } = useSession()
  const [busy, setBusy] = useState(false)
  const { disconnect } = useMobileWallet()
  const [error, setError] = useState<string | null>(null)
  const { colors } = useTheme()
  return (
    <Screen scroll={false}>
      {/* 10-07 redesign (R440-R445): the sprout, the wordmark and the slogan centred in the open space (B2's spacing: the art (its clip has 15 dp of paper below the soil), 17 dp,
          the word at 48, 10 dp, the slogan); the agreement and the button held together at the bottom, all centred. */}
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <SigninSprout />
        <View style={{ height: 17 }} />
        <Wordmark size={48} />
        <View style={{ height: 10 }} />
        <ThemedText variant="label" style={{ fontSize: 19, lineHeight: 27, textAlign: 'center' }}>
          {SLOGAN_LINES.join('\n')}
        </ThemedText>
      </View>
      <View style={{ alignSelf: 'stretch', gap: spacing.md, paddingBottom: spacing.xl }}>
        {/* R283 + R440: signing in accepts the Terms; the notice sits right above the button, the full page one tap away */}
        <ThemedText variant="caption" tone="secondary" style={{ textAlign: 'center' }}>
          {'By signing in you agree to the '}
          <Text
            accessibilityRole="link"
            onPress={() => router.push('/terms')}
            style={{ color: colors.accentText, textDecorationLine: 'underline' }}
          >
            Terms and Privacy
          </Text>
          .
        </ThemedText>
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
                // A drop already had its one retry inside freshSignIn; a drop and a decline get the same line, since the wallets
                // send a user's cancel as a drop too (audits/signin-drop, 10-06).
                setError(
                  isSessionDropped(e) || isWalletDeclined(e)
                    ? SIGN_IN_DID_NOT_FINISH
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
    </Screen>
  )
}
