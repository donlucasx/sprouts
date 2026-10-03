import { useEffect } from "react";
import { View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming, type SharedValue } from "react-native-reanimated";
import { STREAM, streamDrop, streamPiece } from "@/model/can";
import { WATER } from "./parts";

const BASE = 100;   // every piece is drawn BASE px tall and scaled to its length (transform, the proven path; no animated layout)
const TAU = Math.PI * 2;

type Flow = {
  /** The rose on screen (roseOnScreen), followed on the UI thread while the can moves. */
  rose: SharedValue<{ x: number; y: number }>;
  /** The ground the water lands on, px from the overlay's top. */
  ground: SharedValue<number>;
  /** How far the stream has grown from the rose (0 to 1) and how much of it shows (its fade, 0 to 1). */
  grown: SharedValue<number>; alpha: SharedValue<number>;
  /** Screen px per canvas px (dropSize); `tempo` slows the clock with the rest of the garden. */
  size: number; tempo: number;
};

/**
 * R201, the can's water (his pick: "a thin see-through stream from the rose that wavers slightly, breaking into a few drops near the
 * soil, a small splash where it lands"; replaces G11's four dense drops): STREAM's thin column in WATER at low opacity, each piece an
 * Animated.View moved and scaled by its transform (Android's proven path: no SVG clip or mask animates), the pieces swinging on one
 * clock so the column bends gently; then the drops, then the splash ring and its two droplets at the ground. Mounted only while the can
 * pours (its clock stops with it); never under reduced motion (the can does not pour then).
 */
export function Stream({ rose, ground, grown, alpha, size, tempo }: Flow) {
  const q = useSharedValue(0);
  useEffect(() => {
    q.value = 0; q.value = withRepeat(withTiming(1, { duration: STREAM.clockMs * tempo, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(q);
  }, [q, tempo]);
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }}>
      {STREAM.widths.map((w, k) => <Piece key={`p${k}`} k={k} w={w * size} f={{ rose, ground, grown, alpha, size, tempo }} q={q} />)}
      {Array.from({ length: STREAM.drops }, (_, i) => <Drop key={`d${i}`} i={i} f={{ rose, ground, grown, alpha, size, tempo }} q={q} />)}
      <Splash f={{ rose, ground, grown, alpha, size, tempo }} q={q} />
      {[-1, 1].map((side) => <Spray key={`s${side}`} side={side} f={{ rose, ground, grown, alpha, size, tempo }} q={q} />)}
    </View>
  );
}

/** The sideways swing at piece k (0 at the rose): a slow sway, larger down the column, each piece a little behind the one above. */
const swing = (k: number, q: number, size: number) => {
  "worklet";
  return STREAM.waver * size * k * Math.sin(TAU * q - k * 0.9) + 0.25 * size * k * Math.sin(TAU * 3 * q + k);
};
/** The broken part shows once the stream has reached the ground (its last third of growth). */
const landed = (grown: number) => {
  "worklet";
  return Math.min(1, Math.max(0, (grown - 0.7) / 0.3));
};

function Piece({ k, w, f, q }: { k: number; w: number; f: Flow; q: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const fall = f.ground.value - f.rose.value.y, at = streamPiece(k, fall, f.grown.value);
    return {
      opacity: STREAM.opacity * f.alpha.value * (at.h > 0 ? 1 : 0),
      transform: [{ translateX: f.rose.value.x - w / 2 + swing(k, q.value, f.size) }, { translateY: f.rose.value.y + at.top - 0.5 }, { scaleY: Math.max(0.001, (at.h + 1) / BASE) }],
    };
  });
  return <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: w, height: BASE, borderRadius: w / 2, backgroundColor: WATER, transformOrigin: [w / 2, 0, 0] }, style]} />;
}

function Drop({ i, f, q }: { i: number; f: Flow; q: SharedValue<number> }) {
  const w = STREAM.dropW * f.size, h = STREAM.dropH * f.size;
  const style = useAnimatedStyle(() => {
    const fall = f.ground.value - f.rose.value.y, d = streamDrop(i, q.value, fall);
    return {
      opacity: STREAM.opacity * 1.2 * f.alpha.value * landed(f.grown.value) * d.alpha,
      transform: [{ translateX: f.rose.value.x - w / 2 + swing(STREAM.segments, q.value, f.size) + (i - 1) * 0.7 * f.size }, { translateY: f.rose.value.y + d.y - h }],
    };
  });
  return <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: w, height: h, borderRadius: w / 2, backgroundColor: WATER }, style]} />;
}

/** The splash: a flat ring at the ground that spreads and fades with each drop's landing. */
function Splash({ f, q }: { f: Flow; q: SharedValue<number> }) {
  const w = STREAM.splashW * f.size, h = STREAM.splashH * f.size;
  const style = useAnimatedStyle(() => {
    const p = (q.value * STREAM.beats + 0.1) % 1;
    return {
      opacity: STREAM.opacity * 1.1 * f.alpha.value * landed(f.grown.value) * (1 - p),
      transform: [{ translateX: f.rose.value.x - w / 2 + swing(STREAM.segments, q.value, f.size) }, { translateY: f.ground.value - h / 2 }, { scaleX: 0.35 + 0.9 * p }, { scaleY: 0.6 + 0.4 * p }],
    };
  });
  return <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: w, height: h, borderRadius: h, borderWidth: Math.max(0.75, 0.45 * f.size), borderColor: WATER }, style]} />;
}

/** A droplet hopping out of the splash to one side, on a short arc, fading as it falls back. */
function Spray({ side, f, q }: { side: number; f: Flow; q: SharedValue<number> }) {
  const d = 0.9 * f.size;
  const style = useAnimatedStyle(() => {
    const p = (q.value * STREAM.beats + (side > 0 ? 0.25 : 0.6)) % 1;
    return {
      opacity: STREAM.opacity * f.alpha.value * landed(f.grown.value) * (p < 0.8 ? 1 - p / 0.8 : 0),
      transform: [{ translateX: f.rose.value.x - d / 2 + swing(STREAM.segments, q.value, f.size) + side * p * 3.5 * f.size }, { translateY: f.ground.value - d - Math.sin(Math.PI * Math.min(1, p / 0.8)) * 3.5 * f.size }],
    };
  });
  return <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: d, height: d, borderRadius: d / 2, backgroundColor: WATER }, style]} />;
}
