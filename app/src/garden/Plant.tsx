import Svg, { G } from "react-native-svg";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import type { PlantOnStage } from "@/model/scene-to-layout";
import type { PlantLayout } from "@/model/species";
import { drawnBy, type PlantItem } from "@/model/opening";
import { windAngle, swayPhase } from "@/model/motion";
import { plantTurn } from "@/model/layout";
import { PlacedPart } from "./parts";
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
function Bud({ q, plant, ox, oy, call }: { q: Extract<PlantOnStage["layout"]["parts"][number], { kind: "sprite" }>; plant: PlantOnStage["plant"]; ox: number; oy: number; call: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const t = call.value, on = t > 0 && t < 1;
    return { transform: [{ rotate: `${on ? 9 * Math.sin(4 * Math.PI * t) * (1 - t) : 0}deg` }, { scale: on ? 1 + 0.15 * Math.sin(Math.PI * t) : 1 }] };
  });
  const B = BUD_BOX * Math.max(1, q.scale);
  return (
    <Animated.View style={[{ position: "absolute", left: ox + q.x - B / 2, top: oy + q.y - B / 2, width: B, height: B, transformOrigin: [B / 2, B / 2, 0] }, style]} pointerEvents="none">
      <Svg width={B} height={B}><G x={B / 2} y={B / 2}><PlacedPart p={{ ...q, x: 0, y: 0 }} plant={plant} /></G></Svg>
    </Animated.View>
  );
}
export function Plant({ p, footX, footY, sway, gust, gustDelay, reduced, items: planned, settled, before: was, call }: { p: PlantOnStage; footX: number; footY: number; sway: SharedValue<number>; gust: SharedValue<number>; gustDelay: number; reduced: boolean; items: PlantItem[]; settled: boolean; before: PlantLayout | null; call?: SharedValue<number> }) {
  const items = settled ? [] : planned, before = settled ? null : was;
  const all = before ? [...p.layout.parts, ...before.parts] : p.layout.parts;
  const reach = Math.max(60, ...all.map((q) => (q.kind === "stem" ? Math.max(Math.abs(q.x0), Math.abs(q.x1)) : Math.abs(q.x) + 20)));
  const W = Math.ceil(reach * 2 + 8), H = Math.ceil(Math.max(p.layout.top, before?.top ?? 0) + 24);
  const by = drawnBy(p.layout.parts.length, items, settled);
  const all0 = p.layout.parts.map((q, i) => ({ q, i })).filter(({ i }) => by[i] === "static").sort((a, b) => a.q.z - b.q.z);
  const isBud = (q: (typeof all0)[number]["q"]): q is Extract<typeof q, { kind: "sprite" }> => !!call && !reduced && q.kind === "sprite" && q.part === "bud";
  const parts = all0.filter(({ q }) => !isBud(q)), buds = all0.flatMap(({ q, i }) => (isBud(q) ? [{ q, i }] : []));   // R248: buds in their own views
  const phase = swayPhase(p.plant);
  const swayStyle = useAnimatedStyle(() => ({ transform: plantTurn(reduced ? 0 : windAngle(sway.value, phase, gust.value - gustDelay)) }));
  const key = (it: PlantItem) => `${it.kind}-${it.part}`;
  return (
    <Animated.View style={[{ position: "absolute", left: footX - W / 2, top: footY - H, width: W, height: H + BELOW, transformOrigin: [W / 2, H, 0] }, swayStyle]} pointerEvents="none">
      {items.map((it) => {
        const q = p.layout.parts[it.part];
        return it.kind === "stem" && q?.kind === "stem" ? <StemReveal key={key(it)} s={q} ox={W / 2} oy={H} delay={it.delay} ms={it.ms} reduced={reduced} /> : null;
      })}
      <Svg width={W} height={H + BELOW}>
        <G x={W / 2} y={H}>
          {parts.map(({ q, i }) => <PlacedPart key={i} p={q} plant={p.plant} />)}
          {items.map((it) => {
            if (it.kind === "bud") { const b = before?.parts[it.part]; return b ? <Appear key={key(it)} delay={it.delay} ms={it.ms} out><PlacedPart p={b} plant={p.plant} /></Appear> : null; }
            const q = p.layout.parts[it.part];
            if (!q) return null;
            if (it.kind === "strip" && q.kind === "sprite") return <Strip key={key(it)} p={q} id={`strip-${p.plant}-${it.part}`} strip={it.strip} delay={it.delay} ms={it.ms} reduced={reduced} />;
            if (it.kind === "fade") return <Appear key={key(it)} delay={it.delay} ms={it.ms}><PlacedPart p={q} plant={p.plant} /></Appear>;
            return null;
          })}
        </G>
      </Svg>
      {call ? buds.map(({ q, i }) => <Bud key={`bud${i}`} q={q} plant={p.plant} ox={W / 2} oy={H} call={call} />) : null}
    </Animated.View>
  );
}
