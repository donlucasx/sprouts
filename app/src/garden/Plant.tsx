import Svg, { G } from "react-native-svg";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming, Easing, type SharedValue } from "react-native-reanimated";
import type { PlantOnStage } from "@/model/scene-to-layout";
import type { Placed, PlantLayout } from "@/model/species";
import { drawnBy, type PlantItem } from "@/model/opening";
import { windAngle, swayPhase } from "@/model/motion";
import { plantTurn, PLANT_SCALE } from "@/model/layout";
import { useEffect, type ReactNode } from "react";
import { isClosedPart, leafAt, sproutState, twigAxis } from "@/model/sprout";
import { leafLen } from "@/model/plant-geometry";
import { SPRITE_META } from "./sprite-meta";
import { View } from "react-native";
import { PlacedPart, PaintedStem, SpriteAt } from "./parts";
import { Strip, Appear, StemReveal } from "./Strip";
/** Room below the foot: the succulent's outermost blades turn past level and their baked boxes reach up to 10.6 px under it (the
 * preview year, day 365); 4 px cut them. */
const BELOW = 12;
/**
 * One plant: its layout drawn in one Svg whose origin is the plant's foot, positioned on the garden. Parts draw in z order.
 * The sway (his note, 10-02): the whole plant turns about its foot on the garden's one clock `sway` at its own phase, all the time;
 * none under reduced motion. R189: the garden's gust clock `gust` (ms into a gust) less this plant's `gustDelay` swings it to about
 * 12 degrees and back (windAngle). R187: the same view transform draws the whole plant 1.25x about its foot (plantTurn), the
 * openings' players with it, under reduced motion too. The opening (spec 6): every part an `items` entry moves is left out of the static drawing and drawn by
 * its own player (Strip, Appear, StemReveal) until the garden settles (`drawnBy`: then every part is static, its end picture, so
 * nothing can stay hidden); a closed bud that opened fades out from `before`, the layout the scene had before the change.
 */
/** R248 (10-04, "Should the buds also increase in size slightly as they wobble to grab attention?", ruled "Wobble + swell"): a closed
 * bud is drawn in its own small view about its anchor, which `call` (0 to 1, one call; Garden's clock) swells about 15 percent and
 * rocks a few degrees, settling back by the call's end. */
const BUD_BOX = 40;
/** R302 (10-04, "leaves still read blurry against the definition of the stalk and branches"): react-native-svg on Android draws an Svg
 * into a bitmap at its LAYOUT size (SvgView.drawOutput) and the views above it scale that bitmap: a plant's 1.25x (R187) and the frame's
 * zoom (up to 2) stretched every plant 2.5 times, stems included (3.4 px edge ramps on the Seeker). The Svg is laid out `res` times
 * larger with the same viewBox and drawn back down by `res`, so its bitmap holds the pixels the screen shows. */
export const renderRes = (zoom: number) => Math.min(3, Math.max(1, PLANT_SCALE * zoom));
function HiSvg({ width, height, res, children }: { width: number; height: number; res: number; children: ReactNode }) {
  return (
    <View style={{ position: "absolute", left: 0, top: 0, width, height }} pointerEvents="none">
      <Svg width={width * res} height={height * res} viewBox={`0 0 ${width} ${height}`} style={{ transformOrigin: [0, 0, 0], transform: [{ scale: 1 / res }] }}>{children}</Svg>
    </View>
  );
}
/** R351: the mandarin's closed sprout calls more gently than a bud (Claude's call on his "keep a gentle version"), rocking about its
 * node, where the nub meets the branch, so it stays attached. */
const CALL = { bud: { rock: 9, swell: 0.15 }, sprout: { rock: 5, swell: 0.07 } } as const;
type Closed = { parts: Placed[]; px: number; py: number; B: number; call: (typeof CALL)[keyof typeof CALL] };
/** A closed shoot's call group: a bud sprite about its anchor (as R248 drew it), or a sprout's nub and furled pair about its node. */
function closedGroups(parts: Placed[]): Closed[] {
  const out: Closed[] = [];
  for (const q of parts) {
    if (q.kind === "stem" && q.part === "nub") {
      const mine = parts.filter((p) => p.shoot === q.shoot && (p.part === "furl" || p === q));
      const reach = Math.max(...mine.map((p) => (p.kind === "stem" ? Math.hypot(p.x1 - q.x0, p.y1 - q.y0) : Math.hypot(p.x - q.x0, p.y - q.y0) + leafLen(p))));
      out.push({ parts: mine, px: q.x0, py: q.y0, B: 2 * Math.ceil(reach + 4), call: CALL.sprout });
    } else if (q.kind === "sprite" && q.part === "bud") out.push({ parts: [q], px: q.x, py: q.y, B: BUD_BOX * Math.max(1, q.scale), call: CALL.bud });
  }
  return out;
}
function Bud({ g, plant, ox, oy, call, res }: { g: Closed; plant: PlantOnStage["plant"]; ox: number; oy: number; call: SharedValue<number>; res: number }) {
  const { rock, swell } = g.call;
  const style = useAnimatedStyle(() => {
    const t = call.value, on = t > 0 && t < 1;
    return { transform: [{ rotate: `${on ? rock * Math.sin(4 * Math.PI * t) * (1 - t) : 0}deg` }, { scale: on ? 1 + swell * Math.sin(Math.PI * t) : 1 }] };
  });
  const B = g.B;
  return (
    <Animated.View style={[{ position: "absolute", left: ox + g.px - B / 2, top: oy + g.py - B / 2, width: B, height: B, transformOrigin: [B / 2, B / 2, 0] }, style]} pointerEvents="none">
      <HiSvg width={B} height={B} res={res}><G x={B / 2 - g.px} y={B / 2 - g.py}>{g.parts.map((q, i) => <PlacedPart key={i} p={q} plant={plant} />)}</G></HiSvg>
    </Animated.View>
  );
}
/** R351: a mandarin sprout unfolding into its leaf pair (no crossfade): the open twig's own stem and two leaves, each in its own view,
 * moved by one clock `u` (0 to 1, linear; model/sprout.ts eases each phase). The stem view sits on the node and scales along the
 * stem's axis from the nub; each leaf view sits on the leaf's open anchor, its sprite drawn upright at the open scale, and the view
 * carries it to the stem's moving tip, turns it out and widens it. At u = 1 every view is the identity: the static twig. */
function Unfurl({ stem: s, leaves, ox, oy, delay, ms, res }: { stem: Extract<Placed, { kind: "stem" }>; leaves: Extract<Placed, { kind: "sprite" }>[]; ox: number; oy: number; delay: number; ms: number; res: number }) {
  const u = useSharedValue(0);
  useEffect(() => { u.value = 0; u.value = withDelay(delay, withTiming(1, { duration: ms, easing: Easing.linear })); }, [u, delay, ms]);
  const ang = twigAxis(s), R = Math.ceil(Math.hypot(s.x1 - s.x0, s.y1 - s.y0) + 6), S = 2 * R;
  const stemStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${ang}deg` }, { scaleY: sproutState(u.value).stem }, { rotate: `${-ang}deg` }] }));
  return (
    <>
      <Animated.View style={[{ position: "absolute", left: ox + s.x0 - R, top: oy + s.y0 - R, width: S, height: S, transformOrigin: [R, R, 0] }, stemStyle]} pointerEvents="none">
        <HiSvg width={S} height={S} res={res}><G x={R - s.x0} y={R - s.y0}><PaintedStem s={s} /></G></HiSvg>
      </Animated.View>
      {leaves.map((l, i) => <UnfurlLeaf key={i} l={l} s={s} ang={ang} u={u} ox={ox} oy={oy} res={res} />)}
    </>
  );
}
function UnfurlLeaf({ l, s, ang, u, ox, oy, res }: { l: Extract<Placed, { kind: "sprite" }>; s: Extract<Placed, { kind: "stem" }>; ang: number; u: SharedValue<number>; ox: number; oy: number; res: number }) {
  const m = SPRITE_META[l.name], xs0 = l.xScale ?? l.scale;
  const B = 2 * Math.ceil(Math.max(m?.w ?? 20, m?.h ?? 20) * Math.max(l.scale, xs0)) + 4;
  const style = useAnimatedStyle(() => {
    const a = leafAt(l, s.x0, s.y0, ang, sproutState(u.value));
    return { transform: [{ translateX: a.x - l.x }, { translateY: a.y - l.y }, { rotate: `${a.rot}deg` }, { scaleX: a.xScale / xs0 }, { scaleY: a.scale / l.scale }] };
  });
  return (
    <Animated.View style={[{ position: "absolute", left: ox + l.x - B / 2, top: oy + l.y - B / 2, width: B, height: B, transformOrigin: [B / 2, B / 2, 0] }, style]} pointerEvents="none">
      <HiSvg width={B} height={B} res={res}><SpriteAt name={l.name} x={B / 2} y={B / 2} rot={0} scale={l.scale} xScale={xs0} /></HiSvg>
    </Animated.View>
  );
}
export function Plant({ p, footX, footY, sway, gust, gustDelay, reduced, items: planned, settled, before: was, call, zoom = 1 }: { p: PlantOnStage; footX: number; footY: number; sway: SharedValue<number>; gust: SharedValue<number>; gustDelay: number; reduced: boolean; items: PlantItem[]; settled: boolean; before: PlantLayout | null; call?: SharedValue<number>; zoom?: number }) {
  const res = renderRes(zoom);
  const items = settled ? [] : planned, before = settled ? null : was;
  const all = before ? [...p.layout.parts, ...before.parts] : p.layout.parts;
  const reach = Math.max(60, ...all.map((q) => (q.kind === "stem" ? Math.max(Math.abs(q.x0), Math.abs(q.x1)) : Math.abs(q.x) + 20)));
  const W = Math.ceil(reach * 2 + 8), H = Math.ceil(Math.max(p.layout.top, before?.top ?? 0) + 24);
  const by = drawnBy(p.layout.parts.length, items, settled);
  const all0 = p.layout.parts.map((q, i) => ({ q, i })).filter(({ i }) => by[i] === "static").sort((a, b) => a.q.z - b.q.z);
  const calls = !!call && !reduced;   // R248: closed shoots (buds; R351 the mandarin's sprouts) in their own views, which call
  const parts = all0.filter(({ q }) => !(calls && isClosedPart(q))), buds = calls ? closedGroups(all0.map(({ q }) => q)) : [];
  const phase = swayPhase(p.plant);
  const swayStyle = useAnimatedStyle(() => ({ transform: plantTurn(reduced ? 0 : windAngle(sway.value, phase, gust.value - gustDelay)) }));
  const key = (it: PlantItem) => `${it.kind}-${it.part}`;
  return (
    <Animated.View style={[{ position: "absolute", left: footX - W / 2, top: footY - H, width: W, height: H + BELOW, transformOrigin: [W / 2, H, 0] }, swayStyle]} pointerEvents="none">
      {items.map((it) => {
        const q = p.layout.parts[it.part];
        if (it.kind === "unfurl" && !reduced && q?.kind === "stem") {
          const leaves = it.leaves.map((i) => p.layout.parts[i]).filter((l): l is Extract<Placed, { kind: "sprite" }> => l?.kind === "sprite");
          return <Unfurl key={key(it)} stem={q} leaves={leaves} ox={W / 2} oy={H} delay={it.delay} ms={it.ms} res={res} />;
        }
        return it.kind === "stem" && q?.kind === "stem" ? <StemReveal key={key(it)} s={q} ox={W / 2} oy={H} delay={it.delay} ms={it.ms} reduced={reduced} /> : null;
      })}
      <HiSvg width={W} height={H + BELOW} res={res}>
        <G x={W / 2} y={H}>
          {parts.map(({ q, i }) => <PlacedPart key={i} p={q} plant={p.plant} />)}
          {items.map((it) => {
            if (it.kind === "bud") { const b = before?.parts[it.part]; return b ? <Appear key={key(it)} delay={it.delay} ms={it.ms} out><PlacedPart p={b} plant={p.plant} /></Appear> : null; }
            const q = p.layout.parts[it.part];
            if (!q) return null;
            if (it.kind === "strip" && q.kind === "sprite") return <Strip key={key(it)} p={q} id={`strip-${p.plant}-${it.part}`} strip={it.strip} delay={it.delay} ms={it.ms} reduced={reduced} />;
            if (it.kind === "unfurl" && reduced) return <Appear key={key(it)} delay={it.delay} ms={it.ms}>{[it.part, ...it.leaves].map((i) => (p.layout.parts[i] ? <PlacedPart key={i} p={p.layout.parts[i]} plant={p.plant} /> : null))}</Appear>;   // reduced motion: the open twig under the 300 ms fade
            if (it.kind === "fade") return <Appear key={key(it)} delay={it.delay} ms={it.ms}><PlacedPart p={q} plant={p.plant} /></Appear>;
            return null;
          })}
        </G>
      </HiSvg>
      {call ? buds.map((g) => <Bud key={`bud-${g.parts[0].shoot ?? g.px}`} g={g} plant={p.plant} ox={W / 2} oy={H} call={call} res={res} />) : null}
    </Animated.View>
  );
}
