import { useEffect, useState } from "react";
import Svg, { G, Image as SvgImage } from "react-native-svg";
import Animated, { Easing, runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withRepeat, withSequence, withTiming, cancelAnimation, type SharedValue } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { spriteTransform } from "@/model/paint";
import type { PlantId } from "@/model/garden";
import { SPRITES } from "./sprites";
import { WATER } from "./parts";
import { Stream } from "./Pour";
import { REDUCED_MS } from "@/model/opening";
import { canArt, canHit, canSeat, clampDrag, dropSize, grabAt, roseAt, roseOnScreen, CAN_MS, DRIP, POUR_SHARE, STREAM, WOBBLE_WAIT_MS } from "@/model/can";

const TILT = -40, LIFT = 1.08, MOVED = 8, HOVER_STEP = 3, TILT_MS = 350;
const REST = SPRITES["can"], TILTED = SPRITES["can-tilt"], GREY = SPRITES["can-grey"];   // can-grey: baked desaturated at 45 percent (ruling d)
const SHADOW = SPRITES["can-shadow"];   // R184: the contact shadow, centred under the body's base (can11.py: the base at y +17)
const SHADOW_AT = { x: -1, y: 18.5 };   // sprite units from the body's centre
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** A sequence's own state, kept outside React's render (the gesture reaches it through runOnJS): its watering request, whether that
 * failed, the plant the rose is over, and the stream's generation (a stop's unmount never takes a stream started after it). */
type Seq = { req: Promise<boolean> | null; failed: boolean; over: PlantId | null; gen: number };
const newSeq = (): Seq => ({ req: null, failed: false, over: null, gen: 0 });
const put = <K extends keyof Seq>(q: Seq, k: K, v: Seq[K]) => { q[k] = v; };

/** One sprite with its anchor at the centre of an L by L box, at scale s. */
function CanSprite({ m, L, s }: { m: (typeof SPRITES)[string]; L: number; s: number }) {
  return <Svg width={L} height={L}><G transform={spriteTransform(m, L / 2, L / 2, 0, s)}><SvgImage href={m.src} width={m.w} height={m.h} /></G></Svg>;
}

type Props = {
  ready: boolean; reduced: boolean; tempo: number; width: number; s: number;
  /** R195: bumped on every landing on the garden and every pull-to-refresh; each bump replays the wobble while a bud waits. */
  wobbleKey: number;
  /** R196: the overlay's width (the garden's plus the screen's right gutter): the finger's point stays inside it. */
  overlayW: number;
  /** The garden view's height (eased on the UI thread) and its value now; the overlay's origin is the garden view's top-left. */
  viewH: SharedValue<number>; viewHNow: number;
  /** R186: the bar's centre, px below the garden view's bottom, and the overlay's height below that bottom (the row's bottom). */
  barBelow: number; overlayBelow: number;
  /** The plant still waiting for water whose wet spot the rose is over, from a point in the overlay's frame (RG25's hit test). */
  targetAt: (pt: { x: number; y: number }) => PlantId | null;
  /** Where the tap's pour puts the rose for `plant`, and the ground the water lands on, in the overlay's frame. */
  spotOf: (plant: PlantId) => { rose: { x: number; y: number }; groundY: number };
  /** The tap's plant: the first with a closed bud. */
  tapTarget: PlantId | null;
  /** The watering request (one per sequence, the same call for drag and tap); resolves false when it failed. `target` is the plant
   * first poured on (null for a tap); `drag` holds each plant's opening until the can reaches it (R201). */
  onPour: (target: PlantId | null, drag: boolean) => Promise<boolean>;
  /** R201: the dragged can's rose reached `plant` (its opening may play), and the drag ended (every plant not reached opens). */
  onVisit: (plant: PlantId) => void; onDrop: () => void;
  /** R202: resolves when the watering's opening has ended (or, the read never bringing one, after a guard). */
  afterOpening: () => Promise<void>;
  /** The pour's sequence is over (the can is home), whatever the request did. */
  onPourEnd: () => void;
  onNudge: () => void;
};

/**
 * R186, the can at the end of the Next planting bar: drawn in an overlay over the garden and the row (its origin the garden view's
 * top-left), seated at the bar's right end and vertically centred on it, always there; it travels up over the garden when dragged and
 * glides back to the bar after the pour. No bud waiting: greyed (desaturated at 45 percent), not draggable, and a tap only says so. A
 * bud waiting: in colour, and one wobble WOBBLE_WAIT_MS after it shows ready, replayed on every landing and pull-to-refresh (R195,
 * `wobbleKey`). One finger on the can (and only on it, so it never fights the garden's two-finger zoom) lifts it and it follows the
 * finger, level. R201 (his addition: "when dragging it should animate over each plant that needs it"; Claude's reading, flagged in
 * the log): whenever the rose (where it would pour, at -40 degrees) is over a plant still waiting for water, the can tilts and pours
 * there; the first such plant sends the watering (the API opens every bud), each plant reached plays its opening (onVisit), and on
 * release every plant not reached opens (onDrop). Released over such a plant it keeps pouring there at least the pour's share of the
 * sequence and while the request runs; released elsewhere after a pour it goes home; released with nothing poured it goes home and
 * nothing is watered. A tap waters every bud: the can goes to the first plant with a bud, pours and opens them all (G11's sequence).
 * R202: after the pour the can levels and waits over the plant until the opening ends, then goes home. A failed watering stops the
 * pour and sends the can home (Home's line says why). The can keeps its colour until its sequence ends, and no second pick-up starts
 * while one runs. Reduced motion: no wobble, lift, tilt, slide or water; the pour is a 300 ms fade home (the openings still release
 * per plant, each as the 300 ms fade). R184, R188: 2.6x the first can, a soft contact shadow under it in both states (lighter while it
 * is held), and while a bud waits one drop forming at the rose every 4 s (none when greyed, held or pouring, none under reduced
 * motion). The touch box lies wholly inside the overlay at its seat (canHit, canRoomBelow); the drag holds the finger inside it and,
 * R196, lets the art hang past the right edge (clampDrag): Android drops touches outside a parent's bounds.
 */
export function Can({ ready, reduced, tempo, width, s, wobbleKey, overlayW, viewH, viewHNow, barBelow, overlayBelow, targetAt, spotOf, tapTarget, onPour, onVisit, onDrop, afterOpening, onPourEnd, onNudge }: Props) {
  const dx = useSharedValue(0), dy = useSharedValue(0), tilt = useSharedValue(0), lift = useSharedValue(1), wobble = useSharedValue(0), seen = useSharedValue(1);
  const busy = useSharedValue(false);   // one watering at a time (a shared value, so the gesture's callbacks may read it)
  const held = useSharedValue(false);   // in the hand or pouring: the shadow lightens and the drip stops at once
  const grab = useSharedValue({ x: 0, y: 0 }), d0 = useSharedValue({ dx: 0, dy: 0 }), sent = useSharedValue({ x: -1e9, y: -1e9 });
  const grown = useSharedValue(0), alpha = useSharedValue(0), ground = useSharedValue(0);   // the stream (R201)
  const [pouring, setPouring] = useState(false);
  const [holding, setHolding] = useState(false);   // in the hand: the drip's loop is unmounted (stopped), not hidden (round 5)
  const [streaming, setStreaming] = useState(false);   // the stream is mounted (its clock runs) only while it shows
  const inColour = ready || pouring;    // the minor: the can does not grey mid-pour (the read that empties the buds lands while it pours)
  const hit = canHit(s), L = canArt(s);   // the touch box (R184 item 5) and the drawing layers' square about the body's centre
  const [seq] = useState(newSeq);

  // R195: one wobble WOBBLE_WAIT_MS after the can shows ready (a bud arrived, or Home opened on one), and again on every landing.
  useEffect(() => {
    if (!ready || reduced) return;   // never drawn while the can is held (place)
    wobble.value = withDelay(WOBBLE_WAIT_MS, withSequence(withTiming(6, { duration: 120 }), withTiming(-5, { duration: 160 }), withTiming(3, { duration: 160 }), withTiming(0, { duration: 160 })));
    return () => { cancelAnimation(wobble); wobble.value = 0; };
  }, [ready, reduced, wobbleKey, wobble]);

  const t = (share: number) => (reduced ? 0 : share * CAN_MS * tempo);
  /** Level (70 to 82 percent) while gliding home (82 to 100), together, so a can released off every plant goes straight back. */
  const goHome = () => {
    if (reduced) {   // R175: a 300 ms fade, not a jump
      seen.value = withSequence(withTiming(0, { duration: REDUCED_MS / 2 }), withTiming(1, { duration: REDUCED_MS / 2 }));
      for (const v of [dx, dy, tilt]) v.value = withDelay(REDUCED_MS / 2, withTiming(0, { duration: 0 }));
      lift.value = 1; held.value = false; setHolding(false);
      return;
    }
    tilt.value = withTiming(0, { duration: t(0.12) });
    dx.value = withTiming(0, { duration: t(0.18), easing: Easing.inOut(Easing.cubic) });
    dy.value = withTiming(0, { duration: t(0.18), easing: Easing.inOut(Easing.cubic) });
    lift.value = withTiming(1, { duration: t(0.18) });
    held.value = false; setHolding(false);
  };
  /** R201: the stream grows from the rose down to `groundY`, and stops by fading (none under reduced motion). */
  const startStream = (groundY: number) => {
    if (reduced) return;
    put(seq, "gen", seq.gen + 1); ground.value = groundY; setStreaming(true);
    grown.value = 0; grown.value = withTiming(1, { duration: STREAM.growMs * tempo, easing: Easing.in(Easing.quad) });
    alpha.value = withTiming(1, { duration: 120 });
  };
  const stopStream = () => {
    const g = seq.gen + 1; put(seq, "gen", g);
    alpha.value = withTiming(0, { duration: STREAM.fadeMs * tempo });
    setTimeout(() => { if (seq.gen === g) setStreaming(false); }, STREAM.fadeMs * tempo + 50);
  };
  /** The sequence's watering request, sent once (the first plant poured on, or the tap); a failure stops the pour where it is. */
  const water = (target: PlantId | null, drag: boolean) => {
    if (seq.req) return;
    busy.value = true; held.value = true; put(seq, "failed", false); setPouring(true);
    put(seq, "req", onPour(target, drag).catch(() => false).then((ok) => {
      if (!ok) { put(seq, "failed", true); stopStream(); if (!reduced) tilt.value = withTiming(0, { duration: TILT_MS }); }
      return ok;
    }));
  };
  /** The end of a sequence. Poured at `where` (a release over a plant, or the tap): the pour holds at least its share of the sequence
   * and while the request runs, then (R202) the can levels and waits for the opening to end, then home. Not poured there (a release
   * off every plant after an earlier pour): home at once, and the sequence ends once the request and the opening have. */
  async function finish(where: PlantId | null) {
    const request = seq.req ?? Promise.resolve(false);
    if (where) {
      if (!seq.failed && !reduced) {
        if (Math.abs(tilt.value - TILT) > 1) { tilt.value = withTiming(TILT, { duration: t(0.14), easing: Easing.inOut(Easing.ease) }); await sleep(t(0.14)); }
        if (alpha.value < 0.5) startStream(spotOf(where).groundY);   // the tap's pour starts here; a drag's is already running
        else ground.value = spotOf(where).groundY;
      }
      const least = sleep(t(POUR_SHARE));
      const ok = await request;
      if (ok) await least;
      stopStream();
      if (ok) { if (!reduced) tilt.value = withTiming(0, { duration: t(0.12) }); await afterOpening(); }
      goHome();
      await sleep(reduced ? REDUCED_MS : t(0.18));
    } else {
      stopStream(); goHome();
      if (await request) await afterOpening();
    }
    put(seq, "req", null); put(seq, "over", null); busy.value = false; setPouring(false); onPourEnd();
  }
  /** The tap: to the first plant with a bud, tilt, pour; the rest as a release there (finish). */
  async function tapPour(to: PlantId) {
    if (busy.value) return;
    water(null, false);
    const home = canSeat(width, viewHNow + barBelow, s), r = roseAt(TILT, s);
    if (!reduced) {   // reduced motion: the can pours where it sits
      const spot = spotOf(to).rose;
      lift.value = withTiming(LIFT, { duration: 150 });
      // the slide is held as the drag is, the box's centre standing for a finger (fix round 1, R196)
      const slide = clampDrag(spot.x - r.x - home.x, spot.y - r.y - home.y, home, hit, { w: overlayW, h: viewHNow + overlayBelow }, LIFT, grabAt(home, hit, { x: hit.w / 2, y: hit.h / 2 }));
      dx.value = withTiming(slide.dx, { duration: t(0.18), easing: Easing.inOut(Easing.cubic) });
      dy.value = withTiming(slide.dy, { duration: t(0.18), easing: Easing.inOut(Easing.cubic) });
      await sleep(t(0.18));
    }
    await finish(to);
  }
  /** A touch that ends where it began. If the drag already sent a watering (it went over a bud and came back), it is that drag's
   * release, never a new tap: the tap would be refused as busy and the sequence never finish (review of fix/check2). */
  const tap = () => {
    if (seq.req) { onDrop(); void finish(null); return; }
    if (tapTarget) void tapPour(tapTarget);
  };
  /** R201, while dragging (the rose's pour point, sent from the UI thread as it moves): over a plant still waiting the can tilts and
   * pours there, the first such plant sends the watering, each one reached may open; off them it levels and the stream stops. */
  const hover = (x: number, y: number) => {
    if (seq.failed) return;
    const target = targetAt({ x, y });
    if (target === seq.over) return;
    put(seq, "over", target);
    if (target) {
      if (!reduced) { tilt.value = withTiming(TILT, { duration: TILT_MS }); startStream(spotOf(target).groundY); }
      water(target, true); onVisit(target);
    } else {
      if (!reduced) tilt.value = withTiming(0, { duration: TILT_MS });
      stopStream();
    }
  };
  const release = (x: number, y: number, moved: boolean) => {
    const target = moved && !seq.failed ? targetAt({ x, y }) : null;
    if (target) { water(target, true); onVisit(target); onDrop(); void finish(target); }
    else if (seq.req) { onDrop(); void finish(null); }
    else { put(seq, "over", null); goHome(); }
  };

  const drag = Gesture.Pan()
    .manualActivation(true)
    .maxPointers(1)   // R173: two fingers zoom the garden; they never pour
    .hitSlop(8)
    // at once, so the screen's scroll never takes a drag that began on the can; refused while a watering runs, so a grab never strands
    // it. The finger's point in the box is kept (R196: the drag holds the finger, not the box, at the right).
    .onTouchesDown((e, manager) => {
      if (busy.value) { manager.fail(); return; }
      const f = e.allTouches[0];
      grab.value = grabAt(canSeat(width, viewH.value + barBelow, s), hit, { x: f ? f.x : hit.w / 2, y: f ? f.y : hit.h / 2 });
      manager.activate();
    })
    .onStart(() => {
      held.value = true; runOnJS(setHolding)(true);
      cancelAnimation(dx); cancelAnimation(dy); d0.value = { dx: dx.value, dy: dy.value }; sent.value = { x: -1e9, y: -1e9 };
      if (!reduced) lift.value = withTiming(LIFT, { duration: 120 });
    })
    .onUpdate((e) => {
      const seat = canSeat(width, viewH.value + barBelow, s);
      const d = clampDrag(d0.value.dx + e.translationX, d0.value.dy + e.translationY, seat, hit, { w: overlayW, h: viewH.value + overlayBelow }, reduced ? 1 : LIFT, grab.value);
      dx.value = d.dx; dy.value = d.dy;
      if (Math.hypot(e.translationX, e.translationY) <= MOVED) return;
      const r = roseOnScreen(seat, d, TILT, lift.value, s, hit);   // where it would pour, tilted or not, so tilting never moves the test
      if (Math.abs(r.x - sent.value.x) + Math.abs(r.y - sent.value.y) < HOVER_STEP) return;
      sent.value = r; runOnJS(hover)(r.x, r.y);
    })
    .onEnd((e, success) => {
      const moved = Math.hypot(e.translationX, e.translationY) > MOVED;
      if (success && !moved) { lift.value = 1; dx.value = 0; dy.value = 0; held.value = false; runOnJS(setHolding)(false); runOnJS(tap)(); return; }
      const r = roseOnScreen(canSeat(width, viewH.value + barBelow, s), { dx: dx.value, dy: dy.value }, TILT, lift.value, s, hit);
      runOnJS(release)(r.x, r.y, success && moved);
    })
    .enabled(inColour);
  const nudge = Gesture.Tap().hitSlop(8).onEnd(() => { runOnJS(onNudge)(); }).enabled(!inColour);
  const gesture = Gesture.Exclusive(drag, nudge);

  const place = useAnimatedStyle(() => {
    const home = canSeat(width, viewH.value + barBelow, s);
    return { opacity: seen.value, transform: [{ translateX: home.x + dx.value - hit.ox }, { translateY: home.y + dy.value - hit.oy }, { rotate: `${held.value ? 0 : wobble.value}deg` }, { scale: lift.value }] };
  });
  const rose = useDerivedValue(() => roseOnScreen(canSeat(width, viewH.value + barBelow, s), { dx: dx.value, dy: dy.value }, tilt.value, lift.value, s, hit));
  const shadowStyle = useAnimatedStyle(() => ({ opacity: held.value ? 0.45 : 1 }));
  // the rest sprite turns with the tilt; past halfway the tilted sprite (no shadow, baked at -40) takes over (gen11: the swap at 25 percent)
  const restStyle = useAnimatedStyle(() => ({ opacity: tilt.value > TILT / 2 ? 1 : 0, transform: [{ rotate: `${tilt.value}deg` }] }));
  const tiltStyle = useAnimatedStyle(() => ({ opacity: tilt.value > TILT / 2 ? 0 : 1, transform: [{ rotate: `${tilt.value - TILT}deg` }] }));
  if (!REST || !TILTED || !GREY || !SHADOW) return null;
  const art = { position: "absolute", left: hit.ox - L / 2, top: hit.oy - L / 2, width: L, height: L } as const;
  const restRose = roseAt(0, s);
  return (
    <>
      {streaming ? <Stream rose={rose} ground={ground} grown={grown} alpha={alpha} size={dropSize(s)} tempo={tempo} /> : null}
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
          {ready && !pouring && !holding && !reduced ? <Drip x={hit.ox + restRose.x} y={hit.oy + restRose.y} size={dropSize(s)} held={held} /> : null}
        </Animated.View>
      </GestureDetector>
    </>
  );
}


/** R184 item 3: while a bud waits, one drop forms at the rose (it swells in), falls DRIP.fallPx and fades, once every 4 s; the same
 * small drop in WATER, moved by an Animated.View's transform and opacity (the proven path). Hidden on the UI thread the instant
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
