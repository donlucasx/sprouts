import { useEffect, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import Svg, { G, Circle } from "react-native-svg";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming, withDelay, Easing } from "react-native-reanimated";
import type { Scene, Part } from "@/model/garden";
import { soilSurface } from "@/model/soil";
import { Soil, Stem, Shoot, Forming, Transplant, Fruit, Ripening, Pup, Basket, WetSpot, INK } from "./parts";
import { PLANT_X } from "@/model/garden";
import { nodeRise, stemRise, side, leafSize, TRANSPLANT_BASE } from "@/model/plant-geometry";

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

/**
 * Positions a part on the garden; when it was a bud until this reveal it blooms in (scale from 0.2 with a fade), one after another.
 * A bud mounted closed sits at 1, so the bloom starts by going back to 0 (audits/watering-ux, finding 5: from 1 to 1 was a no-op
 * and the bloom never played for a bud already on the screen).
 */
function Bloom({ children, order, active, x, y, w, h }: { children: ReactNode; order: number; active: boolean; x: number; y: number; w: number; h: number }) {
  const t = useSharedValue(active ? 0 : 1);
  useEffect(() => {
    if (!active) return;
    t.value = 0;
    t.value = withDelay(order * 260, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [active, order, t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.2 + 0.8 * t.value, transform: [{ scale: 0.2 + 0.8 * t.value }] }));
  return <Animated.View style={[{ position: "absolute", left: x, top: y, width: w, height: h }, style]}>{children}</Animated.View>;
}

/** `justOpened` names the buds that opened on this watering; each blooms in order. Static parts draw in one Svg underneath. */
export function Garden({ scene, justOpened }: { scene: Scene; justOpened: Set<string> }) {
  const { width } = useWindowDimensions();
  const w = width - 40;
  const soilY = HEIGHT - 60;
  const ground = (x: number) => soilY + soilSurface(x) + 2;   // the soil's surface at x (0 to 1), in pixels
  const plants = scene.parts.filter((p): p is Extract<Part, { kind: "plant" }> => p.kind === "plant");
  const shoots = scene.parts.filter((p): p is Extract<Part, { kind: "sprout" }> => p.kind === "sprout");
  const seeds = scene.parts.filter((p): p is Extract<Part, { kind: "seed" }> => p.kind === "seed");
  const forming = scene.parts.find((p): p is Extract<Part, { kind: "forming" }> => p.kind === "forming");
  const skrFruit = scene.parts.filter((p): p is Extract<Part, { kind: "fruit" }> => p.kind === "fruit" && p.plant === "skr");
  const pups = scene.parts.filter((p): p is Extract<Part, { kind: "fruit" }> => p.kind === "fruit" && p.plant === "ore");
  const ripening = scene.parts.filter((p): p is Extract<Part, { kind: "ripening" }> => p.kind === "ripening");
  const wet = scene.parts.find((p): p is Extract<Part, { kind: "wetSpot" }> => p.kind === "wetSpot");
  const basket = scene.parts.find((p): p is Extract<Part, { kind: "basket" }> => p.kind === "basket");
  const transplant = scene.parts.some((p) => p.kind === "transplant");
  // R89: each coin's one plant, its plantings stacked up its stem (plant-geometry.ts, shared with the widget).
  const plantOf = (c: "skr" | "ore") => plants.find((p) => p.plant === c)!;
  const base = (c: "skr" | "ore") => (c === "skr" && transplant ? TRANSPLANT_BASE : 0);
  const node = (s: Extract<Part, { kind: "sprout" }>) => {
    const p = plantOf(s.plant);
    return { x: p.x * w, y: ground(p.x) - nodeRise(s.y, p.shoots, base(s.plant)) };
  };
  // Fruit hang beside the shoot the scene names, on the side away from its leaf; a few per shoot fan out downward.
  const perHost = new Map<string, number>();
  const hang = (id: string) => {
    const s = shoots.find((p) => p.id === id)!;
    const k = perHost.get(id) ?? 0;
    perHost.set(id, k + 1);
    const n = node(s);
    return { x: n.x - side(s.y) * (8 + k * 7), y: n.y + 6 + k * 4 };
  };
  let order = 0;
  return (
    <View style={{ width: w, height: HEIGHT }}>
      <Svg width={w} height={HEIGHT} style={{ position: "absolute" }}>
        <G y={soilY}><Soil width={w} /></G>
        {wet ? <G x={w * wet.x} y={ground(wet.x) + 2}><WetSpot age={wet.age} /></G> : null}
        {seeds.map((s) => <G key={s.id} x={s.x * w} y={ground(s.x) + 1}><Circle r={2.2} fill={INK} opacity={0.7} /></G>)}
        {plants.map((p) => <G key={p.plant} x={p.x * w} y={ground(p.x)}><Stem plant={p.plant} rise={stemRise(p.shoots, base(p.plant))} /></G>)}
        {forming ? (() => { const p = plantOf(forming.plant); return <G x={p.x * w} y={ground(p.x) - stemRise(p.shoots, base(p.plant)) - 3}><Forming progress={forming.progress} /></G>; })() : null}
        {skrFruit.map((f) => { const at = hang(f.on!); return <G key={`f${f.index}`} x={at.x} y={at.y}><Fruit bud={f.bud} /></G>; })}
        {pups.map((f) => { const x = PLANT_X.ore + ((f.index % 3) - 1) * 0.05; return <G key={`p${f.index}`} x={w * x} y={ground(x) - 3}><Pup /></G>; })}
        {ripening.map((r) => { const at = hang(r.on); return <G key={r.plant} x={at.x} y={at.y}><Ripening progress={r.progress} /></G>; })}
        {basket ? <G x={w - 40} y={soilY + 30}><Basket /></G> : null}
      </Svg>
      {transplant ? (
        <Bloom order={0} active={false} x={PLANT_X.skr * w - 40} y={ground(PLANT_X.skr) - 80} w={80} h={80}>
          <Sway seed={3} w={80} h={80}><Transplant /></Sway>
        </Bloom>
      ) : null}
      {shoots.map((s) => {
        const n = node(s);
        return (
          <Bloom key={s.id} order={justOpened.has(s.id) ? order++ : 0} active={justOpened.has(s.id)} x={n.x - 14} y={n.y - 14} w={28} h={28}>
            <Svg width={28} height={28}><Shoot stage={s.stage} bud={s.bud} side={side(s.y)} size={leafSize(s.stage)} plant={s.plant} /></Svg>
          </Bloom>
        );
      })}
    </View>
  );
}
