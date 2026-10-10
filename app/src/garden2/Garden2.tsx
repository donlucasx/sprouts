import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useIsFocused } from 'expo-router'
import { Image, Pressable, Text, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { ThemedText } from '@/components/ThemedText'
import { FONT, GARDEN_INK, radius, spacing, useTheme } from '@/theme'
import { pinchOffset } from '@/model/motion'
import type { PlantCard } from '@/lib/plant-card'
import { CANVAS } from './layout'
import { LoopImage } from './loop-image'
import { DECOR_SRC, FRUIT_SRC, GROWTH_SRC, LOOP_SRC, OVERLAY_SRC, OVERLAY_SRC_DARK, PLATE, PLATE_DARK, STAGE_SRC, STAGE_SRC_DARK } from './sources'
import {
  CARD_CARET,
  clampZoom2,
  composeLayers,
  nextStir,
  paintedBox,
  placeCard,
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

/** R250's label timing: a tapped plant's card shows this long (R587: longer, it now has numbers to read and a Details to tap). */
const LABEL_MS = 6000,
  CARD_MAX_W = 270
const SNAP_MS = 250 // R173: the zoom snaps back on release or a double tap
/** R521: a plant's step up fades in over its old painting this long, after this pause (Claude's numbers, to tune on the device). */
const REVEAL_MS = 1200,
  REVEAL_DELAY_MS = 400
/** R588: a stir whose loop never reports loaded still ends this long after one cycle. */
const STIR_SPARE_MS = 1500
/** R585: a growth clip that never reports loaded still ends this long after its own length (the still takes over). */
const GROW_SPARE_MS = 1500

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
  reveal,
  width,
  cardFor,
  onCard,
  cardOverflow = 0,
}: {
  stages: Stages
  /** R533 the trees' earned fruit/flowers, R535 the basket while SKR waits out its unstake; nothing extra when absent. */
  extras?: Extras
  /** R521: plants that stepped up since last shown, with the stage they showed; each fades from that to now (model revealFrom). */
  reveal?: Partial<Stages>
  width: number
  /** R587: what a tapped plant's card says (its coin's numbers, plantCard) and the coin's logo; none = taps do nothing. */
  cardFor?: (plant: Plant2) => PlantCard & { icon?: number }
  /** R587: the card's Details (Home opens the coin's sheet); absent, or the card has no row, = no Details. */
  onCard?: (card: PlantCard) => void
  /** R587: how far a card may hang past the garden's bottom, over what follows it (Home: the saved line); the parent keeps the garden
   *  above its later siblings (zIndex) so the card draws on top. */
  cardOverflow?: number
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

  // R521: one fade for every revealing plant (its fruit too, and its stake when the plant is new); none under reduced motion
  const revealKey = JSON.stringify(reveal ?? {})
  const pending = !!reveal && Object.keys(reveal).length > 0 && !reduced
  const fadeIn = useSharedValue(pending ? 0 : 1)
  // s6 review K2/C3: once the fade is over, a faded plant draws as every plant does (plantNode: its still, stirs on tap and by the
  // scheduler); before, it kept both stills stacked and could never stir again
  const [fadedKey, setFadedKey] = useState('')
  const fadeDone = !pending || fadedKey === revealKey
  // s6 review K3: set before paint (a layout effect), so the new stage never shows for a frame before the fade starts from the old
  useLayoutEffect(() => {
    if (!pending) {
      fadeIn.value = 1
      return
    }
    fadeIn.value = 0
    fadeIn.value = withDelay(REVEAL_DELAY_MS, withTiming(1, { duration: REVEAL_MS, easing: Easing.inOut(Easing.quad) }))
    const id = setTimeout(() => setFadedKey(revealKey), REVEAL_DELAY_MS + REVEAL_MS)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the reveal's content, not its identity
  }, [revealKey, pending])
  const fading = useAnimatedStyle(() => ({ opacity: fadeIn.value }))
  const revealing = (key: Plant2) => reveal?.[key] !== undefined

  // R588 (his words: "the plants should animate randomly and sporadically. Sometimes on their own, some times a few together. The
  // animation should trigger on tap"): a plant with an idle loop at its stage stands still, and plays ONE cycle when stirred: now and
  // then by nextStir (alone, or a gust crossing left to right), and when tapped. None under reduced motion or the dark plate.
  // s6 review C7: only while this screen is in front (no stirs on other tabs or under a pushed screen)
  const focused = useIsFocused()
  const canStir = LoopImage !== null && !reduced && !night && focused
  const [stirs, setStirs] = useState<Partial<Record<Plant2, number>>>({})
  const stirRaw = useCallback((p: Plant2) => setStirs((o) => (o[p] !== undefined ? o : { ...o, [p]: Date.now() })), [])
  const settle = useCallback(
    (p: Plant2) =>
      setStirs((o) => {
        const n = { ...o }
        delete n[p]
        return n
      }),
    [],
  )
  const stirrable = useMemo(
    () => (canStir ? (Object.keys(stages) as Plant2[]).filter((p) => LOOP_SRC[p]?.[stages[p] ?? 0] !== undefined).sort() : []),
    [stages, canStir],
  )
  const stirKey = stirrable.join(',')
  // s6 review K2: only a plant that can play a loop now is stirred (else its entry never settled and swallowed later taps)
  const stir = useCallback((p: Plant2) => {
    if (stirrable.includes(p)) stirRaw(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on which plants can stir
  }, [stirKey, stirRaw])
  useEffect(() => {
    if (stirrable.length === 0) return
    let wait: ReturnType<typeof setTimeout> | undefined
    const gusts: ReturnType<typeof setTimeout>[] = []
    // the quiet spell counts from the END of the last stir, and a plant that just moved sits the next one out while another can go
    // (on the device two candidates stirred back to back read as one endless sway)
    const next = (busyMs: number, last: Plant2[]) => {
      const rested = stirrable.filter((p) => !last.includes(p))
      const s = nextStir(rested.length > 0 ? rested : stirrable, Math.random)
      if (!s) return
      wait = setTimeout(() => {
        gusts.length = 0
        for (const q of s.plants) gusts.push(setTimeout(() => stir(q.plant), q.atMs))
        const cycle = Math.max(...s.plants.map((q) => q.atMs + (LOOP_SRC[q.plant]?.[stages[q.plant] ?? 0]?.ms ?? 0)))
        next(cycle, s.plants.map((q) => q.plant))
      }, busyMs + s.waitMs)
    }
    next(0, [])
    return () => {
      clearTimeout(wait)
      gusts.forEach(clearTimeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on which plants can stir, not the array's identity
  }, [stirKey, stir])
  /** A plant as it stands (its still), or playing one cycle of its idle loop while stirred. */
  const plantNode = (l: Extract<Layer, { kind: 'plant' }>): ReactNode => {
    const loop = canStir && stirs[l.key] !== undefined ? LOOP_SRC[l.key]?.[l.stage] : undefined
    const box = { position: 'absolute' as const, left: l.x, top: l.y, width: l.w, height: l.h }
    return loop ? (
      <StirLoop key={`p-${l.key}-${stirs[l.key]}`} loop={loop} still={sourceOf(l, night)} style={box} onEnd={() => settle(l.key)} />
    ) : (
      <Image key={`p-${l.key}`} source={sourceOf(l, night)} fadeDuration={0} style={box} />
    )
  }

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

  const [label, setLabel] = useState<{ plant: Plant2; card: PlantCard & { icon?: number }; n: number } | null>(null)
  const [cardH, setCardH] = useState(84) // measured on layout; a first guess for the first frame
  useEffect(() => {
    if (!label) return
    const id = setTimeout(() => setLabel(null), LABEL_MS)
    return () => clearTimeout(id)
  }, [label])
  const onTapAt = (x: number, y: number) => {
    const plant = plantAt(stages, x / k, y / k + top)
    if (plant && canStir) stir(plant) // R588: a tap stirs the plant (one cycle of its loop)
    if (!cardFor || !plant || label?.plant === plant) return setLabel(null)
    setLabel((old) => ({ plant, card: cardFor!(plant), n: (old?.n ?? 0) + 1 }))
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

  // R587: the card centred over the tapped plant's paint, pointing at it (model placeCard)
  const cardW = Math.min(CARD_MAX_W, width - 16)
  const place = (() => {
    if (!label) return null
    const box = paintedBox(label.plant, stages[label.plant] ?? 0)
    const stake = layers.find((q) => q.kind === 'stake' && q.key === label.plant)
    if (!box) return null
    const y1 = (box.y1 - top) * k
    return placeCard({
      plant: { x0: box.x0 * k, x1: box.x1 * k, y0: (box.y0 - top) * k },
      stakeBottom: stake ? stake.y + stake.h : y1,
      viewW: width,
      viewH: h,
      cardW,
      cardH,
      below: cardOverflow,
    })
  })()

  return (
    // s6 review K1: Android sends a touch only to views whose bounds hold it, so the root reaches `cardOverflow` past the garden (a
    // card hung below it keeps its Details tappable) and gives that room back below; box-none lets taps there reach what is under it
    <View pointerEvents="box-none" style={{ width, height: h + cardOverflow, marginBottom: -cardOverflow }}>
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
                reveal?.[l.key] === 0 ? ( // a stake fades in only with its plant's first planting; it already stood otherwise
                  <Animated.View key={`s-${l.key}`} style={[{ position: 'absolute', left: 0, top: 0 }, fading]}>
                    <Stake l={l} k={k} />
                  </Animated.View>
                ) : (
                  <Stake key={`s-${l.key}`} l={l} k={k} />
                )
              ) : l.kind === 'plant' && revealing(l.key) && LoopImage && !reduced && !night && reveal![l.key]! > 0 && GROWTH_SRC[l.key]?.[l.stage] ? (
                // R585 ("we do have animations, dont we?"): a plant that stepped up plays its real growth clip instead of the fade
                <GrowPlant key={`p-${l.key}-${revealKey}`} l={l} from={reveal![l.key]!} night={night} after={plantNode(l)} />
              ) : l.kind === 'plant' && revealing(l.key) && !fadeDone ? (
                <View key={`p-${l.key}`} style={{ position: 'absolute', left: l.x, top: l.y, width: l.w, height: l.h }}>
                  <Image
                    source={sourceOf({ ...l, stage: reveal![l.key]! }, night)}
                    fadeDuration={0}
                    style={{ position: 'absolute', width: l.w, height: l.h }}
                  />
                  <Animated.Image
                    source={sourceOf(l, night)}
                    fadeDuration={0}
                    style={[{ position: 'absolute', width: l.w, height: l.h }, fading]}
                  />
                </View>
              ) : l.kind === 'plant' ? (
                plantNode(l)
              ) : l.kind === 'fruit' && revealing(l.key) ? (
                <Animated.Image
                  key={`f-${l.key}-${l.index}`}
                  source={sourceOf(l, night)}
                  fadeDuration={0}
                  style={[{ position: 'absolute', left: l.x, top: l.y, width: l.w, height: l.h }, fading]}
                />
              ) : (
                <Image
                  key={l.kind === 'fruit' ? `f-${l.key}-${l.index}` : l.key}
                  source={sourceOf(l, night)}
                  fadeDuration={0}
                  style={{ position: 'absolute', left: l.x, top: l.y, width: l.w, height: l.h }}
                />
              ),
            )}
          </Animated.View>
        </View>
      </GestureDetector>
      {label && place ? (
        <Animated.View
          key={label.n}
          entering={reduced ? undefined : FadeIn.duration(160)}
          exiting={reduced ? undefined : FadeOut.duration(160)}
          onLayout={(e) => setCardH(Math.round(e.nativeEvent.layout.height))}
          style={{ position: 'absolute', top: place.top, left: place.left, width: cardW }}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: place.caretX - CARD_CARET,
              ...(place.caret === 'down' ? { bottom: -CARD_CARET + 1 } : { top: -CARD_CARET + 1 }),
              width: 0,
              height: 0,
              borderLeftWidth: CARD_CARET,
              borderRightWidth: CARD_CARET,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              ...(place.caret === 'down'
                ? { borderTopWidth: CARD_CARET, borderTopColor: colors.surface }
                : { borderBottomWidth: CARD_CARET, borderBottomColor: colors.surface }),
            }}
          />
          <Pressable
            disabled={!label.card.row || !onCard}
            onPress={() => (onCard?.(label.card), setLabel(null))}
            accessibilityRole={label.card.row && onCard ? 'button' : undefined}
            style={({ pressed }) => ({
              opacity: pressed ? 0.8 : 1,
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.md,
              gap: spacing.xs,
              elevation: 3,
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              {label.card.icon !== undefined ? <Image source={label.card.icon} style={{ width: 28, height: 28, borderRadius: 14 }} /> : null}
              <View style={{ flex: 1, gap: 1 }}>
                <ThemedText variant="label" numberOfLines={1}>
                  {label.card.title}
                </ThemedText>
                {label.card.where ? (
                  <ThemedText variant="caption" tone="secondary" numberOfLines={2}>
                    {label.card.where}
                  </ThemedText>
                ) : null}
              </View>
              {label.card.value ? (
                <View style={{ alignItems: 'flex-end', gap: 1, flexShrink: 0 }}>
                  <ThemedText variant="label" numeric>
                    {label.card.value}
                  </ThemedText>
                  {label.card.earned ? (
                    <ThemedText variant="caption" numeric style={{ color: label.card.earned.positive ? colors.success : colors.textSecondary }}>
                      {`${label.card.earned.text} earned`}
                    </ThemedText>
                  ) : null}
                </View>
              ) : null}
            </View>
            {label.card.next ? (
              <ThemedText variant="caption" tone="secondary">
                {label.card.next}
              </ThemedText>
            ) : null}
            {label.card.row && onCard ? (
              <ThemedText variant="caption" style={{ color: colors.accentText, fontFamily: FONT.label }}>
                {'Details \u203A'}
              </ThemedText>
            ) : null}
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  )
}

/**
 * R585: one plant's stage-up as its growth clip (the clip that ends on its stage). It shows the old still through the reveal's pause
 * (a jump of several stages fades from the old still to the one the clip starts on), plays the clip once (it loads paused during the pause), then
 * hands over to the plant as it always draws (`after`: its still, or a stir). The clip's first and last frames are cut to match those
 * stills (build_timelapse.py --export-growth), so the hand-offs are swaps, not fades.
 */
function GrowPlant({ l, from, night, after }: { l: Extract<Layer, { kind: 'plant' }>; from: number; night: boolean; after: ReactNode }) {
  const clip = GROWTH_SRC[l.key]![l.stage]!
  const start = l.stage - 1
  // the clip loads hidden and paused during the pause (a cold decode took a beat on the device: "the reveal button seems a tad buggy"),
  // and plays once both the pause is over and its frames are in; a clip that never loads gives way to the new still
  const [waited, setWaited] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [done, setDone] = useState(false)
  const playing = waited && loaded && !done
  const fadeTo = useSharedValue(from < start ? 0 : 1)
  const ref = useRef<{ startAnimating: () => Promise<void> } | null>(null)
  useEffect(() => {
    if (from < start) fadeTo.value = withTiming(1, { duration: REVEAL_DELAY_MS, easing: Easing.inOut(Easing.quad) })
    const id = setTimeout(() => setWaited(true), REVEAL_DELAY_MS + (from < start ? REVEAL_DELAY_MS : 0))
    const spare = setTimeout(() => setDone(true), REVEAL_DELAY_MS * 2 + GROW_SPARE_MS + clip.ms)
    return () => (clearTimeout(id), clearTimeout(spare))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mounted reveal (keyed on it)
  }, [])
  useEffect(() => {
    if (!playing) return
    void ref.current?.startAnimating()
    const id = setTimeout(() => setDone(true), clip.ms)
    return () => clearTimeout(id)
  }, [playing, clip.ms])
  const fading = useAnimatedStyle(() => ({ opacity: fadeTo.value }))
  const box = { position: 'absolute' as const, left: l.x, top: l.y, width: l.w, height: l.h }
  const fill = { position: 'absolute' as const, width: l.w, height: l.h }
  const still = (stage: number) => sourceOf({ ...l, stage }, night)
  if (!done && LoopImage)
    return (
      <View style={box}>
        {/* s6 review K7: a one-shot clip is never replayed from cache; kept out of the shared memory cache */}
        <LoopImage ref={ref} source={clip.src} transition={0} autoplay={false} contentFit="fill" cachePolicy="none"
          onLoad={() => setLoaded(true)} style={{ ...fill, opacity: playing ? 1 : 0 }} />
        {playing ? null : (
          <>
            <Image source={still(from)} fadeDuration={0} style={fill} />
            {from < start ? <Animated.Image source={still(start)} fadeDuration={0} style={[fill, fading]} /> : null}
          </>
        )}
      </View>
    )
  return <>{after}</>
}

/** R588: one cycle of a plant's idle loop, from the frame it loads (the still is its placeholder, so the hand-offs are swaps). */
function StirLoop({ loop, still, style, onEnd }: { loop: { src: number; ms: number }; still: number; style: object; onEnd: () => void }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const id = setTimeout(onEnd, loop.ms + (loaded ? 0 : STIR_SPARE_MS))
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restarts once, when the loop's frames are in
  }, [loaded, loop.ms])
  if (!LoopImage) return null
  return (
    <LoopImage source={loop.src} placeholder={still} placeholderContentFit="fill" transition={0} autoplay contentFit="fill" cachePolicy="memory"
      onLoad={() => setLoaded(true)} style={style} />
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
