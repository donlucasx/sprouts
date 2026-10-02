import { useEffect } from "react";
import { useWindowDimensions } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { G } from "react-native-svg";
import type { Scene, Part } from "@/model/garden";
import { CANVAS, FOOT_Y, FRAME, frameFor, signX } from "@/model/layout";
import { plantLayouts } from "@/model/scene-to-layout";
import { Plant } from "./Plant";
import { Soil, Ring, Seed, Sign, Basket, SpriteAt } from "./parts";

const MOUNT_FADE_MS = 300;

/** Spec 5: the canvas is the width minus 40 by 260; two rows; the back row draws first. `justOpened` is read by Task I4's washes. */
export function Garden({ scene }: { scene: Scene; justOpened: Set<string> }) {
  const { width } = useWindowDimensions(); const w = width - 40;
  const of = <K extends Part["kind"]>(kind: K) => scene.parts.filter((p): p is Extract<Part, { kind: K }> => p.kind === kind);
  const plants = plantLayouts(scene);
  const footOf = (plant: string) => { const pl = plants.find((p) => p.plant === plant) ?? of("sign").find((s) => s.plant === plant); return pl ? { x: pl.x * w, y: FOOT_Y(pl.row) } : { x: w * 0.4, y: CANVAS.frontFeet }; };
  const back = plants.filter((p) => p.row === "back"), front = plants.filter((p) => p.row === "front");
  // RG30: one frame on the whole garden, eased over 1.2 s (none under reduced motion). The transform's origin is the top-left, so a
  // canvas point p lands at (p - frame) * zoom and the frame fills the view; x and zoom ease linearly, and since the frame's right
  // limit (width - width / zoom) is concave in a linearly eased zoom, a frame inside the bed at both ends stays inside it throughout.
  const target = frameFor(scene, plants, w), reduced = useReducedMotion();
  const fx = useSharedValue(target.x), fy = useSharedValue(target.y), z = useSharedValue(target.zoom);
  useEffect(() => {
    const t = { duration: reduced ? 0 : FRAME.easeMs, easing: Easing.inOut(Easing.cubic) };
    fx.value = withTiming(target.x, t); fy.value = withTiming(target.y, t); z.value = withTiming(target.zoom, t);
  }, [target.x, target.y, target.zoom, reduced, fx, fy, z]);
  const framed = useAnimatedStyle(() => ({ transform: [{ translateX: -fx.value * z.value }, { translateY: -fy.value * z.value }, { scale: z.value }] }));
  // Spec 8's first frame: react-native-svg loads bundled PNGs through Fresco asynchronously on Android, so the garden fades in over
  // 300 ms on mount and no sprite pops in on its own.
  const shown = useSharedValue(0);
  useEffect(() => { shown.value = withTiming(1, { duration: MOUNT_FADE_MS }); }, [shown]);
  const fadeIn = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <Animated.View style={[{ width: w, height: CANVAS.height, overflow: "hidden" }, fadeIn]}>
     <Animated.View style={[{ width: w, height: CANVAS.height, transformOrigin: "0 0" }, framed]}>
      <Svg width={w} height={CANVAS.height} style={{ position: "absolute" }}>
        <Soil width={w} soilY={CANVAS.soilLine} />
        {of("ring").map((r) => { const f = footOf(r.plant); return <G key={`r${r.plant}`} x={f.x} y={f.y + 2}><Ring age={r.age} k={r.plant === "skr" || r.plant === "ore" ? 1 : 2 / 3} /></G>; })}
        {of("seed").map((s) => { const f = footOf(s.plant); return <G key={s.id} x={f.x} y={f.y + 1}><Seed index={s.index} /></G>; })}
        {of("sign").map((s) => { const scale = s.row === "front" ? 1 : 0.8; return <G key={`s${s.plant}`} x={signX(s.x * w, s.side, w, scale)} y={FOOT_Y(s.row) + 4}><Sign plant={s.plant} scale={scale} /></G>; })}
        {of("basket").length ? <G x={w - 40} y={CANVAS.soilLine + 30}><Basket /></G> : null}
        {/* Spec 3: the paper grain once over the whole garden, the static Svg's last child (app only). */}
        <G opacity={0.5}><SpriteAt name="grain" x={0} y={0} scale={CANVAS.height / 260} xScale={w / 320} /></G>
      </Svg>
      {[...back, ...front].map((p) => <Plant key={p.plant} p={p} footX={p.x * w} footY={FOOT_Y(p.row)} />)}
     </Animated.View>
    </Animated.View>
  );
}
