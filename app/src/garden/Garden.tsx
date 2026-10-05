import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, View, useWindowDimensions } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { radius, spacing, useTheme } from "@/theme";
import Animated, { Easing, FadeIn, FadeOut, cancelAnimation, runOnJS, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Svg, { G } from "react-native-svg";
import { PLANT_ORDER, type Scene, type Part, type PlantId } from "@/model/garden";
import { CANVAS, FOOT_Y, FRAME, PLANT_SCALE, frameFor, plantUnder, SIDE_GUTTER, signPlacement } from "@/model/layout";
import { plantLayouts } from "@/model/scene-to-layout";
import { SOIL_CLIP_ID } from "@/model/soil-clip";
import { diffScenes, gateDiff, sceneKey, NO_CHANGE, type Diff } from "@/lib/scene-diff";
import { arrivalsOf, openingPlan, openingPlants, releaseGroups, REDUCED_MS } from "@/model/opening";
import { SWAY, GUST_IDLE, clampZoom, gustDelays, gustGap, gustSpanMs, pinchOffset } from "@/model/motion";
import { Plant } from "./Plant";
import { Can } from "./Can";
import { canScale, overlayToCanvas, ROW_GAP } from "@/model/can";
import { Appear } from "./Strip";
import { Wind } from "./Wind";
import { packScene } from "@/model/spread";
import { frameGround } from "@/model/soil-clip";
import { Soil, SoilClip, Ring, Seed, Sign, Basket, SpriteAt } from "./parts";

const MOUNT_FADE_MS = 300;
const RING_MS = 1350;      // gen11_motion.py:163: every present plant's ring rises over 1.35 s after a watering
const SNAP_MS = 250;       // R173: the zoom snaps back to the automatic frame
/** R248: the buds' call: 0.6 s after a landing, 1.1 s long, then every 4.5 s while a bud waits. */
const BUD_CALL = { firstMs: 600, ms: 1100, everyMs: 4500 } as const;
/** R250: a plant's label shows this long, this wide. */
const LABEL_MS = 4500, LABEL_W = 260;
const ARRIVE_GUARD_MS = 4000;   // R202: the can stops waiting for an opening this long after the watering if no read has brought one
const AnimatedG = Animated.createAnimatedComponent(G);
/** The scene as it changes (spec 6 and 7: the moments fire from the diff, never from the tap): its content key, the scene before this
 * one, what of the change may move (gateDiff), the plant the can was dropped on, whether a watering made it (`watered`) and whether that
 * watering was a drag (`held`, R201: each plant's opening waits for the can). Keyed on content, so a re-render or a re-parsed read of
 * the same garden is no change and never restarts or holds a plan. */
type Change = { n: number; key: string; scene: Scene; before: Scene | null; diff: Diff; first: PlantId | null; watered: boolean; held: boolean };
/** A watering in progress: the plant first poured on, whether by drag, and the plants that still had a closed bud when it began. */
type Watering = { target: PlantId | null; drag: boolean; buds: PlantId[] };

/** R186: what the Next planting row needs to seat the can at its bar's end: the can's scale (its slot and room come from it) and a
 * report of the row's own layout, the bar's centre and the row's height, both px from the row's top. */
export type CanRow = { s: number; onLayout: (m: { bar: number; height: number }) => void };

/** Reduced motion as the system has it now (the review's item 5): read at mount and followed live through `reduceMotionChanged`. */
function useReduceMotion() {
  const [on, setOn] = useState(useReducedMotion());
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setOn(v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setOn);
    return () => { alive = false; sub.remove(); };
  }, []);
  return on;
}

/** Spec 5: the canvas is the width minus 40 by 260; two rows; the back row draws first. R167: the view on it is as tall as the
 * planted content plus room to grow (frameFor's viewH, device round 3 item 1). Task I4: the plants sway, the changes animate from the
 * scene diff (Plant, Strip), the can sits at the end of the Next planting bar (Can, R186) and two fingers zoom up to 3x (R173). `tempo` scales every
 * moment (1 on Home, 8 for a slowed preview). `onWater` is the watering request for both the drag and the tap. `live` is true while
 * the scene comes from a read made since Home opened (not the saved one): ruling b, an app open plays nothing and every part is drawn
 * final; new buds and seeds move only between two live reads, opens only after a watering made here. R186: `row` draws the Next planting
 * row directly under the garden, and the can sits at its bar's end in an overlay over both (the garden view's top-left its origin).
 * R196: the overlay reaches into the screen's right gutter (the garden's box is that much wider, its margin giving it back), so the
 * finger may carry the can to the screen's edge. R195: `wobble` is bumped on every landing on Home and every pull-to-refresh. */
export function Garden({ scene: incoming, live, canReady, onWater, onNudge, row, tempo = 1, wobble = 0, labelFor }: { scene: Scene; live: boolean; canReady: boolean; onWater: (target: PlantId | null) => Promise<boolean>; onNudge: () => void; row: (can: CanRow) => ReactNode; tempo?: number; wobble?: number; labelFor?: (plant: PlantId, budWaiting: boolean) => string[] }) {
  const { width } = useWindowDimensions(); const w = width - 40;
  const { colors } = useTheme();
  const reduced = useReduceMotion();
  // What changed, and the plan it plays (the openings, the arrivals); the static drawing leaves out every moving part until it settles.
  const key = useMemo(() => sceneKey(incoming), [incoming]);
  const [watering, setWatering] = useState<Watering | null>(null);
  const [liveKey, setLiveKey] = useState<string | null>(live ? key : null);   // the content last seen from a live read
  const [change, setChange] = useState<Change>({ n: 0, key, scene: incoming, before: null, diff: NO_CHANGE, first: null, watered: false, held: false });
  if (key !== change.key) {
    const diff = gateDiff(diffScenes(change.scene, incoming), { watered: watering !== null, arrivals: live && liveKey === change.key });
    setChange({ n: change.n + 1, key, scene: incoming, before: change.scene, diff, first: watering?.target ?? null, watered: watering !== null, held: watering?.drag ?? false });
  }
  if (live && liveKey !== key) setLiveKey(key);
  const raw = change.key === key ? change.scene : incoming;   // drawn from the change's own scene, so its plan's part indexes hold
  const scene = useMemo(() => packScene(raw), [raw]);   // R234: packed together while the plants are small (part order kept)   // R234: packed toward the middle while the plants are small (part order kept)   // R234: packed toward the middle while the plants are small (part order kept)
  const of = <K extends Part["kind"]>(kind: K) => scene.parts.filter((p): p is Extract<Part, { kind: K }> => p.kind === kind);
  const plants = useMemo(() => plantLayouts(scene), [scene]);
  const footOf = (plant: string) => { const pl = plants.find((p) => p.plant === plant) ?? of("sign").find((s) => s.plant === plant); return pl ? { x: pl.x * w, y: FOOT_Y(pl.row) } : { x: w * 0.4, y: CANVAS.frontFeet }; };
  const back = plants.filter((p) => p.row === "back"), front = plants.filter((p) => p.row === "front");
  // RG30: one frame on the whole garden, eased over 1.2 s (none under reduced motion). The transform's origin is the top-left, so a
  // canvas point p lands at (p - frame) * zoom and the frame fills the view; x and zoom ease linearly, and since the frame's right
  // limit (width - width / zoom) is concave in a linearly eased zoom, a frame inside the bed at both ends stays inside it throughout.
  const target = frameFor(scene, plants, w);
  const ground = frameGround(w, target);   // R238: the soil spans the frame, its rounded painted ends always in view
  const fx = useSharedValue(target.x), fy = useSharedValue(target.y), z = useSharedValue(target.zoom), vh = useSharedValue(target.viewH);
  useEffect(() => {
    const t = { duration: reduced ? 0 : FRAME.easeMs, easing: Easing.inOut(Easing.cubic) };
    fx.value = withTiming(target.x, t); fy.value = withTiming(target.y, t); z.value = withTiming(target.zoom, t); vh.value = withTiming(target.viewH, t);
  }, [target.x, target.y, target.zoom, target.viewH, reduced, fx, fy, z, vh]);
  const framed = useAnimatedStyle(() => ({ transform: [{ translateX: -fx.value * z.value }, { translateY: -fy.value * z.value }, { scale: z.value }] }));
  const framedPlants = useAnimatedStyle(() => ({ transform: [{ translateX: -fx.value * z.value }, { translateY: -fy.value * z.value }, { scale: z.value }] }));   // the plant layer's own copy (one animated style per view)
  // Spec 8's first frame: react-native-svg loads bundled PNGs through Fresco asynchronously on Android, so the garden fades in over
  // 300 ms on mount and no sprite pops in on its own. The same outer view carries the eased height (R167); the can fades in with it.
  const canS = canScale(target.zoom);   // R188: 2.6x G11's proportion (can11 at 1/3 against the plants, never under 32 px wide)
  const [rowAt, setRowAt] = useState<{ bar: number; height: number } | null>(null);   // R186: the row's bar and height, once laid out
  const shown = useSharedValue(0);
  useEffect(() => { shown.value = withTiming(1, { duration: MOUNT_FADE_MS }); }, [shown]);
  const outer = useAnimatedStyle(() => ({ opacity: shown.value, height: vh.value }));
  const canShown = useAnimatedStyle(() => ({ opacity: shown.value }));
  const clip = useAnimatedStyle(() => ({ height: vh.value }));        // the box the zoom's gesture covers
  const clipGround = useAnimatedStyle(() => ({ height: vh.value }));  // one animated style per view
  const clipPlants = useAnimatedStyle(() => ({ height: vh.value }));

  const beforePlants = useMemo(() => (change.before ? plantLayouts(change.before) : null), [change.before]);
  const changePlants = useMemo(() => plantLayouts(change.scene), [change.scene]);
  // R201: a drag's watering holds each plant's opening until the can reaches it (`visits`, in order) or the drag ends (`dropped`):
  // the plants released together form a group, played from its release (releaseGroups); the change's arrivals play at once (segment
  // 0), each group is a segment after it. A plant not yet released is drawn as it was before the change, its bud closed. A tap's
  // watering (or any other change) is one segment, the whole plan, as before.
  const [visits, setVisits] = useState<{ plants: PlantId[]; dropped: boolean } | null>(null);
  const openers = useMemo(() => (change.held ? openingPlants(change.scene, change.diff) : []), [change]);
  const [groups, setGroups] = useState<{ n: number; list: PlantId[][] }>({ n: 0, list: [] });
  const list = useMemo(() => (groups.n === change.n ? groups.list : []), [groups, change.n]);
  if (openers.length) {
    const next = releaseGroups(list, visits?.plants ?? [], visits?.dropped ?? false, openers);
    if (next !== list || groups.n !== change.n) setGroups({ n: change.n, list: next });
  }
  const held = openers.length > 0;
  const base = useMemo(() => openingPlan({ scene: change.scene, plants: changePlants, before: beforePlants, diff: held ? arrivalsOf(change.diff) : change.diff, first: change.first, reduced, tempo }), [change, changePlants, beforePlants, held, reduced, tempo]);
  const groupPlans = useMemo(() => list.map((g) => openingPlan({ scene: change.scene, plants: changePlants, before: beforePlants, diff: change.diff, first: null, reduced, tempo, order: g })), [list, change, changePlants, beforePlants, reduced, tempo]);
  const segments = [base, ...groupPlans];
  // Ruling c: each segment settles at its end whatever happened to its players (a skipped or stalled animation), and a newer change
  // cuts every one short; settled, its parts are drawn static, their end picture. Each segment's clock starts when it first renders.
  const [ended, setEnded] = useState<{ n: number; done: number[] }>({ n: 0, done: [] });
  const n = change.n, ends = segments.map((p) => p.endMs), endsKey = ends.join(",");
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => () => { for (const id of timers.current.values()) clearTimeout(id); timers.current = new Map(); }, [n]);
  useEffect(() => {
    ends.forEach((ms, i) => {
      if (timers.current.has(i)) return;
      timers.current.set(i, setTimeout(() => setEnded((e) => ({ n, done: e.n === n ? [...e.done, i] : [i] })), ms ? ms + 100 : 0));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ends` is read through its key; a segment's clock is set once
  }, [n, endsKey]);
  const running = (i: number) => (segments[i]?.endMs ?? 0) > 0 && !(ended.n === n && ended.done.includes(i));
  const groupOf = (plant: PlantId) => list.findIndex((g) => g.includes(plant));
  const isHeld = (plant: PlantId) => held && openers.includes(plant) && groupOf(plant) < 0;
  const mine = (i: number, plant: PlantId) => (running(i) ? segments[i]!.items.flatMap((it) => (it.kind !== "seed" && it.plant === plant ? [it] : [])) : []);
  const itemsOf = (plant: PlantId) => { const g = groupOf(plant); return [...mine(0, plant), ...(g >= 0 ? mine(g + 1, plant) : [])]; };
  const settledOf = (plant: PlantId) => { const g = groupOf(plant); return !running(0) && !(g >= 0 && running(g + 1)); };
  const arrivingSeeds = new Map(running(0) ? base.items.flatMap((it) => (it.kind === "seed" ? [[it.id, it] as const] : [])) : []);
  const settledAll = segments.every((_, i) => !running(i)) && !openers.some(isHeld);
  // The rings rise after a watering (a change that opened something), all present plants at once; reduced motion: a 300 ms fade.
  const ring = useSharedValue(1);
  const [ringN, setRingN] = useState(-1);   // R247: the change whose rings have started; until then they are not drawn (one frame showed them full)
  useLayoutEffect(() => {
    if (!change.diff.opened.length) return;
    ring.value = 0; ring.value = withTiming(1, { duration: (reduced ? REDUCED_MS : RING_MS) * tempo });
    setRingN(change.n);   // eslint-disable-line react-hooks/set-state-in-effect -- R247: one extra render, so the first frame of a change never draws its rings at full
  }, [change, reduced, tempo, ring]);
  const ringsShown = !change.diff.opened.length || ringN === change.n;
  const ringProps = useAnimatedProps(() => ({ opacity: ring.value }));

  // His note (10-02): the wind, all the time. One clock for the garden (0 to 1 every 6.4 s, R179); each plant adds its own phase.
  const sway = useSharedValue(0);
  useEffect(() => {
    if (reduced) { cancelAnimation(sway); sway.value = 0; return; }
    sway.value = 0; sway.value = withRepeat(withTiming(1, { duration: SWAY.periodMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(sway);
  }, [reduced, sway]);
  // R189: a gust every 8 to 15 s at random, rolling left to right. One gust clock (ms into the gust, linear over the six-plant roll);
  // each plant reads it less its own delay. Idle between gusts and under reduced motion; the first one comes 8 s or more after mount.
  const gust = useSharedValue(GUST_IDLE);
  useEffect(() => {
    if (reduced) { cancelAnimation(gust); gust.value = GUST_IDLE; return; }
    const span = gustSpanMs(PLANT_ORDER.length);
    let id: ReturnType<typeof setTimeout>;
    const next = () => {
      id = setTimeout(() => {
        gust.value = withSequence(withTiming(0, { duration: 0 }), withTiming(span, { duration: span, easing: Easing.linear }));
        next();
      }, gustGap(Math.random()));
    };
    next();
    return () => { clearTimeout(id); cancelAnimation(gust); gust.value = GUST_IDLE; };
  }, [reduced, gust]);
  // R248: the waiting buds call: a swell and a rock (Plant's Bud) shortly after each landing, then every few seconds while one waits
  const budCall = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(budCall); budCall.value = 0;
    if (reduced || !canReady) return;
    budCall.value = withDelay(BUD_CALL.firstMs, withRepeat(withSequence(withTiming(0, { duration: 0 }), withTiming(1, { duration: BUD_CALL.ms, easing: Easing.inOut(Easing.sin) }), withDelay(BUD_CALL.everyMs, withTiming(1, { duration: 0 }))), -1, false));
    return () => cancelAnimation(budCall);
  }, [reduced, canReady, wobble, budCall]);
  const delays = gustDelays(Object.fromEntries(plants.map((p) => [p.plant, p.x])));

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
  // R250: one tap on a plant shows its label (what is drawn, in words); a second tap, or 4.5 s, hides it. The double tap still snaps.
  const [label, setLabel] = useState<{ plant: PlantId; lines: string[]; n: number } | null>(null);
  useEffect(() => {
    if (!label) return;
    const id = setTimeout(() => setLabel(null), LABEL_MS);
    return () => clearTimeout(id);
  }, [label]);
  const onTapAt = (x: number, y: number) => {
    const c = overlayToCanvas({ x, y }, target);
    const plant = labelFor ? plantUnder(c.x, c.y, Object.fromEntries(plants.map((p) => [p.plant, p.x])), w) : null;
    if (!plant || label?.plant === plant) { setLabel(null); return; }
    setLabel((l) => ({ plant, lines: labelFor!(plant, budPlants.includes(plant)), n: (l?.n ?? 0) + 1 }));
  };
  const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(snap);
  const singleTap = Gesture.Tap().maxDuration(300).onEnd((e, ok) => { if (ok) runOnJS(onTapAt)(e.x, e.y); });
  const zoomGesture = Gesture.Race(pinch, Gesture.Exclusive(doubleTap, singleTap));
  const zoomed = useAnimatedStyle(() => ({ transform: [{ translateX: px.value }, { translateY: py.value }, { scale: ps.value }] }));
  const zoomedPlants = useAnimatedStyle(() => ({ transform: [{ translateX: px.value }, { translateY: py.value }, { scale: ps.value }] }));

  // The can's targets (RG25): the plants with a closed bud (R201: while a watering runs, those that had one when it began, so a drag
  // still finds the plants not yet reached after the read has opened them), hit by the rose's point carried back onto the canvas.
  const budPlants = PLANT_ORDER.filter((c) => of("sprout").some((s) => s.plant === c && s.bud));
  const targets = watering?.buds ?? budPlants;
  const budSlots = Object.fromEntries(of("plant").filter((p) => targets.includes(p.plant)).map((p) => [p.plant, p.x]));
  const onScreen = (x: number, y: number) => ({ x: (x - target.x) * target.zoom, y: (y - target.y) * target.zoom });
  const spotOf = (plant: PlantId) => {
    const pl = plants.find((p) => p.plant === plant), foot = footOf(plant);
    const ground = onScreen(foot.x, foot.y), tip = onScreen(foot.x, foot.y - (pl?.layout.top ?? 0) * PLANT_SCALE);   // R187: the plant drawn 1.25x about its foot
    return { rose: { x: ground.x, y: Math.max(12, tip.y - 10) }, groundY: ground.y };
  };
  const targetAt = (pt: { x: number; y: number }) => { const c = overlayToCanvas(pt, target); return plantUnder(c.x, c.y, budSlots, w); };
  const wateredAt = useRef(-1);   // the change the watering began on: an opening counts for the can only from a later one
  const pour = (plant: PlantId | null, drag: boolean) => {
    wateredAt.current = change.n;
    setWatering({ target: plant, drag, buds: budPlants });
    if (drag) setVisits({ plants: plant ? [plant] : [], dropped: false });
    return onWater(plant);
  };
  const onVisit = (plant: PlantId) => setVisits((v) => (v && !v.plants.includes(plant) ? { ...v, plants: [...v.plants, plant] } : v));
  const onDrop = () => setVisits((v) => (v ? { ...v, dropped: true } : v));
  // R202: the can waits for the watering's opening to end. Read through a ref (the can's sequence holds an old render's callback); a
  // waiter resolves once the watered change has fully settled, or after ARRIVE_GUARD_MS if no read has brought one yet.
  const waiters = useRef<{ res: () => void; guard: ReturnType<typeof setTimeout> | null }[]>([]);
  const opening = useRef({ opens: false, settled: true });
  useLayoutEffect(() => {
    const opens = change.watered && change.diff.opened.length > 0 && change.n > wateredAt.current;
    opening.current = { opens, settled: settledAll };
    if (!opens) return;
    if (settledAll) { const ws = waiters.current; waiters.current = []; for (const x of ws) { if (x.guard) clearTimeout(x.guard); x.res(); } }
    else for (const x of waiters.current) if (x.guard) { clearTimeout(x.guard); x.guard = null; }
  });
  useEffect(() => () => { for (const x of waiters.current) { if (x.guard) clearTimeout(x.guard); x.res(); } waiters.current = []; }, []);
  const afterOpening = () => new Promise<void>((res) => {
    if (opening.current.opens && opening.current.settled) { res(); return; }
    const x: (typeof waiters.current)[number] = { res, guard: null };
    if (!opening.current.opens) x.guard = setTimeout(() => { waiters.current = waiters.current.filter((y) => y !== x); res(); }, ARRIVE_GUARD_MS * tempo);
    waiters.current.push(x);
  });

  return (
    <View style={{ width: w + SIDE_GUTTER, marginRight: -SIDE_GUTTER }}>
    <Animated.View style={[{ width: w }, outer]}>
     <GestureDetector gesture={zoomGesture}>
     <Animated.View style={[{ width: w }, clip]}>
     {/* the ground layer: soil, rings, seeds, grain (R226: the signs moved to the plant layer, in front of their plants), clipped to the garden's own box */}
     <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: w, overflow: "hidden" }, clipGround]}>
     <Animated.View style={[{ width: w, height: CANVAS.height, transformOrigin: [0, 0, 0] }, zoomed]}>
     <Animated.View style={[{ width: w, height: CANVAS.height, transformOrigin: "0 0" }, framed]}>
      <Svg width={w} height={CANVAS.height} style={{ position: "absolute" }}>
        <SoilClip g={ground} />
        <Soil g={ground} />
        <AnimatedG animatedProps={ringProps}><G clipPath={`url(#${SOIL_CLIP_ID})`}>{(ringsShown ? of("ring") : []).map((r) => { const f = footOf(r.plant); return <G key={`r${r.plant}`} x={f.x} y={f.y + 2}><Ring age={r.age} k={r.plant === "skr" || r.plant === "ore" ? CANVAS.frontScale : 2 / 3} /></G>; })}</G></AnimatedG>
        {of("seed").map((s) => {
          const f = footOf(s.plant), seed = <G key={s.id} x={f.x} y={f.y + 1}><Seed index={s.index} /></G>;
          const a = arrivingSeeds.get(s.id);
          return a ? <Appear key={s.id} delay={a.delay} ms={a.ms}>{seed}</Appear> : seed;
        })}
        {/* R242: the basket inside the frame, where the mound is full (it stood at w - 40 and the zoom cut it) */}
        {of("basket").length ? <G x={target.x + target.w * (1 - FRAME.footInset) - 26} y={CANVAS.frontFeet - 14}><Basket /></G> : null}
        {/* Spec 3: the paper grain once over the whole garden, the static Svg's last child (app only). */}
        <G opacity={0.5}><SpriteAt name="grain" x={0} y={0} scale={CANVAS.height / 260} xScale={w / 320} /></G>
      </Svg>
     </Animated.View>
     </Animated.View>
     </Animated.View>
     {/* R200: the painted wind curls ride each gust across the sky, over the ground and behind the plants (Wind.tsx) */}
     <Wind gust={gust} width={w} viewH={vh} reduced={reduced} />
     {/* the plant layer (I4 fix round 3): the same zoom and frame, clipped at the top and bottom only, with the screen's side gutters as
         room, so a swaying sunflower or the spruce may draw into the margins; the page cannot scroll sideways (its scroll is vertical) */}
     <Animated.View style={[{ position: "absolute", left: -SIDE_GUTTER, top: 0, width: w + 2 * SIDE_GUTTER, overflow: "hidden" }, clipPlants]} pointerEvents="none">
     <Animated.View style={[{ position: "absolute", left: SIDE_GUTTER, top: 0, width: w, height: CANVAS.height, transformOrigin: [0, 0, 0] }, zoomedPlants]}>
     <Animated.View style={[{ width: w, height: CANVAS.height, transformOrigin: "0 0" }, framedPlants]}>
      {/* R226 (10-03, his note): every stake stands in front of its plant. Back row: plants, then their signs; then the front row
          the same, so a front plant still covers a back stake it overlaps. */}
      {(["back", "front"] as const).map((row) => [
       ...(row === "back" ? back : front).map((p) => {
        const was = beforePlants?.find((b) => b.plant === p.plant)?.layout ?? null;
        if (isHeld(p.plant) && was) return <Plant key={p.plant} p={{ ...p, layout: was }} footX={p.x * w} footY={FOOT_Y(p.row)} sway={sway} gust={gust} gustDelay={delays[p.plant] ?? 0} reduced={reduced} items={[]} settled before={null} call={budCall} zoom={target.zoom} />;   // R201: held, as it was
        return <Plant key={p.plant} p={p} footX={p.x * w} footY={FOOT_Y(p.row)} sway={sway} gust={gust} gustDelay={delays[p.plant] ?? 0} reduced={reduced} items={itemsOf(p.plant)} settled={settledOf(p.plant)} before={was} call={budCall} zoom={target.zoom} />;
       }),
       <Svg key={`signs-${row}`} width={w} height={CANVAS.height} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none">
        {of("sign").filter((s) => s.row === row).map((s) => { const at = signPlacement(s, w, target.zoom, ground); return <G key={`s${s.plant}`} x={at.x} y={at.y}><Sign lines={s.lines} scale={at.scale} /></G>; })}
       </Svg>,
      ])}
     </Animated.View>
     </Animated.View>
     </Animated.View>
     </Animated.View>
     </GestureDetector>
    </Animated.View>
    {/* R250: the tapped plant's label, in the sky over it (the garden's headroom), centred on the plant and held inside the garden */}
    {label ? (
      <Animated.View key={label.n} entering={reduced ? undefined : FadeIn.duration(160)} exiting={reduced ? undefined : FadeOut.duration(160)} pointerEvents="none"
        style={{ position: "absolute", top: spacing.sm, left: Math.min(Math.max(spotOf(label.plant).rose.x - LABEL_W / 2, 0), w - LABEL_W), width: LABEL_W, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, gap: 2, elevation: 3, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}>
        {label.lines.map((l, i) => <ThemedText key={i} variant={i === 0 ? "label" : "caption"} tone={i === 0 ? undefined : "secondary"}>{l}</ThemedText>)}
      </Animated.View>
    ) : null}
    {/* R186: the Next planting row directly under the garden; the can sits at its bar's end */}
    <View style={{ width: w, marginTop: ROW_GAP }}>{row({ s: canS, onLayout: setRowAt })}</View>
    {/* the overlay over the garden, the row and the right gutter: the can's touch box lies inside it at rest and the finger stays inside
        it while dragged (Android drops touches outside a parent's bounds); box-none, so the garden's pinch and the row take every other touch */}
    {rowAt ? (
      <Animated.View pointerEvents="box-none" style={[{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }, canShown]}>
        <Can ready={canReady} reduced={reduced} tempo={tempo} width={w} overlayW={w + SIDE_GUTTER} wobbleKey={wobble} viewH={vh} viewHNow={target.viewH} barBelow={ROW_GAP + rowAt.bar} overlayBelow={ROW_GAP + rowAt.height} s={canS} targetAt={targetAt} spotOf={spotOf} tapTarget={budPlants[0] ?? null} sweep={[...plants].sort((p, q) => p.x - q.x).map((p) => p.plant)} buds={targets} onPour={pour} onVisit={onVisit} onDrop={onDrop} afterOpening={afterOpening} onPourEnd={() => setWatering(null)} onNudge={onNudge} />
      </Animated.View>
    ) : null}
    </View>
  );
}
