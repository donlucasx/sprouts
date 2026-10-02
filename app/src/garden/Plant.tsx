import { View } from "react-native";
import Svg, { G } from "react-native-svg";
import type { PlantOnStage } from "@/model/scene-to-layout";
import { PlacedPart } from "./parts";
/** Room below the foot: the succulent's outermost blades turn past level and their baked boxes reach up to 10.6 px under it (the
 * preview year, day 365); 4 px cut them. */
const BELOW = 12;
/** One plant: its layout drawn in one Svg whose origin is the plant's foot, positioned on the garden. Parts draw in z order. */
export function Plant({ p, footX, footY }: { p: PlantOnStage; footX: number; footY: number }) {
  const reach = Math.max(60, ...p.layout.parts.map((q) => (q.kind === "stem" ? Math.max(Math.abs(q.x0), Math.abs(q.x1)) : Math.abs(q.x) + 20)));
  const W = Math.ceil(reach * 2 + 8), H = Math.ceil(p.layout.top + 24);
  const parts = [...p.layout.parts].sort((a, b) => a.z - b.z);
  return (
    <View style={{ position: "absolute", left: footX - W / 2, top: footY - H, width: W, height: H + BELOW }} pointerEvents="none">
      <Svg width={W} height={H + BELOW}><G x={W / 2} y={H}>{parts.map((q, i) => <PlacedPart key={i} p={q} plant={p.plant} />)}</G></Svg>
    </View>
  );
}
