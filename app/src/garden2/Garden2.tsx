import { useEffect, useMemo, useState } from 'react'
import { Image, Text, View } from 'react-native'
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
import { FONT, GARDEN_INK, radius, spacing, useTheme } from '@/theme'
import { pinchOffset } from '@/model/motion'
import { CANVAS } from './layout'
import { DECOR_SRC, FRUIT_SRC, OVERLAY_SRC, OVERLAY_SRC_DARK, PLATE, PLATE_DARK, STAGE_SRC, STAGE_SRC_DARK } from './sources'
import {
  clampZoom2,
  composeLayers,
  STAKE,
  frameTop,
  plantAt,
  scaleRect,
  viewHeight,
  type Extras,
  type Layer,
  type Plant2,
  type Stages,
} from '@/model/garden2'

/** R250's label timing, kept: a tapped plant's label shows this long, this wide. */
const LABEL_MS = 4500,
  LABEL_W = 260
const SNAP_MS = 250 // R173: the zoom snaps back on release or a double tap

/** The garden always draws full bleed: light, and dark (R530, option B: the light plate edge to edge, square, on the dark page). */
export const garden2Bleeds = (_dark: boolean): boolean => true

/** R529: in dark mode with a dark plate exported, the dark plate and any dark variant of a layer; otherwise the light art. */
const sourceOf = (l: Layer, night: boolean) =>
  l.kind === 'plate'
    ? night && PLATE_DARK !== null
      ? PLATE_DARK
      : PLATE
    : l.kind === 'overlay'
      ? (night && OVERLAY_SRC_DARK[l.key]) || OVERLAY_SRC[l.key]
      : l.kind === 'fruit'
        ? FRUIT_SRC[l.key]
        : l.kind === 'decor'
          ? DECOR_SRC[l.key]
          : l.kind === 'stake'
            ? DECOR_SRC.stake
          : (night && STAGE_SRC_DARK[l.key]?.[l.stage]) || STAGE_SRC[l.key][l.stage]

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
  extras,
  width,
  labelFor,
}: {
  stages: Stages
  /** R533 the trees' earned fruit/flowers, R535 the basket while SKR waits out its unstake; nothing extra when absent. */
  extras?: Extras
  width: number
  labelFor?: (plant: Plant2) => string[]
}) {
  const { colors, dark } = useTheme()
  // R530 (option B): dark draws the light plate full bleed and square; a dark plate, if one is ever exported, replaces it (R529 plumbing).
  const night = dark && PLATE_DARK !== null
  const reduced = useReducedMotion()
  // R525: the view starts just above the tallest thing drawn (frameTop), so a young garden sits tight and the frame opens as it grows.
  const top = useMemo(() => frameTop(stages), [stages])
  const k = width / CANVAS.w
  const h = viewHeight(width) - top * k
  const layers = useMemo(
    () => composeLayers(stages, extras).map((l) => ({ ...scaleRect(l, width), y: (l.y - top) * (width / CANVAS.w) })),
    [stages, extras, width, top],
  )

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
    const plant = labelFor ? plantAt(stages, x / k, y / k + top) : null
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
            borderRadius: 0,
            backgroundColor: night ? colors.background : '#FFFCF6',
          }}
          accessible
          accessibilityLabel="Your garden"
        >
          <Animated.View style={[{ width, height: h, transformOrigin: [0, 0, 0] }, zoomed]}>
            {layers.map((l) =>
              l.kind === 'stake' ? (
                <Stake key={`s-${l.key}`} l={l} k={k} />
              ) : (
                <Image
                  key={l.kind === 'plant' ? `p-${l.key}` : l.kind === 'fruit' ? `f-${l.key}-${l.index}` : l.key}
                  source={sourceOf(l, night)}
                  fadeDuration={0}
                  style={{ position: 'absolute', left: l.x, top: l.y, width: l.w, height: l.h }}
                />
              ),
            )}
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

/** R534/R557: one stake, its plank lettered with the coin name (one line, a tad below the middle), scaled with the garden (k). */
function Stake({ l, k }: { l: Extract<Layer, { kind: 'stake' }>; k: number }) {
  const b = STAKE.board // sprite px; the sprite draws at k view px per sprite px, like every layer
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: l.x, top: l.y, width: l.w, height: l.h }}>
      <Image source={DECOR_SRC.stake} fadeDuration={0} style={{ width: l.w, height: l.h }} />
      <View
        style={{
          position: 'absolute',
          left: b.x * k,
          top: (b.y + b.h * STAKE.drop) * k,
          width: b.w * k,
          height: b.h * k,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={{
            fontFamily: FONT.displayBold,
            fontSize: STAKE.font * k,
            lineHeight: STAKE.font * k * 1.05,
            color: GARDEN_INK.sign,
            opacity: GARDEN_INK.signOpacity,
            includeFontPadding: false,
            textAlignVertical: 'center',
          }}
        >
          {l.label}
        </Text>
      </View>
    </View>
  )
}
