import { useEffect, useState } from 'react'
import { Appearance, AppState } from 'react-native'
import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
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
import { Splash } from '@/components/Splash'
import { readAppearance } from '@/lib/prefs'
import { schemeFor } from '@/theme/appearance'

// Only Mobile Wallet Adapter's plumbing touches this endpoint; every read the app shows comes from the API.
const cluster = createSolanaMainnet({ url: 'https://api.mainnet-beta.solana.com' })
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } })

// The splash stays up until the session and the brand's two faces are in (manual 5); a font that fails to load gives way to the system face.
SplashScreen.preventAutoHideAsync().catch(() => {})

// R153: the saved appearance is applied before the first frame; the theme hook reads useColorScheme, which follows it (and so do the native switches and the keyboard).
Appearance.setColorScheme(schemeFor(readAppearance()))

/** R227 (10-03, his device note): opened from the widget, the app came up in the phone's dark while Settings said Light. The choice
 * is applied once at load; a launch that brings a fresh activity (the widget's tap) can report the phone's own scheme after it. So
 * Light or Dark is applied again whenever the app comes forward or the scheme moves off it; System is left to the phone. */
function holdAppearance() {
  const want = readAppearance()
  if (want !== 'system' && Appearance.getColorScheme() !== want) Appearance.setColorScheme(want)
}

/** What a signed-in app runs: the closed-app refresh (notifications, widget) and the one notification permission prompt. */
function startSignedIn() {
  registerBackgroundRefresh().catch(() => {})
  askNotificationPermissionOnce().catch(() => {})
}

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
    holdAppearance()
    const a = AppState.addEventListener('change', (st) => st === 'active' && holdAppearance())
    const b = Appearance.addChangeListener(holdAppearance)
    return () => {
      a.remove()
      b.remove()
    }
  }, [])
  useEffect(() => {
    loadSession()
      .catch(() => null)
      .then((s) => {
        setSessionState(s)
        setReady(true)
        if (s) startSignedIn()
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
    // A sign-in starts the same as a cold start with a saved session (10-09: a fresh install asked for no notification permission
    // and polled nothing in the background until the next cold start; sign-out unregisters the refresh, so a re-sign-in did too).
    if (s) startSignedIn()
  }
  if (!ready || !fontsSettled) return null
  // The garden's gestures (drag the can, pinch to zoom) need the gesture handler's root above every screen (the spike, A-DRAG).
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <MobileWalletProvider cluster={cluster} identity={identity}>
          <SessionContext.Provider value={{ session, setSession }}>
            <StatusBar style={dark ? 'light' : 'dark'} />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
            <Splash />
          </SessionContext.Provider>
        </MobileWalletProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}
