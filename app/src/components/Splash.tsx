import { useCallback, useEffect, useRef, useState } from 'react'
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { GrowSplash } from './GrowSplash'
import { SPLASH } from '@/lib/splash'
import { spacing, useTheme } from '@/theme'

/** R574: once the tree has grown, this long on screen before the fade; and the most it ever stays (a clip that never plays). */
const GROWN_HOLD_MS = 400,
  CAP_MS = 7000

/**
 * The re-open loading screen (R282: over the app on every launch; R573/R574: one tree growing gently on the raked sand, the horizontal
 * lockup and the slogan under it). It fades GROWN_HOLD_MS after the tree has grown, or at CAP_MS whatever happens, then unmounts.
 * Reduced motion: the grown tree at once, its usual hold, and the fade becomes a cut.
 */
export function Splash() {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const [gone, setGone] = useState(false)
  const [fading, setFading] = useState(false)
  const opacity = useSharedValue(1)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeOut = useCallback(() => {
    setFading(true)
    opacity.set(withTiming(0, { duration: reduced ? 0 : SPLASH.fadeMs }, (finished) => {
      if (finished) runOnJS(setGone)(true)
    }))
  }, [opacity, reduced])
  const fadeIn = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(fadeOut, ms)
  }, [fadeOut])
  useEffect(() => {
    fadeIn(CAP_MS)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [fadeIn])
  const onGrown = useCallback(() => fadeIn(reduced ? SPLASH.ms : GROWN_HOLD_MS), [fadeIn, reduced])
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }))
  if (gone) return null
  return (
    <Animated.View
      pointerEvents={fading ? 'none' : 'auto'}
      style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: colors.background, paddingHorizontal: spacing.edge }, fade]}
    >
      <GrowSplash onEnd={onGrown} />
    </Animated.View>
  )
}
