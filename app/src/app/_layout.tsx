import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Outfit_600SemiBold, Outfit_700Bold } from '@expo-google-fonts/outfit'
import { AlbertSans_400Regular, AlbertSans_500Medium } from '@expo-google-fonts/albert-sans'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createSolanaMainnet, MobileWalletProvider } from '@wallet-ui/react-native-kit'
import { identity } from '@/lib/identity'
import { loadSession, saveSession, SessionContext, type Session } from '@/lib/session'
import { registerBackgroundRefresh } from '@/lib/background' // the task itself is defined from index.js (headless starts)
import { askNotificationPermissionOnce } from '@/lib/notify'
import { useTheme } from '@/theme'

// Only Mobile Wallet Adapter's plumbing touches this endpoint; every read the app shows comes from the API.
const cluster = createSolanaMainnet({ url: 'https://api.mainnet-beta.solana.com' })
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } })

// The splash stays up until the session and the brand's two faces are in (manual 5); a font that fails to load gives way to the system face.
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function Layout() {
  const [session, setSessionState] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [fontsLoaded, fontError] = useFonts({
    ...MaterialCommunityIcons.font, // the tab and control glyphs, in before the splash lifts
    Outfit_600SemiBold,
    Outfit_700Bold,
    AlbertSans_400Regular,
    AlbertSans_500Medium,
  })
  const { colors, dark } = useTheme()
  useEffect(() => {
    loadSession()
      .catch(() => null)
      .then((s) => {
        setSessionState(s)
        setReady(true)
        if (s) {
          registerBackgroundRefresh().catch(() => {})
          askNotificationPermissionOnce().catch(() => {})
        }
      })
  }, [])
  const fontsSettled = fontsLoaded || fontError !== null
  useEffect(() => {
    if (ready && fontsSettled) SplashScreen.hideAsync().catch(() => {})
  }, [ready, fontsSettled])
  const setSession = async (s: Session | null) => {
    await saveSession(s)
    // Every read cached under the old session goes with it (09-29: after sign-out, Home's last read was a 401; signing back in
    // found that 401 still cached, took the new session for dead and threw it away, so sign-in bounced back to Welcome).
    queryClient.clear()
    setSessionState(s)
  }
  if (!ready || !fontsSettled) return null
  return (
    <QueryClientProvider client={queryClient}>
      <MobileWalletProvider cluster={cluster} identity={identity}>
        <SessionContext.Provider value={{ session, setSession }}>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
        </SessionContext.Provider>
      </MobileWalletProvider>
    </QueryClientProvider>
  )
}
