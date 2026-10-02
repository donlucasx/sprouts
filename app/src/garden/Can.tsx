import { useEffect, useState } from "react";
import { View } from "react-native";
import Svg, { G, Image as SvgImage } from "react-native-svg";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, cancelAnimation, type SharedValue } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { spriteTransform } from "@/model/paint";
import type { PlantId } from "@/model/garden";
import { SPRITES } from "./sprites";
import { WATER } from "./parts";
import { REDUCED_MS } from "@/model/opening";
import { canArt, canHit, canHome, dropSize, roseAt, DRIP } from "@/model/can";

/** gen11_motion.py:159: the tap's whole sequence, 5.4 s: 0 to 18 percent slide to the plant, 18 to 32 tilt to -40 degrees, 32 to 70
 * pour, 70 to 82 back to level, 82 to 100 home. */
export const CAN_MS = 5400;
const TILT = -40, LIFT = 1.08, MOVED = 8;
const REST = SPRITES["can"], TILTED = SPRITES["can-tilt"], GREY = SPRITES["can-grey"];   // can-grey: baked desaturated at 45 percent (ruling d)
const SHADOW = SPRITES["can-shadow"];   // R184: the contact shadow, centred under the body's base (can11.py: the base at y +17)
const SHADOW_AT = { x: -1, y: 18.5 };   // sprite units from the body's centre
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One sprite with its anchor at the centre of an L by L box, at scale s. */
function CanSprite({ m, L, s }: { m: (typeof SPRITES)[string]; L: number; s: number }) {
  return <Svg width={L} height={L}><G transform={spriteTransform(m, L / 2, L / 2, 0, s)}><SvgImage href={m.src} width={m.w} height={m.h} /></G></Svg>;
}

type Props = {
  ready: boolean; reduced: boolean; tempo: number; width: number; viewH: SharedValue<number>; viewHNow: number; s: number;
  /** The plant whose wet spot the rose is over, from a point in the wrapper's frame (RG25's hit test on the canvas). */
  targetAt: (pt: { x: number; y: number }) => PlantId | null;
  /** Where the tap's pour puts the rose for `plant`, and the ground the drops land on, in the wrapper's frame. */
  spotOf: (plant: PlantId) => { rose: { x: number; y: number }; groundY: number };
  /** The tap's plant: the first with a closed bud. */
  tapTarget: PlantId | null;
  /** The watering request (the same call for drag and tap); resolves false when it failed. `target` is the plant poured on, null for a tap. */
  onPour: (target: PlantId | null) => Promise<boolean>;
  /** The pour's sequence is over (the can is home), whatever the request did. */
  onPourEnd: () => void;
  onNudge: () => void;
};

/**
 * R175, the can in the garden: at its bottom right, under the soil's edge and always there. No bud waiting: greyed (desaturated at 45
 * percent), not draggable, and a tap only says so. A bud waiting: in colour, one wobble on arrival. One finger on the can (and only on
 * it, so it never fights the garden's two-finger zoom) lifts it and it follows the finger, tilting to pour; released over a plant with a
 * bud it pours there while the watering runs (the drops, then the garden opens from the scene diff, that plant first); released
 * elsewhere it glides back. A tap waters every bud: the can goes to the first plant with a bud, pours and comes back (G11's sequence).
 * A failed watering sends it straight back (Home's line says why). The can keeps its colour until its sequence ends, and no second
 * pick-up starts while one runs. Reduced motion: no wobble, lift, tilt, slide or drops; the pour is a 300 ms fade home.
 * R184: 2.2x the first can, a soft contact shadow under it in both states (lighter while it is held), and while a bud waits one drop
 * forming at the rose every 4 s (none when greyed, held or pouring, none under reduced motion). The touch box lies wholly inside the
 * garden's wrapper (canHit, canBelow).
 */
export function Can({ ready, reduced, tempo, width, viewH, viewHNow, s, targetAt, spotOf, tapTarget, onPour, onPourEnd, onNudge }: Props) {
  const dx = useSharedValue(0), dy = useSharedValue(0), tilt = useSharedValue(0), lift = useSharedValue(1), wobble = useSharedValue(0), tilted = useSharedValue(false), seen = useSharedValue(1);
  const busy = useSharedValue(false);   // one pour at a time (a shared value, so the gesture's callbacks may read it)
  const held = useSharedValue(false);   // in the hand or pouring: the shadow lightens and the drip stops at once
  const [pouring, setPouring] = useState(false);
  const [holding, setHolding] = useState(false);   // in the hand: the drip's loop is unmounted (stopped), not hidden (round 5)
  const inColour = ready || pouring;    // the minor: the can does not grey mid-pour (the read that empties the buds lands while it pours)
  const [drops, setDrops] = useState<{ x: number; y: number; groundY: number } | null>(null);
  const hit = canHit(s), L = canArt(s);   // the touch box (R184 item 5) and the drawing layers' square about the body's centre

  // One wobble when a bud arrives (and when Home opens on a waiting bud): a few degrees over 600 ms, then still.
  useEffect(() => {
    if (!ready || reduced) return;
    wobble.value = withSequence(withTiming(6, { duration: 120 }), withTiming(-5, { duration: 160 }), withTiming(3, { duration: 160 }), withTiming(0, { duration: 160 }));
  }, [ready, reduced, wobble]);

  const t = (share: number) => (reduced ? 0 : share * CAN_MS * tempo);
  /** Level (70 to 82 percent) while gliding home (82 to 100), together, so a can released off every plant goes straight back. */
  const goHome = () => {
    if (reduced) {   // R175: a 300 ms fade, not a jump
      seen.value = withSequence(withTiming(0, { duration: REDUCED_MS / 2 }), withTiming(1, { duration: REDUCED_MS / 2 }));
      for (const v of [dx, dy, tilt]) v.value = withDelay(REDUCED_MS / 2, withTiming(0, { duration: 0 }));
      lift.value = 1; tilted.value = false; held.value = false; setHolding(false);
      return;
    }
    tilt.value = withTiming(0, { duration: t(0.12) });
    dx.value = withTiming(0, { duration: t(0.18), easing: Easing.inOut(Easing.cubic) });
    dy.value = withTiming(0, { duration: t(0.18), easing: Easing.inOut(Easing.cubic) });
    lift.value = withTiming(1, { duration: t(0.18) });
    tilted.value = false; held.value = false; setHolding(false);
  };
  /** The pour, for both paths: the request starts at once; the can (moved to `to` for a tap) tilts and pours, and holds the pose while
   * the request runs, at least the pour's share of the sequence; then level and home. A failed request cuts every step short. */
  async function pour(target: PlantId | null, to: PlantId | null) {
    if (busy.value) return;
    busy.value = true; held.value = true; setPouring(true);
    let failed = false;
    const req = onPour(target).catch(() => false).then((ok) => { failed = !ok; });
    const home = canHome(width, viewHNow, s), r = roseAt(TILT, s);
    const where = to ?? target;
    if (to && !reduced) {   // reduced motion: the can pours where it sits
      const spot = spotOf(to).rose;
      if (!reduced) lift.value = withTiming(LIFT, { duration: 150 });
      dx.value = withTiming(spot.x - r.x - home.x, { duration: t(0.18), easing: Easing.inOut(Easing.cubic) });
      dy.value = withTiming(spot.y - r.y - home.y, { duration: t(0.18), easing: Easing.inOut(Easing.cubic) });
      await sleep(t(0.18));
    }
    if (!failed && !reduced && Math.abs(tilt.value - TILT) > 1) {   // a drag arrives already tilted
      tilt.value = withTiming(TILT, { duration: t(0.14), easing: Easing.inOut(Easing.ease) });
      await sleep(t(0.14));
    }
    if (!failed && where && !reduced) { const rr = roseAt(tilt.value, s); setDrops({ x: home.x + dx.value + rr.x, y: home.y + dy.value + rr.y, groundY: spotOf(where).groundY }); }
    const least = sleep(t(0.38));
    await req;
    if (!failed) await least;
    setDrops(null);
    goHome();
    await sleep(reduced ? REDUCED_MS : t(0.18));
    busy.value = false; setPouring(false); onPourEnd();
  }
  const tap = () => { if (tapTarget) void pour(null, tapTarget); };
  const release = (x: number, y: number) => {
    const target = targetAt({ x, y });
    if (target) void pour(target, null);
    else goHome();
  };

  const drag = Gesture.Pan()
    .manualActivation(true)
    .maxPointers(1)   // R173: two fingers zoom the garden; they never pour
    .hitSlop(8)
    // at once, so the screen's scroll never takes a drag that began on the can; refused while a pour runs, so a grab never strands it
    .onTouchesDown((_e, manager) => { if (busy.value) manager.fail(); else manager.activate(); })
    .onStart(() => { held.value = true; runOnJS(setHolding)(true); if (!reduced) lift.value = withTiming(LIFT, { duration: 120 }); })
    .onUpdate((e) => {
      dx.value = e.translationX; dy.value = e.translationY;
      if (!reduced && !tilted.value && Math.hypot(e.translationX, e.translationY) > MOVED) { tilted.value = true; tilt.value = withTiming(TILT, { duration: 300 }); }
    })
    .onEnd((e, success) => {
      if (!success) { runOnJS(goHome)(); return; }
      if (Math.hypot(e.translationX, e.translationY) <= MOVED) { lift.value = 1; dx.value = 0; dy.value = 0; held.value = false; runOnJS(setHolding)(false); runOnJS(tap)(); return; }
      const home = canHome(width, viewH.value, s), r = roseAt(tilt.value, s);
      runOnJS(release)(home.x + dx.value + r.x, home.y + dy.value + r.y);
    })
    .enabled(inColour);
  const nudge = Gesture.Tap().hitSlop(8).onEnd(() => { runOnJS(onNudge)(); }).enabled(!inColour);
  const gesture = Gesture.Exclusive(drag, nudge);

  const place = useAnimatedStyle(() => {
    const home = canHome(width, viewH.value, s);
    return { opacity: seen.value, transform: [{ translateX: home.x + dx.value - hit.ox }, { translateY: home.y + dy.value - hit.oy }, { rotate: `${wobble.value}deg` }, { scale: lift.value }] };
  });
  const shadowStyle = useAnimatedStyle(() => ({ opacity: held.value ? 0.45 : 1 }));
  // the rest sprite turns with the tilt; past halfway the tilted sprite (no shadow, baked at -40) takes over (gen11: the swap at 25 percent)
  const restStyle = useAnimatedStyle(() => ({ opacity: tilt.value > TILT / 2 ? 1 : 0, transform: [{ rotate: `${tilt.value}deg` }] }));
  const tiltStyle = useAnimatedStyle(() => ({ opacity: tilt.value > TILT / 2 ? 0 : 1, transform: [{ rotate: `${tilt.value - TILT}deg` }] }));
  if (!REST || !TILTED || !GREY || !SHADOW) return null;
  const art = { position: "absolute", left: hit.ox - L / 2, top: hit.oy - L / 2, width: L, height: L } as const;
  const rose = roseAt(0, s);
  return (
    <>
      {drops ? <Drops x={drops.x} y={drops.y} groundY={drops.groundY} size={dropSize(s)} tempo={tempo} /> : null}
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[{ position: "absolute", left: 0, top: 0, width: hit.w, height: hit.h }, place]}
          accessible
          accessibilityRole="button"
          accessibilityLabel={inColour ? "Water the garden" : "Nothing to water yet"}
          accessibilityActions={[{ name: "activate" }]}
          onAccessibilityAction={() => (inColour ? tap() : onNudge())}
        >
          <Animated.View style={[{ position: "absolute", left: hit.ox + SHADOW_AT.x * s - L / 2, top: hit.oy + SHADOW_AT.y * s - L / 2, width: L, height: L }, shadowStyle]}><CanSprite m={SHADOW} L={L} s={s} /></Animated.View>
          <Animated.View style={[art, restStyle]}><CanSprite m={inColour ? REST : GREY} L={L} s={s} /></Animated.View>
          <Animated.View style={[art, tiltStyle]}><CanSprite m={TILTED} L={L} s={s} /></Animated.View>
          {ready && !pouring && !holding && !reduced ? <Drip x={hit.ox + rose.x} y={hit.oy + rose.y} size={dropSize(s)} held={held} /> : null}
        </Animated.View>
      </GestureDetector>
    </>
  );
}

/** The drops (gen11_motion.py:161): four 2.4 by 4 ellipses in WATER from the rose plus (-2 i, 5 + 3 i), falling to the plant's ground over
 * 1.05 s, again and again while the can pours. `size` is screen px per canvas px. */
function Drops({ x, y, groundY, size, tempo }: { x: number; y: number; groundY: number; size: number; tempo: number }) {
  return <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }}>{[0, 1, 2, 3].map((i) => <Drop key={i} i={i} x={x - 2 * i * size} y={y + (5 + 3 * i) * size} groundY={groundY} size={size} ms={1050 * tempo} />)}</View>;
}
function Drop({ i, x, y, groundY, size, ms }: { i: number; x: number; y: number; groundY: number; size: number; ms: number }) {
  const q = useSharedValue(0);
  useEffect(() => {
    q.value = withDelay(i * 0.12 * ms, withRepeat(withTiming(1, { duration: ms, easing: Easing.in(Easing.quad) }), -1, false));
    return () => cancelAnimation(q);
  }, [q, i, ms]);
  const fall = Math.max(0, groundY - y);
  const style = useAnimatedStyle(() => ({ opacity: q.value > 0.85 ? (1 - q.value) / 0.15 : 0.9, transform: [{ translateY: q.value * fall }] }));
  return <Animated.View style={[{ position: "absolute", left: x - 1.2 * size, top: y - 2 * size, width: 2.4 * size, height: 4 * size, borderRadius: 2 * size, backgroundColor: WATER }, style]} />;
}

/** R184 item 3: while a bud waits, one drop forms at the rose (it swells in), falls DRIP.fallPx and fades, once every 4 s; the same
 * drop drawing as the pour's, moved by an Animated.View's transform and opacity (the proven path). Hidden on the UI thread the instant
 * the can is held (`held`), and unmounted with it, so its loop stops (cancelled on unmount) and restarts from the start on release. */
function Drip({ x, y, size, held }: { x: number; y: number; size: number; held: SharedValue<boolean> }) {
  const q = useSharedValue(0);
  useEffect(() => {
    const rest = DRIP.everyMs - DRIP.formMs - DRIP.fallMs;
    q.value = withRepeat(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: DRIP.formMs, easing: Easing.out(Easing.quad) }), withTiming(2, { duration: DRIP.fallMs, easing: Easing.in(Easing.quad) }), withTiming(3, { duration: rest })), -1, false);
    return () => cancelAnimation(q);
  }, [q]);
  const style = useAnimatedStyle(() => {
    const v = q.value, on = held.value ? 0 : 1;
    if (v < 1) return { opacity: 0.85 * v * on, transform: [{ translateY: 0 }, { scale: Math.max(0.01, v) }] };
    if (v < 2) return { opacity: 0.85 * (2 - v) * on, transform: [{ translateY: (v - 1) * DRIP.fallPx }, { scale: 1 }] };
    return { opacity: 0, transform: [{ translateY: DRIP.fallPx }, { scale: 1 }] };
  });
  return <Animated.View pointerEvents="none" style={[{ position: "absolute", left: x - 1.2 * size, top: y, width: 2.4 * size, height: 4 * size, borderRadius: 2 * size, backgroundColor: WATER }, style]} />;
}
