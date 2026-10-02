import { GROUND_OUTLINE } from "@/garden/sprite-meta";

export const SOIL_CLIP_ID = "soil";
const f = (n: number) => Number(n.toFixed(2));
/** R176 (no soil, no water): the painted soil's outline (the ground sprite's own 1x polygon, baked by brand/garden/bake.py) as an SVG
 * path in the garden's coordinates: the sprite placed with its top-left at (x0, y0), scaled sx across and sy down. The same string clips
 * the water rings in the app (a static ClipPath) and in the widget (a <clipPath>), so a ring never reaches bare paper. */
export function soilClipPath(x0: number, y0: number, sx: number, sy: number): string {
  return GROUND_OUTLINE.map(([x, y], i) => `${i ? "L" : "M"}${f(x0 + x * sx)} ${f(y0 + y * sy)}`).join("") + "Z";
}
