import { GROUND_OUTLINE, SPRITE_META } from "@/garden/sprite-meta";

export const SOIL_CLIP_ID = "soil";
const f = (n: number) => Number(n.toFixed(2));
/** R176 (no soil, no water): the painted soil's outline (the ground sprite's own 1x polygon, baked by brand/garden/bake.py) as an SVG
 * path in the garden's coordinates: the sprite placed with its top-left at (x0, y0), scaled sx across and sy down. The same string clips
 * the water rings in the app (a static ClipPath) and in the widget (a <clipPath>), so a ring never reaches bare paper. */
export function soilClipPath(x0: number, y0: number, sx: number, sy: number): string {
  return GROUND_OUTLINE.map(([x, y], i) => `${i ? "L" : "M"}${f(x0 + x * sx)} ${f(y0 + y * sy)}`).join("") + "Z";
}
/** Where a ground sprite is drawn: its top-left at (x0, y0), scaled sx across and sy down (the app's and the widget's placements). */
export type GroundPlace = { x0: number; y0: number; sx: number; sy: number };
/** The app's ground (spec 5, RG28): the soil line plus 60 is its bottom, 320 wide at 1x scaled to the garden's width. */
/** R231 (10-04, his ruling: a taller garden, more depth between the rows): the bake drawn GROUND.sy deep, its top edge where it was
 * (the bake's top at 161, so the soil line stays at 200), its bottom on the canvas bottom, GROUND.bottom (from 260). */
export const GROUND = { sy: 1.5, bottom: 161 + 1.5 * 86 } as const;
/** R238 (10-04, his note: the soil's sides and bottom a rounded wash on paper, not a rectangle): the ground spans whatever the frame
 * shows, so its painted ends are never cut by the zoom; `frame` in canvas px (Layout's Frame x and w). */
export const frameGround = (width: number, frame: { x: number; w: number }): GroundPlace => ({ ...appGround(width), x0: frame.x, sx: frame.w / 320 });
export const appGround = (width: number): GroundPlace => ({ x0: 0, y0: GROUND.bottom - GROUND.sy * (SPRITE_META["ground"]?.h ?? 86), sx: width / 320, sy: GROUND.sy });
/** R181: the painted soil's bottom edge at x (garden px): the lowest crossing of the outline with the vertical at x; the outline's lowest
 * point when x is outside it. */
export function soilBottomAt(x: number, g: GroundPlace): number {
  const u = (x - g.x0) / g.sx; let low = -Infinity;
  for (let i = 0, j = GROUND_OUTLINE.length - 1; i < GROUND_OUTLINE.length; j = i++) {
    const [xi, yi] = GROUND_OUTLINE[i], [xj, yj] = GROUND_OUTLINE[j];
    if ((xi <= u && u <= xj) || (xj <= u && u <= xi)) low = Math.max(low, xi === xj ? Math.max(yi, yj) : yi + ((u - xi) * (yj - yi)) / (xj - xi));
  }
  if (low === -Infinity) low = Math.max(...GROUND_OUTLINE.map((q) => q[1]));
  return g.y0 + low * g.sy;
}
