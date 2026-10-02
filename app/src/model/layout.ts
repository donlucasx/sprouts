import { BAKED_L, type Placed, type PlantId } from "./species";
import type { Scene } from "./garden";
import type { PlantOnStage } from "./scene-to-layout";   // a type only: no require cycle
import { SPRITE_META } from "@/garden/sprite-meta";   // boxes only, no require(): safe in node
import { appGround, soilBottomAt } from "./soil-clip";

/** Spec 5: the canvas is the screen width minus 40 by 260; the soil line at 200; the back row's feet at 214 and the front's at 244. */
export const CANVAS = { height: 260, soilLine: 200, backFeet: 214, frontFeet: 244, backScale: 0.8 } as const;
export const ROW_OF: Record<PlantId, "front" | "back"> = { skr: "front", ore: "front", hsol: "back", jitosol: "back", jupsol: "back", cbbtc: "back" };
/** I4 fix round 3: the screen's side padding (theme spacing.edge; Home draws the garden at the width minus twice this). The plants may
 * spill this far past the garden's sides (a swaying sunflower, the spruce); the soil, the signs and the frame stay inside. */
export const SIDE_GUTTER = 20;
/** RG17, gen06_garden.py:59: the locked slots as fractions of the width. */
export const SLOT_X: Record<PlantId, number> = { skr: 0.3, ore: 0.8, hsol: 0.09, jitosol: 0.5, jupsol: 0.67, cbbtc: 0.92 };
export const FOOT_Y = (row: "front" | "back") => (row === "front" ? CANVAS.frontFeet : CANVAS.backFeet);
/** Where each occupant stands. An occupant is a present plant or a bare sign (gen06:57-58). A lone FRONT occupant centres at 0.40
 * (gen06:61); a lone back plant keeps its species slot (RG22). */
export function slotsFor(occupied: PlantId[]): Partial<Record<PlantId, number>> {
  const out: Partial<Record<PlantId, number>> = {};
  const front = occupied.filter((p) => ROW_OF[p] === "front");
  for (const p of occupied) out[p] = front.length === 1 && ROW_OF[p] === "front" ? 0.4 : SLOT_X[p];
  return out;
}
/** gen06:68-71: the side with more room at foot level; the room is the distance to the nearest other occupant in EITHER row, the
 * canvas edge counting as twice the distance to it; ties go left. `allX` holds every occupant's x in px, this one included. */
export function signSide(x: number, allX: number[], width: number): -1 | 1 {
  const left = Math.min(...allX.filter((v) => v < x).map((v) => x - v), 2 * x);
  const right = Math.min(...allX.filter((v) => v > x).map((v) => v - x), 2 * (width - x));
  return right > left ? 1 : -1;
}
/** Device round 3, item 2 (10-02): the stakes and their words 1.35x the gen01 board, in the app and the widget. */
export const SIGN_SCALE = 1.35;
/** The drawn scale of a sign: SIGN_SCALE in the front row, times the back row's 0.8 behind it (1.35 and 1.08). */
export const signScale = (row: "front" | "back") => SIGN_SCALE * (row === "front" ? 1 : CANVAS.backScale);
/** gen06:72-74: 14 px from the foot plus a fifth of the sign's half width, clamped a pixel inside the canvas. `scale` is the sign's
 * drawn scale (signScale: 1.35 front, 1.08 back), so its half width (15 at 1x) grows with the board. */
export function signX(x: number, side: -1 | 1, width: number, scale: number): number {
  const half = 15 * scale;
  return Math.min(Math.max(x + side * (14 + half * 0.2), half + 1), width - half - 1);
}
/** R181 (RG32): the post's foot from the sign's anchor, in the board's 1x units before its scale (bake.py: the contact mark reaches 9.4
 * below the generator's origin; the lowest painted pixel of the bake sits at x +1), and the room kept above the soil's bottom edge. */
export const SIGN_FOOT = { x: 1, y: 9.4 } as const;
export const SIGN_SOIL_MARGIN = 3;
/** Where a stake stands: x by signX, the anchor 4 px under its row's feet (gen06), raised when needed so the post's foot stays
 * SIGN_SOIL_MARGIN above the painted soil's bottom edge at its x (R181: since the 1.35x signs and the irregular ground the front posts
 * reached bare paper). `soilBottom` reads the edge for the garden's own ground placement. */
export function signStand(x: number, want: number, scale: number, soilBottom: (x: number) => number): number {
  return Math.min(want, soilBottom(x + SIGN_FOOT.x * scale) - SIGN_SOIL_MARGIN - SIGN_FOOT.y * scale);
}
/** The app's stake for a sign part, at the garden's width: its anchor and its drawn scale. */
export function signPlacement(s: { x: number; side: -1 | 1; row: "front" | "back" }, width: number) {
  const scale = signScale(s.row), x = signX(s.x * width, s.side, width, scale), g = appGround(width);
  return { x, y: signStand(x, FOOT_Y(s.row) + 4, scale, (px) => soilBottomAt(px, g)), scale };
}
/** R168 (10-02): the word on a stake, drawn as crisp type over the one blank baked board (`sign`), in the board's own frame: the anchor
 * at (0, 0) before the sign's scale (signScale: 1.35 front, 1.08 back), the board 30 by 11 from y -12 to -1, leaning -4 degrees (gen01_garden.py
 * sign()). 6.8 px fits the longest label, "JitoSOL" (3.62 em in Albert Sans Medium, 24.6 px), with 2.7 px a side; the baseline at
 * -4.1 centres the 0.70 em capitals on the face (its centre at -6.5). */
export const SIGN_TEXT = { size: 6.8, y: -4.1, rot: -4 } as const;
/** The words, as today: the ORE stake reads stORE (RG7). */
export const SIGN_LABEL: Record<PlantId, string> = { skr: "SKR", ore: "stORE", hsol: "hSOL", jitosol: "JitoSOL", jupsol: "JupSOL", cbbtc: "cbBTC" };
/** RG30 (10-02): the garden frames what is planted; 2x is the cap the 3x bakes hold; Garden.tsx eases each change over easeMs.
 * R167 (10-02): the view's HEIGHT follows the content, never shorter than the ground band plus `aboveGround`. */
export const FRAME = { maxZoom: 2, pad: 16, easeMs: 1200, aboveGround: 40 } as const;
/** Device round 3, item 1 (10-02): room to grow above the tallest part, a quarter of the content's height (the tallest part down to
 * the bed's bottom), never under 40 px on screen; it replaces the 16 px margin on top only. */
export const HEADROOM = { share: 0.25, minPx: 40 } as const;
/** `x`, `y`, `w`, `h` in canvas px; `viewH` the view's height on screen (h times zoom). */
export type Frame = { x: number; y: number; w: number; h: number; zoom: number; viewH: number };
/** How far a part reaches sideways from its plant's foot, a safe bound as `topOf` takes it: a leaf-like sprite its baked length times
 * its scale whatever its rotation; the head 17.6 scale; a swelling or dot its radius; the rest 8 scale; a stem its farther end. */
const sideReach = (q: Placed) => {
  if (q.kind === "stem") return Math.max(Math.abs(q.x0), Math.abs(q.x1));
  const base = BAKED_L[q.name.replace(/-s\d$/, "").replace(/-\d$/, "")];
  const len = base ? base[Number(q.name.match(/-s(\d)$/)?.[1] ?? 0)] * q.scale : q.part === "head" ? 17.6 * q.scale : q.part === "swelling" || q.part === "dot" ? q.scale : 8 * q.scale;
  return Math.abs(q.x) + len;
};
/** R167's floor in view px: the soil band (the soil line to the bed's bottom, 60) plus 40, so a garden of seeds is not a sliver. */
export const MIN_VIEW_H = CANVAS.height - CANVAS.soilLine + FRAME.aboveGround;
/** The baked ground's own height in canvas px (86 at 1x, the manifest's): the view always holds all of it, because its wash is
 * painted from about 13 px under its top and a crop there would show as a hard line. */
const groundH = () => SPRITE_META["ground"]?.h ?? CANVAS.height - CANVAS.soilLine;
/** RG30: the box (canvas px) around the present plants: each foot, its sideways reach and its height above the foot, and its own
 * sign; padded 16 at the sides; the top the tallest part less HEADROOM (a quarter of the content's height, at least 40 px on screen at
 * the breadth's zoom); the bottom the bed's. The zoom fits that box's breadth, capped at 2 (and at the bed's height, so the view is never
 * taller than 260); the frame is centred on the box's breadth and clamped inside the bed. R167: the view's height is the box's
 * (from its padded top down to the bed's bottom) times the zoom, floored at `minViewH`; only the empty top is cropped, so the ground
 * and the grain keep their anchor on the soil line, and the view always holds the whole ground sprite. Bare signs and seeds do not widen it; with no plant it is the whole breadth at the floor. */
export function frameFor(scene: Scene, plants: PlantOnStage[], width: number): Frame {
  const floor = Math.max(MIN_VIEW_H, groundH());
  if (plants.length === 0) return { x: 0, y: CANVAS.height - floor, w: width, h: floor, zoom: 1, viewH: floor };
  const signs = new Map(scene.parts.flatMap((q) => (q.kind === "sign" ? [[q.plant, q] as const] : [])));
  let x0 = width, x1 = 0, y0: number = CANVAS.height;
  for (const p of plants) {
    const fx = p.x * width, reach = Math.max(0, ...p.layout.parts.map(sideReach));
    x0 = Math.min(x0, fx - reach); x1 = Math.max(x1, fx + reach); y0 = Math.min(y0, FOOT_Y(p.row) - p.layout.top);
    const s = signs.get(p.plant);
    if (s) { const sc = signScale(s.row), sx = signX(s.x * width, s.side, width, sc); x0 = Math.min(x0, sx - 15 * sc); x1 = Math.max(x1, sx + 15 * sc); }
  }
  x0 = Math.max(0, x0 - FRAME.pad); x1 = Math.min(width, x1 + FRAME.pad);
  const breadthZoom = Math.min(FRAME.maxZoom, width / (x1 - x0));
  y0 = Math.max(0, y0 - Math.max(HEADROOM.share * (CANVAS.height - y0), HEADROOM.minPx / breadthZoom));
  const zoom = Math.min(breadthZoom, CANVAS.height / (CANVAS.height - y0));
  const viewH = Math.min(CANVAS.height, Math.max(MIN_VIEW_H, groundH() * zoom, (CANVAS.height - y0) * zoom));
  const w = width / zoom, h = viewH / zoom;
  const x = Math.min(Math.max((x0 + x1) / 2 - w / 2, 0), width - w);
  return { x, y: CANVAS.height - h, w, h, zoom, viewH };
}
/** RG25, drag to pour: the plant under the rose. `slots` holds the slots (fractions of the width) of the plants with a closed bud; the
 * nearest by x within 40 px wins (the closest two slots, hSOL and SKR, are 67 px apart at 320 wide, so one always wins) while the rose is
 * over the garden (y from 0 to the front feet plus 10); null otherwise. x and y are canvas px (`toCanvas`). */
export function plantUnder(x: number, y: number, slots: Partial<Record<PlantId, number>>, width: number): PlantId | null {
  if (y < 0 || y > CANVAS.frontFeet + 10) return null;
  let best: PlantId | null = null, d = 40;
  for (const [p, fx] of Object.entries(slots) as [PlantId, number][]) { const dd = Math.abs(fx * width - x); if (dd < d) { d = dd; best = p; } }
  return best;
}
/** A point on the garden's view (px from its top-left) back on the canvas: RG30's frame puts canvas p at (p - frame) * zoom. */
export const toCanvas = (pt: { x: number; y: number }, frame: { x: number; y: number; zoom: number }) => ({ x: frame.x + pt.x / frame.zoom, y: frame.y + pt.y / frame.zoom });
