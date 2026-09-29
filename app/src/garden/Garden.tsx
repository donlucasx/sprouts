import { useEffect, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import Svg, { G, Circle } from "react-native-svg";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay, Easing } from "react-native-reanimated";
import type { Scene, Part } from "@/model/garden";
import { soilSurface } from "@/model/soil";
import { Soil, Sprout, Succulent, Transplant, Fruit, Ripening, Pup, Basket, WetSpot, INK } from "./parts";

const HEIGHT = 260;

/**
 * Every animated part is its own small Svg inside an Animated.View: `useAnimatedStyle` with rotate, scale and opacity is the
 * documented Reanimated path, and animating `transform` on an SVG G through animatedProps has an Android failure on record [A21].
 */
function Sway({ children, seed, w, h }: { children: ReactNode; seed: number; w: number; h: number }) {
  const angle = useSharedValue(0);
  useEffect(() => {
    angle.value = withRepeat(
      withSequence(
        withTiming(1.5, { duration: 1800 + seed * 90, easing: Easing.inOut(Easing.sin) }),
        withTiming(-1.5, { duration: 1800 + seed * 90, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
  }, [angle, seed]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
  return (
    <Animated.View style={[{ width: w, height: h, transformOrigin: "bottom center" }, style]}>
      <Svg width={w} height={h}>{children}</Svg>
    </Animated.View>
  );
}

/** Positions a part on the garden; when it was a bud until this reveal it blooms in (scale from 0.2 with a fade), one after another. */
function Bloom({ children, order, active, x, y, w, h }: { children: ReactNode; order: number; active: boolean; x: number; y: number; w: number; h: number }) {
  const t = useSharedValue(active ? 0 : 1);
  useEffect(() => {
    if (active) t.value = withDelay(order * 260, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [active, order, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.2 + 0.8 * t.value, transform: [{ scale: 0.2 + 0.8 * t.value }] }));
  return <Animated.View style={[{ position: "absolute", left: x, top: y, width: w, height: h }, style]}>{children}</Animated.View>;
}

/** `justOpened` names the buds that opened on this watering; each blooms in order. Static parts draw in one Svg underneath. */
export function Garden({ scene, justOpened }: { scene: Scene; justOpened: Set<string> }) {
  const { width } = useWindowDimensions();
  const w = width - 40;
  const soilY = HEIGHT - 60;
  const sprouts = scene.parts.filter((p): p is Extract<Part, { kind: "sprout" }> => p.kind === "sprout");
  const seeds = scene.parts.filter((p): p is Extract<Part, { kind: "seed" }> => p.kind === "seed");
  const skrFruit = scene.parts.filter((p): p is Extract<Part, { kind: "fruit" }> => p.kind === "fruit" && p.plant === "skr");
  const pups = scene.parts.filter((p): p is Extract<Part, { kind: "fruit" }> => p.kind === "fruit" && p.plant === "ore");
  const ripening = scene.parts.filter((p): p is Extract<Part, { kind: "ripening" }> => p.kind === "ripening");
  const wet = scene.parts.find((p): p is Extract<Part, { kind: "wetSpot" }> => p.kind === "wetSpot");
  const basket = scene.parts.find((p): p is Extract<Part, { kind: "basket" }> => p.kind === "basket");
  const transplant = scene.parts.find((p) => p.kind === "transplant");
  let order = 0;
  return (
    <View style={{ width: w, height: HEIGHT }}>
      <Svg width={w} height={HEIGHT} style={{ position: "absolute" }}>
        <G y={soilY}><Soil width={w} /></G>
        {wet ? <G x={w * 0.5} y={soilY + soilSurface(0.5) + 4}><WetSpot age={wet.age} /></G> : null}
        {seeds.map((s) => <G key={s.id} x={s.x * w} y={soilY + soilSurface(s.x) + 3}><Circle r={2.2} fill={INK} opacity={0.7} /></G>)}
        {skrFruit.map((f) => <G key={`f${f.index}`} x={w * (0.2 + (f.index % 6) * 0.12)} y={soilY - 60 - Math.floor(f.index / 6) * 22}><Fruit bud={f.bud} /></G>)}
        {pups.map((f) => <G key={`p${f.index}`} x={w * (0.7 + (f.index % 3) * 0.08)} y={soilY + soilSurface(0.7 + (f.index % 3) * 0.08) - 3}><Pup /></G>)}
        {ripening.map((r) => <G key={r.plant} x={r.plant === "skr" ? w * 0.5 : w * 0.8} y={soilY - 40}><Ripening progress={r.progress} /></G>)}
        {basket ? <G x={w - 40} y={soilY + 30}><Basket /></G> : null}
      </Svg>
      {transplant ? (
        <Bloom order={0} active={false} x={w * 0.5 - 40} y={soilY + soilSurface(0.5) - 78} w={80} h={80}>
          <Sway seed={3} w={80} h={80}><Transplant /></Sway>
        </Bloom>
      ) : null}
      {sprouts.map((s, i) => (
        <Bloom key={s.id} order={justOpened.has(s.id) ? order++ : 0} active={justOpened.has(s.id)} x={s.x * w - 20} y={soilY + soilSurface(s.x) - 78} w={40} h={80}>
          <Sway seed={i} w={40} h={80}>{s.plant === "skr" ? <Sprout stage={s.stage} bud={s.bud} /> : <Succulent stage={s.stage} bud={s.bud} />}</Sway>
        </Bloom>
      ))}
    </View>
  );
}
