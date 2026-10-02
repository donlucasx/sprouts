import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { G } from "react-native-svg";
import { PLANT_ORDER, type Scene, type Part, type PlantId } from "@/model/garden";
import { CANVAS, FOOT_Y, FRAME, frameFor, plantUnder, signScale, signX, toCanvas } from "@/model/layout";
import { plantLayouts } from "@/model/scene-to-layout";
import { SOIL_CLIP_ID } from "@/model/soil-clip";
import { diffScenes, NO_CHANGE, type Diff } from "@/lib/scene-diff";
import { openingPlan, REDUCED_MS } from "@/model/opening";
import { SWAY, clampZoom, pinchOffset } from "@/model/motion";
import { Plant } from "./Plant";
import { Can, canBelow } from "./Can";
import { Appear } from "./Strip";
import { SPRITES } from "./sprites";
import { Soil, SoilClip, Ring, Seed, Sign, Basket, SpriteAt } from "./parts";

const MOUNT_FADE_MS = 300;
const RING_MS = 1350;      // gen11_motion.py:163: every present plant's ring rises over 1.35 s after a watering
const SNAP_MS = 250;       // R173: the zoom snaps back to the automatic frame
const AnimatedG = Animated.createAnimatedComponent(G);
/** The scene as it changes (spec 6 and 7: the moments fire from the diff, never from the tap): the scene before this one, what changed,
 * and the plant the can was dropped on when the change came. A re-render with the same scene object fires nothing again. */
type Change = { scene: Scene; before: Scene | null; diff: Diff; first: PlantId | null };

/** Spec 5: the canvas is the width minus 40 by 260; two rows; the back row draws first. R167: the view on it is as tall as the
 * planted content plus room to grow (frameFor's viewH, device round 3 item 1). Task I4: the plants sway, the changes animate from the
 * scene diff (Plant, Strip), the can lives at the bottom right (Can, R175) and two fingers zoom up to 3x (R173). `tempo` scales every
 * moment (1 on Home, 8 for a slowed preview). `onWater` is the watering request for both the drag and the tap. */
export function Garden({ scene, canReady, onWater, onNudge, tempo = 1 }: { scene: Scene; canReady: boolean; onWater: (target: PlantId | null) => Promise<boolean>; onNudge: () => void; tempo?: number }) {
  const { width } = useWindowDimensions(); const w = width - 40;
  const of = <K extends Part["kind"]>(kind: K) => scene.parts.filter((p): p is Extract<Part, { kind: K }> => p.kind === kind);
  const plants = useMemo(() => plantLayouts(scene), [scene]);
  const footOf = (plant: string) => { const pl = plants.find((p) => p.plant === plant) ?? of("sign").find((s) => s.plant === plant); return pl ? { x: pl.x * w, y: FOOT_Y(pl.row) } : { x: w * 0.4, y: CANVAS.frontFeet }; };
  const back = plants.filter((p) => p.row === "back"), front = plants.filter((p) => p.row === "front");
  // RG30: one frame on the whole garden, eased over 1.2 s (none under reduced motion). The transform's origin is the top-left, so a
  // canvas point p lands at (p - frame) * zoom and the frame fills the view; x and zoom ease linearly, and since the frame's right
  // limit (width - width / zoom) is concave in a linearly eased zoom, a frame inside the bed at both ends stays inside it throughout.
  const target = frameFor(scene, plants, w), reduced = useReducedMotion();
  const fx = useSharedValue(target.x), fy = useSharedValue(target.y), z = useSharedValue(target.zoom), vh = useSharedValue(target.viewH);
  useEffect(() => {
    const t = { duration: reduced ? 0 : FRAME.easeMs, easing: Easing.inOut(Easing.cubic) };
    fx.value = withTiming(target.x, t); fy.value = withTiming(target.y, t); z.value = withTiming(target.zoom, t); vh.value = withTiming(target.viewH, t);
  }, [target.x, target.y, target.zoom, target.viewH, reduced, fx, fy, z, vh]);
  const framed = useAnimatedStyle(() => ({ transform: [{ translateX: -fx.value * z.value }, { translateY: -fy.value * z.value }, { scale: z.value }] }));
  // Spec 8's first frame: react-native-svg loads bundled PNGs through Fresco asynchronously on Android, so the garden fades in over
  // 300 ms on mount and no sprite pops in on its own. The same outer view carries the eased height (R167), with the can's room below.
  const canS = Math.max(32 / (SPRITES["can"]?.w ?? 73.67), target.zoom / 3);   // G11's proportion (can11 at 1/3 against the plants), never under 32 px wide
  const below = canBelow(canS);
  const shown = useSharedValue(0);
  useEffect(() => { shown.value = withTiming(1, { duration: MOUNT_FADE_MS }); }, [shown]);
  const outer = useAnimatedStyle(() => ({ opacity: shown.value, height: vh.value + below }));
  const clip = useAnimatedStyle(() => ({ height: vh.value }));

  // What changed, and the plan it plays (the openings, the arrivals); the static drawing leaves out every moving part until it settles.
  const [pourTarget, setPourTarget] = useState<PlantId | null>(null);
  const [change, setChange] = useState<Change>({ scene, before: null, diff: NO_CHANGE, first: null });
  if (change.scene !== scene) setChange({ scene, before: change.scene, diff: diffScenes(change.scene, scene), first: pourTarget });
  const beforePlants = useMemo(() => (change.before ? plantLayouts(change.before) : null), [change.before]);
  const plan = useMemo(() => openingPlan({ scene: change.scene, plants: plantLayouts(change.scene), before: beforePlants, diff: change.diff, first: change.first, reduced, tempo }), [change, beforePlants, reduced, tempo]);
  const [settled, setSettled] = useState<Change | null>(null);
  const active = plan.items.length > 0 && settled !== change;
  useEffect(() => {
    if (!plan.items.length) return;
    const id = setTimeout(() => setSettled(change), plan.endMs + 100);
    return () => clearTimeout(id);
  }, [plan, change]);
  const itemsOf = (plant: PlantId) => (active ? plan.items.flatMap((it) => (it.kind !== "seed" && it.plant === plant ? [it] : [])) : []);
  const arrivingSeeds = new Map(active ? plan.items.flatMap((it) => (it.kind === "seed" ? [[it.id, it] as const] : [])) : []);
  // The rings rise after a watering (a change that opened something), all present plants at once; reduced motion: a 300 ms fade.
  const ring = useSharedValue(1);
  useLayoutEffect(() => {
    if (!change.diff.opened.length) return;
    ring.value = 0; ring.value = withTiming(1, { duration: (reduced ? REDUCED_MS : RING_MS) * tempo });
  }, [change, reduced, tempo, ring]);
  const ringProps = useAnimatedProps(() => ({ opacity: ring.value }));

  // His note (10-02): the wind, all the time. One clock for the garden (0 to 1 every 2.6 s); each plant adds its own phase.
  const sway = useSharedValue(0);
  useEffect(() => {
    if (reduced) { cancelAnimation(sway); sway.value = 0; return; }
    sway.value = 0; sway.value = withRepeat(withTiming(1, { duration: SWAY.periodMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(sway);
  }, [reduced, sway]);

  // R173: two fingers zoom up to 3x over the automatic frame and, as they move, pan; on release, or a double tap, the garden snaps back.
  // One pinch does both (its focal point carries the pan), so no one-finger gesture is ever taken from the can or the page's scroll.
  const ps = useSharedValue(1), px = useSharedValue(0), py = useSharedValue(0);
  const s0 = useSharedValue(1), x0 = useSharedValue(0), y0 = useSharedValue(0), f0x = useSharedValue(0), f0y = useSharedValue(0);
  const snap = () => {
    "worklet";
    const t = { duration: reduced ? 0 : SNAP_MS, easing: Easing.out(Easing.cubic) };
    ps.value = withTiming(1, t); px.value = withTiming(0, t); py.value = withTiming(0, t);
  };
  const pinch = Gesture.Pinch()
    .onStart((e) => { s0.value = ps.value; x0.value = px.value; y0.value = py.value; f0x.value = e.focalX; f0y.value = e.focalY; })
    .onUpdate((e) => {
      const s = clampZoom(s0.value * e.scale);
      px.value = pinchOffset(x0.value, s0.value, s, f0x.value, e.focalX, w);
      py.value = pinchOffset(y0.value, s0.value, s, f0y.value, e.focalY, vh.value);
      ps.value = s;
    })
    .onEnd(snap);
  const zoomGesture = Gesture.Race(pinch, Gesture.Tap().numberOfTaps(2).onEnd(snap));
  const zoomed = useAnimatedStyle(() => ({ transform: [{ translateX: px.value }, { translateY: py.value }, { scale: ps.value }] }));

  // The can's targets (RG25): the plants with a closed bud, hit by the rose's point carried back onto the canvas.
  const budPlants = PLANT_ORDER.filter((c) => of("sprout").some((s) => s.plant === c && s.bud));
  const budSlots = Object.fromEntries(of("plant").filter((p) => budPlants.includes(p.plant)).map((p) => [p.plant, p.x]));
  const onScreen = (x: number, y: number) => ({ x: (x - target.x) * target.zoom, y: (y - target.y) * target.zoom });
  const spotOf = (plant: PlantId) => {
    const pl = plants.find((p) => p.plant === plant), foot = footOf(plant);
    const ground = onScreen(foot.x, foot.y), tip = onScreen(foot.x, foot.y - (pl?.layout.top ?? 0));
    return { rose: { x: ground.x, y: Math.max(12, tip.y - 10) }, groundY: ground.y };
  };
  const targetAt = (pt: { x: number; y: number }) => { const c = toCanvas(pt, target); return plantUnder(c.x, c.y, budSlots, w); };
  const pour = (plant: PlantId | null) => { setPourTarget(plant); return onWater(plant); };

  return (
    <Animated.View style={[{ width: w }, outer]}>
     <GestureDetector gesture={zoomGesture}>
     <Animated.View style={[{ width: w, overflow: "hidden" }, clip]}>
     <Animated.View style={[{ width: w, height: CANVAS.height, transformOrigin: [0, 0, 0] }, zoomed]}>
     <Animated.View style={[{ width: w, height: CANVAS.height, transformOrigin: "0 0" }, framed]}>
      <Svg width={w} height={CANVAS.height} style={{ position: "absolute" }}>
        <SoilClip width={w} soilY={CANVAS.soilLine} />
        <Soil width={w} soilY={CANVAS.soilLine} />
        <AnimatedG animatedProps={ringProps}><G clipPath={`url(#${SOIL_CLIP_ID})`}>{of("ring").map((r) => { const f = footOf(r.plant); return <G key={`r${r.plant}`} x={f.x} y={f.y + 2}><Ring age={r.age} k={r.plant === "skr" || r.plant === "ore" ? 1 : 2 / 3} /></G>; })}</G></AnimatedG>
        {of("seed").map((s) => {
          const f = footOf(s.plant), seed = <G key={s.id} x={f.x} y={f.y + 1}><Seed index={s.index} /></G>;
          const a = arrivingSeeds.get(s.id);
          return a ? <Appear key={s.id} delay={a.delay} ms={a.ms}>{seed}</Appear> : seed;
        })}
        {of("sign").map((s) => { const scale = signScale(s.row); return <G key={`s${s.plant}`} x={signX(s.x * w, s.side, w, scale)} y={FOOT_Y(s.row) + 4}><Sign plant={s.plant} scale={scale} /></G>; })}
        {of("basket").length ? <G x={w - 40} y={CANVAS.soilLine + 30}><Basket /></G> : null}
        {/* Spec 3: the paper grain once over the whole garden, the static Svg's last child (app only). */}
        <G opacity={0.5}><SpriteAt name="grain" x={0} y={0} scale={CANVAS.height / 260} xScale={w / 320} /></G>
      </Svg>
      {[...back, ...front].map((p) => <Plant key={p.plant} p={p} footX={p.x * w} footY={FOOT_Y(p.row)} sway={sway} reduced={reduced} items={itemsOf(p.plant)} before={active ? (beforePlants?.find((b) => b.plant === p.plant)?.layout ?? null) : null} />)}
     </Animated.View>
     </Animated.View>
     </Animated.View>
     </GestureDetector>
     <Can ready={canReady} reduced={reduced} tempo={tempo} width={w} viewH={vh} viewHNow={target.viewH} s={canS} targetAt={targetAt} spotOf={spotOf} tapTarget={budPlants[0] ?? null} onPour={pour} onNudge={onNudge} />
    </Animated.View>
  );
}
