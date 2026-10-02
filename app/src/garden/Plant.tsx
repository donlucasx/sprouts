import Svg, { G } from "react-native-svg";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import type { PlantOnStage } from "@/model/scene-to-layout";
import type { PlantLayout } from "@/model/species";
import { drawnBy, type PlantItem } from "@/model/opening";
import { swayAngle, swayPhase } from "@/model/motion";
import { PlacedPart } from "./parts";
import { Strip, Appear, StemReveal } from "./Strip";
/** Room below the foot: the succulent's outermost blades turn past level and their baked boxes reach up to 10.6 px under it (the
 * preview year, day 365); 4 px cut them. */
const BELOW = 12;
/**
 * One plant: its layout drawn in one Svg whose origin is the plant's foot, positioned on the garden. Parts draw in z order.
 * The sway (his note, 10-02): the whole plant turns about its foot on the garden's one clock `sway` at its own phase, all the time;
 * none under reduced motion. The opening (spec 6): every part an `items` entry moves is left out of the static drawing and drawn by
 * its own player (Strip, Appear, StemReveal) until the garden settles (`drawnBy`: then every part is static, its end picture, so
 * nothing can stay hidden); a closed bud that opened fades out from `before`, the layout the scene had before the change.
 */
export function Plant({ p, footX, footY, sway, reduced, items: planned, settled, before: was }: { p: PlantOnStage; footX: number; footY: number; sway: SharedValue<number>; reduced: boolean; items: PlantItem[]; settled: boolean; before: PlantLayout | null }) {
  const items = settled ? [] : planned, before = settled ? null : was;
  const all = before ? [...p.layout.parts, ...before.parts] : p.layout.parts;
  const reach = Math.max(60, ...all.map((q) => (q.kind === "stem" ? Math.max(Math.abs(q.x0), Math.abs(q.x1)) : Math.abs(q.x) + 20)));
  const W = Math.ceil(reach * 2 + 8), H = Math.ceil(Math.max(p.layout.top, before?.top ?? 0) + 24);
  const by = drawnBy(p.layout.parts.length, items, settled);
  const parts = p.layout.parts.map((q, i) => ({ q, i })).filter(({ i }) => by[i] === "static").sort((a, b) => a.q.z - b.q.z);
  const phase = swayPhase(p.plant);
  const swayStyle = useAnimatedStyle(() => (reduced ? { transform: [] } : { transform: [{ rotate: `${swayAngle(sway.value, phase)}deg` }] }));
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
    </Animated.View>
  );
}
