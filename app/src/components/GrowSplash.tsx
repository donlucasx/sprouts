import { useEffect, useRef } from 'react'
import { Image, View, useWindowDimensions } from 'react-native'
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import { ThemedText } from './ThemedText'
import { HorizontalLockup } from './Lockup'
import { spacing, useTheme } from '@/theme'

/**
 * R573/R574 (10-09): the re-open loading screen. One plant growing gently, once: the stORE tree filling out (pack stages 8 -> 10, no
 * flowers) on the zen garden's raked sand, then the horizontal lockup under the tree and the slogan under it.
 * Drawn as 12 stills cut from the growth clip (brand/garden2/splash/build_sand_tree.py, its ease baked into their spacing), stacked,
 * each fading in over the last on the UI thread. Video was dropped (device 10-09): at launch the JS thread is busy and the player's
 * events came too late, so the tree grew unseen or never started. Growth never shrinks, so each frame simply covers the one below.
 * Reduced motion: the grown tree only.
 */
const FRAMES = {
  light: [
    require('../../assets/splash/tree-light-00.webp'),
    require('../../assets/splash/tree-light-01.webp'),
    require('../../assets/splash/tree-light-02.webp'),
    require('../../assets/splash/tree-light-03.webp'),
    require('../../assets/splash/tree-light-04.webp'),
    require('../../assets/splash/tree-light-05.webp'),
    require('../../assets/splash/tree-light-06.webp'),
    require('../../assets/splash/tree-light-07.webp'),
    require('../../assets/splash/tree-light-08.webp'),
    require('../../assets/splash/tree-light-09.webp'),
    require('../../assets/splash/tree-light-10.webp'),
    require('../../assets/splash/tree-light-11.webp'),
  ],
  dark: [
    require('../../assets/splash/tree-dark-00.webp'),
    require('../../assets/splash/tree-dark-01.webp'),
    require('../../assets/splash/tree-dark-02.webp'),
    require('../../assets/splash/tree-dark-03.webp'),
    require('../../assets/splash/tree-dark-04.webp'),
    require('../../assets/splash/tree-dark-05.webp'),
    require('../../assets/splash/tree-dark-06.webp'),
    require('../../assets/splash/tree-dark-07.webp'),
    require('../../assets/splash/tree-dark-08.webp'),
    require('../../assets/splash/tree-dark-09.webp'),
    require('../../assets/splash/tree-dark-10.webp'),
    require('../../assets/splash/tree-dark-11.webp'),
  ],
} as const
const GROW_MS = 3500
/** R576 (his words): the re-open screen says what it is doing; the slogan stays on Welcome and in the store listing. */
const LOADING_LINE = 'Loading up your garden...'

/** `onEnd` once the tree has grown (at once under reduced motion, which shows it grown). */
export function GrowSplash({ onEnd }: { onEnd?: () => void }) {
  const { dark } = useTheme()
  const still = useReducedMotion()
  const { width } = useWindowDimensions()
  const side = Math.min(width - 2 * spacing.edge, 340)
  const frames = FRAMES[dark ? 'dark' : 'light']
  const p = useSharedValue(still ? 1 : 0)
  const ended = useRef(onEnd)
  useEffect(() => {
    ended.current = onEnd
  }, [onEnd])
  useEffect(() => {
    const done = () => ended.current?.()
    if (still) {
      p.value = 1
      done()
      return
    }
    p.value = 0
    p.value = withTiming(1, { duration: GROW_MS, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(done)()
    })
  }, [still, p])
  return (
    <View style={{ alignItems: 'center', gap: spacing.lg }} accessible accessibilityLabel={`Sprouts. ${LOADING_LINE}`}>
      <View style={{ width: side, height: side }}>
        <Image source={frames[0]} fadeDuration={0} style={{ position: 'absolute', width: side, height: side }} />
        {frames.slice(1).map((f, i) => (
          <Frame key={i} source={f} index={i + 1} count={frames.length} p={p} side={side} />
        ))}
      </View>
      <HorizontalLockup wordSize={42} />
      {/* R575: the lockup bigger (42, was 30) and the slogan lower, set apart from it */}
      <ThemedText variant="heading" style={{ textAlign: 'center', marginTop: spacing.xl }}>
        {LOADING_LINE}
      </ThemedText>
    </View>
  )
}

/** Frame `index` fades in across its own slice of the growth: fully in when the progress reaches it. */
function Frame({ source, index, count, p, side }: { source: number; index: number; count: number; p: SharedValue<number>; side: number }) {
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, p.value * (count - 1) - (index - 1))) }))
  return <Animated.Image source={source} fadeDuration={0} style={[{ position: 'absolute', width: side, height: side }, style]} />
}
