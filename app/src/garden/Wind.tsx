// R200: the painted wind curls (wind12.py's watercolour strokes) drifting across the garden's sky with each gust. The timing and the
// path are model/wind.ts; this file only listens to the garden's gust clock and moves three images.
import Animated, { Easing, cancelAnimation, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSequence, withTiming, type SharedValue } from "react-native-reanimated";
import { WIND_NAMES, WIND_SPRITES } from "./wind-sprites";
import { WIND, WIND_IDLE, curlAt, curlPlan, isGustStart } from "@/model/wind";
import { useEffect } from "react";

const SLOTS = [0, 1, 2] as const;   // WIND.maxCurls slots; a gust with two curls leaves the third at opacity 0

/** The wind layer: a box `width` wide and the garden view's (eased) height `viewH`, clipped, touch-transparent. Garden mounts it
 * between the ground layer and the plant layer, in screen space (outside the zoom and the frame), so the curls sit in the sky behind
 * the plants and keep their painted size whatever the garden's zoom.
 *
 * The clock: whenever the garden's `gust` clock restarts (isGustStart: it only falls at a new gust), the wind clock restarts at 0 and
 * runs linearly to WIND.spanMs, and the gust count steps, which reseeds every curl (curlPlan). All on the UI thread: no re-render
 * per gust. Under reduced motion the layer is not drawn at all (and the gust clock never runs, motion.ts). */
export function Wind({ gust, width, viewH, reduced }: { gust: SharedValue<number>; width: number; viewH: SharedValue<number>; reduced: boolean }) {
  const clock = useSharedValue(WIND_IDLE);
  const seed = useSharedValue(0);
  useAnimatedReaction(() => gust.value, (cur, prev) => {
    if (reduced || !isGustStart(cur, prev)) return;
    seed.value = seed.value + 1;
    clock.value = withSequence(withTiming(0, { duration: 0 }), withTiming(WIND.spanMs, { duration: WIND.spanMs, easing: Easing.linear }));
  }, [reduced]);
  useEffect(() => () => cancelAnimation(clock), [clock]);
  const box = useAnimatedStyle(() => ({ height: viewH.value }));
  if (reduced) return null;
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width, overflow: "hidden" }, box]}>
      {SLOTS.map((i) => <WindCurl key={i} slot={i} clock={clock} seed={seed} width={width} viewH={viewH} />)}
    </Animated.View>
  );
}

/** One slot: all three painted curls stacked, only this gust's pick visible (an image's source cannot change on the UI thread, so
 * the pick is an opacity per sprite); the slot's position, stretch and fade come from curlAt on every frame. */
function WindCurl({ slot, clock, seed, width, viewH }: { slot: number; clock: SharedValue<number>; seed: SharedValue<number>; width: number; viewH: SharedValue<number> }) {
  return (
    <>
      {WIND_NAMES.map((name, s) => <CurlImage key={name} name={name} sprite={s} slot={slot} clock={clock} seed={seed} width={width} viewH={viewH} />)}
    </>
  );
}

function CurlImage({ name, sprite, slot, clock, seed, width, viewH }: { name: (typeof WIND_NAMES)[number]; sprite: number; slot: number; clock: SharedValue<number>; seed: SharedValue<number>; width: number; viewH: SharedValue<number> }) {
  const m = WIND_SPRITES[name];
  const style = useAnimatedStyle(() => {
    const c = curlPlan(seed.value, slot);
    const f = curlAt(c, clock.value, false);
    const shown = c.sprite === sprite ? f.opacity : 0;
    return {
      opacity: shown,
      // the image is laid out at 1x units; scale about its left-centre so `x` stays the curl's left edge as it stretches
      transform: [
        { translateX: f.x * width - (m.w * (1 - c.scale * f.stretch)) / 2 },
        { translateY: c.top * viewH.value + f.dy - (m.h * (1 - c.scale)) / 2 },
        { scaleX: c.scale * f.stretch },
        { scaleY: c.scale },
      ],
    };
  });
  return <Animated.Image source={m.src} style={[{ position: "absolute", left: 0, top: 0, width: m.w, height: m.h }, style]} />;
}
