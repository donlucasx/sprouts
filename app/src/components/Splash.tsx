import { useCallback, useEffect, useRef, useState } from 'react'
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { StatusBar } from 'expo-status-bar'
import { GrowSplash } from './GrowSplash'
import { SPLASH } from '@/lib/splash'
import { markSplashLifted } from '@/lib/splash-state'
import { LightOnly, palette, spacing } from '@/theme'

/** R574: once the tree has grown, this long on screen before the fade; and the most it ever stays (a clip that never plays). */
const GROWN_HOLD_MS = 400,
  CAP_MS = 7000

/**
 * The re-open loading screen (R282: over the app on every launch; R573/R574: one tree growing gently on the raked sand, the horizontal
 * lockup and the slogan under it). It fades GROWN_HOLD_MS after the tree has grown, or at CAP_MS whatever happens, then unmounts.
 * Reduced motion: the grown tree at once, its usual hold, and the fade becomes a cut.
 */
export function Splash() {
  const reduced = useReducedMotion()
  const [gone, setGone] = useState(false)
  const [fading, setFading] = useState(false)
  const opacity = useSharedValue(1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cap = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeOut = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    if (cap.current) clearTimeout(cap.current)
    setFading(true)
    markSplashLifted() // Home's reveal starts now, under the fade (s6 review C1)
    opacity.set(withTiming(0, { duration: reduced ? 0 : SPLASH.fadeMs }, (finished) => {
      if (finished) runOnJS(setGone)(true)
    }))
  }, [opacity, reduced])
  const fadeIn = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(fadeOut, ms)
  }, [fadeOut])
  // the cap has its own timer: the grown tree's sooner fade (set first under reduced motion, the child's effect running before this
  // one) must not be replaced by it (s6 review C4: reduced motion held the screen 7 s)
  useEffect(() => {
    cap.current = setTimeout(fadeOut, CAP_MS)
    return () => {
      if (cap.current) clearTimeout(cap.current)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [fadeOut])
  const onGrown = useCallback(() => fadeIn(reduced ? SPLASH.ms : GROWN_HOLD_MS), [fadeIn, reduced])
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }))
  if (gone) return null
  return (
    <Animated.View
      pointerEvents={fading ? 'none' : 'auto'}
      style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: palette.light.background, paddingHorizontal: spacing.edge }, fade]}
    >
      {/* R580: always light, in both themes (dark status bar icons over it while it shows) */}
      <StatusBar style="dark" />
      <LightOnly.Provider value>
        <GrowSplash onEnd={onGrown} />
      </LightOnly.Provider>
    </Animated.View>
  )
}
