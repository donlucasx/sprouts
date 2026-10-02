import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import Svg, { Defs, ClipPath, Mask, Rect, G, Image as SvgImage } from "react-native-svg";
import Animated, { useSharedValue, useAnimatedProps, useAnimatedStyle, withDelay, withTiming, Easing } from "react-native-reanimated";
import type { Placed } from "@/model/species";
import { leafLen } from "@/model/plant-geometry";
import { frameAt } from "@/model/motion";
import { STRIPS } from "./strips";
import { SpriteAt, PaintedStem } from "./parts";

const AnimatedImage = Animated.createAnimatedComponent(SvgImage);
const AnimatedG = Animated.createAnimatedComponent(G);
const FLOW = Easing.bezier(0.18, 0.72, 0.3, 1);   // gen11_motion.py:31 FLOW
const EASE_IN = Easing.bezier(0.42, 0, 1, 1);     // CSS ease-in (gen11_motion.py:156 budout)

/** One opening leaf (RG24 part two, the ledger's A-STRIP): the species' own dry sprite revealed through its shape's baked wash11 strip
 * (16 frames, a density mask), the strip under a STATIC one-frame clip and stepped by whole frames through ONE animated prop, the mask
 * Image's x. The frame box sits with its base row (0.93 of the frame, wash11.py:49) on the leaf's anchor and its axis along the leaf's
 * rotation; the strip's 26.88 px leaf is scaled to the placed leaf's length. Reduced motion: the last frame under a 300 ms fade
 * (`ms` is then 300). Drawn as a child of the plant's Svg, over its static parts. */
export function Strip({ p, id, shape, delay, ms, reduced }: { p: Extract<Placed, { kind: "sprite" }>; id: string; shape: keyof typeof STRIPS; delay: number; ms: number; reduced: boolean }) {
  const st = STRIPS[shape];
  const s = leafLen(p) / st.L, fw = st.w * s, fh = st.h * s;
  const t = useSharedValue(0);
  useEffect(() => { t.value = 0; t.value = withDelay(delay, withTiming(1, { duration: ms, easing: Easing.linear })); }, [t, delay, ms]);
  const maskProps = useAnimatedProps(() => ({ x: -(reduced ? st.frames - 1 : frameAt(t.value, st.frames)) * fw }));
  const fadeProps = useAnimatedProps(() => ({ opacity: reduced ? t.value : 1 }));
  return (
    <G transform={`translate(${p.x} ${p.y}) rotate(${p.rot}) translate(${-fw / 2} ${-st.ay * s})`}>
      <Defs>
        <ClipPath id={`${id}-clip`}><Rect x={0} y={0} width={fw} height={fh} /></ClipPath>
        <Mask id={id} x={0} y={0} width={fw} height={fh} maskUnits="userSpaceOnUse">
          <G clipPath={`url(#${id}-clip)`}><AnimatedImage href={st.src} y={0} width={fw * st.frames} height={fh} animatedProps={maskProps} /></G>
        </Mask>
      </Defs>
      <AnimatedG mask={`url(#${id})`} animatedProps={fadeProps}><SpriteAt name={p.name} x={fw / 2} y={st.ay * s} rot={0} scale={p.scale} xScale={p.xScale} /></AnimatedG>
    </G>
  );
}

/** Something that fades: in (a new bud swelling in, a token arriving, a seed, an opening shoot's tier or pup, the rings after a watering)
 * or out (the closed bud becoming its leaves: 1.4 s ease-in from 0.25 s after its first leaf's stroke, gen11_motion.py:156, :193, so
 * the leaves grow out of it). An SVG group: drawn inside the Svg it belongs to. */
export function Appear({ delay, ms, out = false, children }: { delay: number; ms: number; out?: boolean; children: ReactNode }) {
  const o = useSharedValue(out ? 1 : 0);
  useEffect(() => { o.value = out ? 1 : 0; o.value = withDelay(delay, withTiming(out ? 0 : 1, { duration: ms, easing: out ? EASE_IN : Easing.out(Easing.cubic) })); }, [o, delay, ms, out]);
  const props = useAnimatedProps(() => ({ opacity: o.value }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

/** The stem reveal (a twig's or branch's painted stem, 0.6 s; the ledger's A-WASH `view`: never animatedProps on a ClipPath child): the
 * stem's paths in their own Svg, revealed along the stem's axis from its node by an Animated.View with overflow hidden and an animated
 * extent. (ox, oy) is the plant's foot in the swaying view. Reduced motion: a 300 ms fade. */
export function StemReveal({ s, ox, oy, delay, ms, reduced }: { s: Extract<Placed, { kind: "stem" }>; ox: number; oy: number; delay: number; ms: number; reduced: boolean }) {
  const R = Math.ceil(Math.hypot(s.x1 - s.x0, s.y1 - s.y0) + 6), S = 2 * R;
  const axis = (Math.atan2(s.x1 - s.x0, -(s.y1 - s.y0)) * 180) / Math.PI;   // degrees from straight up
  const t = useSharedValue(0);
  useEffect(() => { t.value = 0; t.value = withDelay(delay, withTiming(1, { duration: ms, easing: FLOW })); }, [t, delay, ms]);
  const reveal = useAnimatedStyle(() => ({ height: R * t.value }));   // the inner view starts AT the node (the frame's centre) and grows R px along the stem
  const fade = useAnimatedStyle(() => ({ opacity: t.value }));        // hooks run unconditionally; reduced motion only picks a tree
  const art = <Svg width={S} height={S}><G x={R - s.x0} y={R - s.y0}><PaintedStem s={s} /></G></Svg>;
  const box = { position: "absolute", left: ox + s.x0 - R, top: oy + s.y0 - R, width: S, height: S } as const;
  if (reduced) return <Animated.View style={[box, fade]} pointerEvents="none">{art}</Animated.View>;
  // the frame is rotated by the axis so "down" runs along the stem; the art inside is counter-rotated so it stays upright
  return (
    <View style={[box, { transform: [{ rotate: `${axis + 180}deg` }] }]} pointerEvents="none">
      <Animated.View style={[{ position: "absolute", left: 0, top: R, width: S, overflow: "hidden" }, reveal]}>
        <View style={{ position: "absolute", left: 0, top: -R, width: S, height: S, transform: [{ rotate: `${-(axis + 180)}deg` }] }}>{art}</View>
      </Animated.View>
    </View>
  );
}
