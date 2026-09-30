import { G, Path, Circle, Ellipse, Rect } from "react-native-svg";
import { SOIL_PATH } from "@/model/soil";

// The parts library as SVG placeholders. The branding session delivers watercolor images for the same names (soil, sprout stages
// 0 to 3, bud, fruit, ripening bud, transplant, succulent, pup, basket, wet spot, watering can); the swap is one file: replace each
// <G> body with an <Image> of the same box. The model never changes.

export const INK = "#2B2B2B";
export const GREEN = "#3F7A4A";
export const OCHRE = "#B08A4B";
export const FRUIT = "#C9553D";
export const WATER = "#5C8BB3";

export function Soil({ width }: { width: number }) {
  return <Path d={SOIL_PATH(width)} fill={OCHRE} opacity={0.9} />;
}

/** R89: a coin's one stem, from the soil (0, 0) up `rise` pixels. The ORE succulent's stem is short and thick. */
export function Stem({ rise, plant }: { rise: number; plant: "skr" | "ore" }) {
  return <Path d={`M0 0 Q 2 ${-rise / 2} 0 ${-rise}`} stroke={GREEN} strokeWidth={plant === "skr" ? 3 : 4.5} fill="none" strokeLinecap="round" />;
}

/**
 * R89: one planting, as a shoot on the stem, in a 28 x 28 box whose centre is its node. A closed bud until watered, then a leaf
 * that grows with its age; the ORE succulent's leaves are rounder.
 */
export function Shoot({ stage, bud, side, size, plant }: { stage: 0 | 1 | 2 | 3; bud: boolean; side: -1 | 1; size: number; plant: "skr" | "ore" }) {
  if (bud) return <Ellipse cx={14 + side * 3} cy={13} rx={3.5} ry={5} fill={GREEN} opacity={0.75} transform={`rotate(${side * 20} ${14 + side * 3} 13)`} />;
  const rx = plant === "skr" ? size : size * 0.85;
  const ry = plant === "skr" ? size / 2.2 : size / 1.6;
  return <Ellipse cx={14 + side * rx} cy={14 - stage} rx={rx} ry={ry} fill={GREEN} transform={`rotate(${side * -25} ${14 + side * rx} ${14 - stage})`} />;
}

/** R89: change waiting to be planted, a bud forming at the stem's top that swells toward the threshold. */
export function Forming({ progress }: { progress: number }) {
  return <Circle cx={0} cy={0} r={2 + 3.5 * progress} fill={GREEN} opacity={0.45 + 0.4 * progress} />;
}

/** How far above its base an open plant's tip is, so fruit can hang from it: the SKR stem, or the ORE succulent's rosette. */
export function plantHeight(plant: "skr" | "ore", stage: 0 | 1 | 2 | 3): number {
  return plant === "skr" ? [18, 34, 52, 72][stage] : 10 + [7, 11, 15, 19][stage];
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

/** The next fruit, swelling with each reward event: a bud that grows with progress. */
export function Ripening({ progress }: { progress: number }) {
  return <Circle cx={0} cy={0} r={2 + 3 * progress} fill={GREEN} opacity={0.7} />;
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
