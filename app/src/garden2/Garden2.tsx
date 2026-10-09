import { useEffect, useMemo, useState } from 'react'
import { Image, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { ThemedText } from '@/components/ThemedText'
import { radius, spacing, useTheme } from '@/theme'
import { pinchOffset } from '@/model/motion'
import { CANVAS } from './layout'
import { OVERLAY_SRC, PLATE, STAGE_SRC } from './sources'
import {
  clampZoom2,
  composeLayers,
  plantAt,
  scaleRect,
  viewHeight,
  type Layer,
  type Plant2,
  type Stages,
} from '@/model/garden2'

/** R250's label timing, kept: a tapped plant's label shows this long, this wide. */
const LABEL_MS = 4500,
  LABEL_W = 260
const SNAP_MS = 250 // R173: the zoom snaps back on release or a double tap

const sourceOf = (l: Layer) =>
  l.kind === 'plate' ? PLATE : l.kind === 'overlay' ? OVERLAY_SRC[l.key] : STAGE_SRC[l.key][l.stage]

/**
 * Garden2 (R508G): the painted garden composed from the approved mockup v8 at the canvas aspect (1328 x 896), `width` wide: the
 * plate, each plant's stage layer at its box, the stand after stORE and the cords before the pothos (model/garden2.ts composeLayers).
 *
 * Theme: the plate's paper is the light theme's background (#FFFCF6), so in light it sits on the page with no visible edge. In dark it
 * is drawn as a paper card with rounded corners (a keyed plate turned the raked sand black and showed the layers' paper fringes; see
 * previews/garden-app/). R483G: one tap on a plant shows its label (rustle waits for the idle loops, R482G); two fingers zoom up to
 * 1.5x (R487G) and pan, snapping back on release or a double tap (R173's behaviour).
 */
export function Garden2({
  stages,
  width,
  labelFor,
}: {
  stages: Stages
  width: number
  labelFor?: (plant: Plant2) => string[]
}) {
  const { colors, dark } = useTheme()
  const reduced = useReducedMotion()
  const h = viewHeight(width)
  const layers = useMemo(() => composeLayers(stages).map((l) => scaleRect(l, width)), [stages, width])

  const ps = useSharedValue(1),
    px = useSharedValue(0),
    py = useSharedValue(0)
  const s0 = useSharedValue(1),
    x0 = useSharedValue(0),
    y0 = useSharedValue(0),
    f0x = useSharedValue(0),
    f0y = useSharedValue(0)
  const snap = () => {
    'worklet'
    const t = { duration: reduced ? 0 : SNAP_MS, easing: Easing.out(Easing.cubic) }
    ps.value = withTiming(1, t)
    px.value = withTiming(0, t)
    py.value = withTiming(0, t)
  }
  const pinch = Gesture.Pinch()
    .onStart((e) => {
      s0.value = ps.value
      x0.value = px.value
      y0.value = py.value
      f0x.value = e.focalX
      f0y.value = e.focalY
    })
    .onUpdate((e) => {
      const s = clampZoom2(s0.value * e.scale)
      px.value = pinchOffset(x0.value, s0.value, s, f0x.value, e.focalX, width)
      py.value = pinchOffset(y0.value, s0.value, s, f0y.value, e.focalY, h)
      ps.value = s
    })
    .onEnd(snap)

  const [label, setLabel] = useState<{ plant: Plant2; lines: string[]; n: number; x: number } | null>(null)
  useEffect(() => {
    if (!label) return
    const id = setTimeout(() => setLabel(null), LABEL_MS)
    return () => clearTimeout(id)
  }, [label])
  const onTapAt = (x: number, y: number) => {
    const k = CANVAS.w / width
    const plant = labelFor ? plantAt(stages, x * k, y * k) : null
    if (!plant || label?.plant === plant) return setLabel(null)
    const l = layers.find((q) => q.kind === 'plant' && q.key === plant)
    setLabel((old) => ({ plant, lines: labelFor!(plant), n: (old?.n ?? 0) + 1, x: l ? l.x + l.w / 2 : x }))
  }
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(snap)
  const singleTap = Gesture.Tap()
    .maxDuration(300)
    .onEnd((e, ok) => {
      if (ok) runOnJS(onTapAt)((e.x - px.value) / ps.value, (e.y - py.value) / ps.value) // back through the zoom onto the unzoomed view
    })
  const gesture = Gesture.Race(pinch, Gesture.Exclusive(doubleTap, singleTap))
  const zoomed = useAnimatedStyle(() => ({
    transform: [{ translateX: px.value }, { translateY: py.value }, { scale: ps.value }],
  }))

  return (
    <View style={{ width, height: h }}>
      <GestureDetector gesture={gesture}>
        <View
          style={{
            width,
            height: h,
            overflow: 'hidden',
            borderRadius: dark ? radius.lg : 0,
            backgroundColor: '#FFFCF6',
          }}
          accessible
          accessibilityLabel="Your garden"
        >
          <Animated.View style={[{ width, height: h, transformOrigin: [0, 0, 0] }, zoomed]}>
            {layers.map((l) => (
              <Image
                key={l.kind === 'plant' ? `p-${l.key}` : l.key}
                source={sourceOf(l)}
                fadeDuration={0}
                style={{ position: 'absolute', left: l.x, top: l.y, width: l.w, height: l.h }}
              />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>
      {label ? (
        <Animated.View
          key={label.n}
          entering={reduced ? undefined : FadeIn.duration(160)}
          exiting={reduced ? undefined : FadeOut.duration(160)}
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: spacing.sm,
            left: Math.min(Math.max(label.x - LABEL_W / 2, 0), Math.max(0, width - LABEL_W)),
            width: LABEL_W,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            gap: 2,
            elevation: 3,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
          }}
        >
          {label.lines.map((t, i) => (
            <ThemedText key={i} variant={i === 0 ? 'label' : 'caption'} tone={i === 0 ? undefined : 'secondary'}>
              {t}
            </ThemedText>
          ))}
        </Animated.View>
      ) : null}
    </View>
  )
}
