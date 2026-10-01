import { G, Path, Circle, Ellipse, Rect } from "react-native-svg";
import { SOIL_PATH } from "@/model/soil";
import type { PlantId } from "@/model/garden";

// The parts library as SVG placeholders. The branding session delivers watercolor images for the same names (soil, sprout stages
// 0 to 3, bud, fruit, ripening bud, transplant, succulent, pup, basket, wet spot, watering can); the swap is one file: replace each
// <G> body with an <Image> of the same box. The model never changes.

export const INK = "#2B2B2B";
export const GREEN = "#3F7A4A";
export const OCHRE = "#B08A4B";
export const FRUIT = "#C9553D";
export const WATER = "#5C8BB3";

/** Placeholder shapes per plant until the watercolour parts land (queue 24): stem width, leaf size, a tint. */
export const PLANT_STYLE: Record<PlantId, { stem: number; leafRx: number; leafRy: number; tint: string }> = {
  skr: { stem: 3, leafRx: 1, leafRy: 1, tint: GREEN },
  ore: { stem: 4.5, leafRx: 1, leafRy: 1, tint: GREEN },
  hsol: { stem: 3, leafRx: 1.3, leafRy: 0.8, tint: "#4F8A5A" },
  jitosol: { stem: 3, leafRx: 0.8, leafRy: 1.3, tint: "#3A7A6A" },
  jupsol: { stem: 3.5, leafRx: 1.1, leafRy: 1.1, tint: "#5C8A3F" },
  cbbtc: { stem: 4, leafRx: 1.4, leafRy: 1.0, tint: "#8A7A3F" },
};

export function Soil({ width }: { width: number }) {
  return <Path d={SOIL_PATH(width)} fill={OCHRE} opacity={0.9} />;
}

/** R89: a coin's one stem, from the soil (0, 0) up `rise` pixels, its width from PLANT_STYLE (the ORE succulent's is thick). */
export function Stem({ rise, plant }: { rise: number; plant: PlantId }) {
  return <Path d={`M0 0 Q 2 ${-rise / 2} 0 ${-rise}`} stroke={GREEN} strokeWidth={PLANT_STYLE[plant].stem} fill="none" strokeLinecap="round" />;
}

/**
 * R89: one planting, as a shoot on the stem, in a 28 x 28 box whose centre is its node. A closed bud until watered, then a leaf
 * that grows with its age; the ORE succulent's leaves are rounder, the other coins' are the SKR leaf scaled and tinted by PLANT_STYLE.
 */
export function Shoot({ stage, bud, side, size, plant }: { stage: 0 | 1 | 2 | 3; bud: boolean; side: -1 | 1; size: number; plant: PlantId }) {
  const style = PLANT_STYLE[plant];
  if (bud) return <Ellipse cx={14 + side * 3} cy={13} rx={3.5} ry={5} fill={style.tint} opacity={0.75} transform={`rotate(${side * 20} ${14 + side * 3} 13)`} />;
  const rx = (plant === "ore" ? size * 0.85 : size) * style.leafRx;
  const ry = (plant === "ore" ? size / 1.6 : size / 2.2) * style.leafRy;
  return <Ellipse cx={14 + side * rx} cy={14 - stage} rx={rx} ry={ry} fill={style.tint} transform={`rotate(${side * -25} ${14 + side * rx} ${14 - stage})`} />;
}

/** R89: change waiting to be planted, a bud forming at the stem's top that swells toward the threshold. */
export function Forming({ progress }: { progress: number }) {
  return <Circle cx={0} cy={0} r={2 + 3.5 * progress} fill={GREEN} opacity={0.45 + 0.4 * progress} />;
}

/** How far above its base an open plant's tip is, so fruit can hang from it: a stem (SKR's shape), or the ORE succulent's rosette. */
export function plantHeight(plant: PlantId, stage: 0 | 1 | 2 | 3): number {
  return plant === "ore" ? 10 + [7, 11, 15, 19][stage] : [18, 34, 52, 72][stage];
}

/** A sprout by stage: a stem with one to four leaves; stage 3 is a small branch. Drawn in a 40 x 80 box, anchored at the bottom centre. */
export function Sprout({ stage, bud }: { stage: 0 | 1 | 2 | 3; bud: boolean }) {
  if (bud) return <Circle cx={20} cy={70} r={5} fill={GREEN} opacity={0.6} />;
  const height = [18, 34, 52, 72][stage];
  const leaves = stage + 1;
  return (
    <G>
      <Path d={`M20 80 Q 22 ${80 - height / 2} 20 ${80 - height}`} stroke={GREEN} strokeWidth={2.5} fill="none" />
      {Array.from({ length: leaves }, (_, i) => {
        const y = 80 - (height * (i + 1)) / (leaves + 1);
        const dir = i % 2 === 0 ? -1 : 1;
        return <Ellipse key={i} cx={20 + dir * 8} cy={y} rx={9} ry={4.5} fill={GREEN} transform={`rotate(${dir * -25} ${20 + dir * 8} ${y})`} />;
      })}
    </G>
  );
}

/** A plant brought from before Sprouts (R61): drawn mature, no fruit. An 80 x 80 box. */
export function Transplant() {
  return (
    <G>
      <Path d="M40 80 Q 42 40 40 8" stroke={GREEN} strokeWidth={3.5} fill="none" />
      {[20, 34, 48, 62].map((y, i) => <Ellipse key={y} cx={40 + (i % 2 ? 14 : -14)} cy={y} rx={14} ry={7} fill={GREEN} />)}
    </G>
  );
}

/** The ORE succulent: a rosette that widens by stage, in the same 40 x 80 box as a sprout. */
export function Succulent({ stage, bud }: { stage: 0 | 1 | 2 | 3; bud: boolean }) {
  if (bud) return <Circle cx={20} cy={70} r={5} fill={GREEN} opacity={0.6} />;
  const r = [7, 11, 15, 19][stage];
  return <G>{[0, 60, 120, 180, 240, 300].map((a) => <Ellipse key={a} cx={20} cy={70 - r / 2} rx={r} ry={r / 2.4} fill={GREEN} transform={`rotate(${a} 20 ${70 - r / 2})`} opacity={0.85} />)}</G>;
}

export function Fruit({ bud, size = 1 }: { bud: boolean; size?: number }) {
  return <Circle cx={0} cy={0} r={5 * size} fill={bud ? GREEN : FRUIT} opacity={bud ? 0.6 : 1} />;
}

/** The next fruit's radius at `progress` (0 to 1): the layout needs it to seat the ORE pup on the soil. */
export const ripeningRadius = (progress: number) => 2 + 3 * progress;

/** The next fruit, swelling with each reward event: a bud that grows with progress. */
export function Ripening({ progress }: { progress: number }) {
  return <Circle cx={0} cy={0} r={ripeningRadius(progress)} fill={GREEN} opacity={0.7} />;
}

export function Pup() {
  return <Circle cx={0} cy={0} r={4} fill={GREEN} />;
}

export function Basket() {
  return (
    <G>
      <Rect x={0} y={0} width={26} height={16} rx={3} fill={OCHRE} />
      <Path d="M3 0 Q 13 -12 23 0" stroke={OCHRE} strokeWidth={2} fill="none" />
    </G>
  );
}

export function WetSpot({ age }: { age: number }) {
  return <Ellipse cx={0} cy={0} rx={34} ry={9} fill={WATER} opacity={0.35 * (1 - age)} />;
}

export function WateringCan() {
  return (
    <G>
      <Rect x={0} y={6} width={22} height={14} rx={3} fill={INK} />
      <Path d="M22 10 L 32 4" stroke={INK} strokeWidth={3} />
      <Path d="M4 6 Q 11 -4 18 6" stroke={INK} strokeWidth={2} fill="none" />
    </G>
  );
}
