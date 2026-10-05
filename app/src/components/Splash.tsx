import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated'
import { Garden } from '@/garden/Garden'
import { ThemedText } from './ThemedText'
import { SPLASH, splashHoldMs, splashScene } from '@/lib/splash'
import { spacing, useTheme } from '@/theme'

/** R282: over the app on every launch for SPLASH.ms, then it fades and unmounts. The garden is the real renderer; `row` draws nothing, so no can. Reduced motion: the fade becomes a cut (the garden itself already holds still). */
export function Splash() {
  const { colors } = useTheme()
  const reduced = useReducedMotion()
  const scene = useMemo(() => splashScene(), [])
  const [gone, setGone] = useState(false)
  const opacity = useSharedValue(1)
  const [fading, setFading] = useState(false)
  const [t0] = useState(() => Date.now())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = useCallback(() => { if (timer.current) clearTimeout(timer.current) }, [])
  const fadeOut = useCallback(() => {
    setFading(true)
    opacity.set(withTiming(0, { duration: reduced ? 0 : SPLASH.fadeMs }, (finished) => {
      if (finished) runOnJS(setGone)(true)
    }))
  }, [opacity, reduced])
  // The hold (SPLASH.ms) counts from the picture being in; a picture that never comes is cut at SPLASH.capMs from mount.
  const schedule = useCallback((readyAt: number | null) => {
    clear()
    timer.current = setTimeout(fadeOut, splashHoldMs(readyAt, Date.now() - t0))
  }, [fadeOut, clear, t0])
  useEffect(() => { schedule(null); return clear }, [schedule, clear])
  const onReady = useCallback(() => schedule(Date.now() - t0), [schedule, t0])
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }))
  if (gone) return null
  return (
    <Animated.View
      accessible
      pointerEvents={fading ? 'none' : 'auto'}
      accessibilityLabel={SPLASH.line}
      style={[{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: colors.background, justifyContent: 'center', paddingHorizontal: 20, gap: spacing.lg }, fade]}
    >
      <Garden scene={scene} live={false} canReady={false} onWater={async () => false} onNudge={() => {}} row={() => null} onReady={onReady} />
      <ThemedText variant="heading" style={{ textAlign: 'center' }}>
        {SPLASH.line}
      </ThemedText>
    </Animated.View>
  )
}
