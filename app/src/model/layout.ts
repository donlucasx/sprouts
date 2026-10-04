import { BAKED_L, type Placed, type PlantId } from "./species";
import type { Scene } from "./garden";
import type { PlantOnStage } from "./scene-to-layout";   // a type only: no require cycle
import { SPRITE_META } from "@/garden/sprite-meta";   // boxes only, no require(): safe in node
import { appGround, soilBottomAt, GROUND } from "./soil-clip";

/** Spec 5: the canvas is the screen width minus 40 by 260; the soil line at 200; the back row's feet at 214 and the front's at 244. */
/** R231 (10-04, "play more into the perspective of which are closer (SKR & stORE)"): the canvas 290 deep (the ground 1.5x deeper below
 * the same soil line), the front row's feet at 266 (0.73 of the deeper band, from 244) and drawn `frontScale` 1.3x; the back row unchanged. */
export const CANVAS = { height: GROUND.bottom, soilLine: 200, backFeet: 214, frontFeet: 266, backScale: 0.8, frontScale: 1.3 } as const;
export const ROW_OF: Record<PlantId, "front" | "back"> = { skr: "front", ore: "front", hsol: "back", jitosol: "back", jupsol: "back", cbbtc: "back" };
/** I4 fix round 3: the screen's side padding (theme spacing.edge; Home draws the garden at the width minus twice this). The plants may
 * spill this far past the garden's sides (a swaying sunflower, the spruce); the soil, the signs and the frame stay inside. */
export const SIDE_GUTTER = 20;
/** R187 (10-02, "Scale plants 1.25x in place"): every plant (stems, leaves, tokens, buds, the swelling) draws 25 percent bigger about its
 * own foot, on the same slot; the signs, the soil and the rings keep their size. The frame is not refitted to it (same composition). */
export const PLANT_SCALE = 1.25;
/** Where a point of a plant drawn at its 1x layout lands once the plant is drawn PLANT_SCALE about its foot. */
export const fromFoot = (pt: { x: number; y: number }, foot: { x: number; y: number }) => ({ x: foot.x + (pt.x - foot.x) * PLANT_SCALE, y: foot.y + (pt.y - foot.y) * PLANT_SCALE });
/** The plant view's transform about its foot (the view's transform origin): the wind's turn and R187's scale. */
export function plantTurn(deg: number) {
  "worklet";
  return [{ rotate: `${deg}deg` }, { scale: PLANT_SCALE }];
}
/** R187 fix round 1: the angles a plant reaches at in the wind, which frameFor's gutter-fit term holds: the steady sway either way
 * (motion.ts SWAY.deg) and the gust's peak (GUST.deg, always rightward). Literals here, so layout does not import motion (motion imports
 * garden, which imports layout); a test holds them to motion's. */
export const WIND_REACH_DEG = [-5, 5, 12] as const;
/** A part's baked box corners (or a stem's two ends) in its plant's frame at 1x, foot at the origin. */
function partCorners(q: Placed): [number, number][] {
  if (q.kind === "stem") return [[q.x0, q.y0], [q.x1, q.y1]];
  const m = SPRITE_META[q.name]; if (!m) return [[q.x, q.y]];
  const r = (q.rot * Math.PI) / 180, sx = q.xScale ?? q.scale, sy = q.scale;
  return ([[0, 0], [m.w, 0], [0, m.h], [m.w, m.h]] as const).map(([u, v]) => { const lx = (u - m.ax) * sx, ly = (v - m.ay) * sy; return [q.x + lx * Math.cos(r) - ly * Math.sin(r), q.y + lx * Math.sin(r) + ly * Math.cos(r)]; });
}
/** The canvas x span every plant reaches at PLANT_SCALE, turned to each of WIND_REACH_DEG about its foot. */
export function windSpan(plants: PlantOnStage[], width: number): { lo: number; hi: number } {
  let lo = Infinity, hi = -Infinity;
  for (const p of plants) for (const deg of WIND_REACH_DEG) {
    const a = (deg * Math.PI) / 180, fx = p.x * width;
    for (const q of p.layout.parts) for (const [x, y] of partCorners(q)) { const rx = fx + (x * Math.cos(a) - y * Math.sin(a)) * PLANT_SCALE; lo = Math.min(lo, rx); hi = Math.max(hi, rx); }
  }
  return { lo, hi };
}
/**
 * R187 fix round 1 (the controller's ruling): the gutter-fit term of the frame's zoom, and the frame's x. At zoom z the screen, gutters
 * included, shows canvas x from x - G/z to x + (width + G)/z; every plant's wind span [lo, hi] must lie inside it. The zoom is today's
 * (`zoom0`) unless that cannot hold the span, then just small enough:
 * - if a frame inside the bed (0 <= x <= width - width/z, so the soil fills the view) can hold it at some zoom of 1 or more, the largest
 *   such zoom: the span's breadth (width + 2G) / (hi - lo), and the room each side, G / (hi - width) and G / -lo;
 * - else only the span's breadth binds (a full-breadth garden zooms under 1 and the paper shows past the bed's ends).
 * x is today's (centred on the content box, held in the bed; centred on the bed when the frame is wider than it), moved only as far as
 * the span needs. A garden that fits keeps its zoom and frame; the slots never move.
 */
export function gutterFit(zoom0: number, mid: number, span: { lo: number; hi: number }, width: number): { zoom: number; x: number } {
  const G = SIDE_GUTTER, breadth = (width + 2 * G) / Math.max(1e-9, span.hi - span.lo);
  const inBed = Math.min(zoom0, breadth, span.hi > width ? G / (span.hi - width) : Infinity, span.lo < 0 ? G / -span.lo : Infinity);
  const zoom = inBed >= 1 ? inBed : Math.min(zoom0, breadth);
  const w = width / zoom, pref = w <= width ? Math.min(Math.max(mid - w / 2, 0), width - w) : (width - w) / 2;
  return { zoom, x: Math.min(Math.max(pref, span.hi - (width + G) / zoom), span.lo + G / zoom) };
}
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
/** R231: the front row's stakes FRONT_SIGN 1.2 times SIGN_SCALE (1.62), nearer the eye; the back row's unchanged (1.08). */
export const FRONT_SIGN = 1.2;
export const signScale = (row: "front" | "back") => SIGN_SCALE * (row === "front" ? FRONT_SIGN : CANVAS.backScale);
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
export const FRAME = { maxZoom: 2, pad: 18, easeMs: 1200, aboveGround: 40 } as const;   // R231: pad from 16, the 1.3x front row's sway
/** Room to grow above the tallest part: 60 percent of the content's height (the tallest part down to the bed's bottom), never under
 * 72 px on screen (R185; device round 3 item 1 had a quarter and 40 px); it replaces the 16 px margin on top only. */
export const HEADROOM = { share: 0.6, minPx: 72 } as const;   // R185 (10-02, "waiting for more headroom"): from round 3's 25 percent and 40 px
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
/** I4 fix round 5: the view's height cap on screen (it was the bed's 260 before R185's headroom). */
export const MAX_VIEW_H = 380;   // R231: from 320, for the deeper ground
/** RG30: the box (canvas px) around the present plants: each foot, its sideways reach and its height above the foot, and its own
 * sign; padded 16 at the sides; the bottom the bed's. The zoom fits that box's breadth (capped at 2) and its CONTENT height (the tallest
 * part down to the bed's bottom) in the bed's 260, never the headroom: R185's room to grow never shrinks the plants (I4 fix round 5).
 * The view then grows upward by the headroom, max(72 px on screen, 60 percent of the content), and its height is capped at MAX_VIEW_H
 * (the headroom gives way first); frame.y goes above the canvas's top (negative) when the headroom reaches past it, the paper showing
 * there. The frame is centred on the box's breadth and clamped inside the bed. R167: the view's height floors at the soil band plus 40
 * and always holds the whole ground sprite; only the empty top is cropped, so the ground and the grain keep their anchor on the soil
 * line. Bare signs and seeds do not widen it; with no plant it is the whole breadth at the floor. `room` is the headroom rule (tests
 * pass none to show the zoom does not depend on it). */
export function frameFor(scene: Scene, plants: PlantOnStage[], width: number, room: { share: number; minPx: number } = HEADROOM): Frame {
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
  const content = CANVAS.height - Math.max(0, y0);
  const zoom0 = Math.min(FRAME.maxZoom, width / (x1 - x0), CANVAS.height / content);
  const { zoom, x } = gutterFit(zoom0, (x0 + x1) / 2, windSpan(plants, width), width);
  const headroom = Math.max(room.share * content, room.minPx / zoom);   // canvas px
  const viewH = Math.min(MAX_VIEW_H, Math.max(MIN_VIEW_H, groundH() * zoom, (content + headroom) * zoom));
  const w = width / zoom, h = viewH / zoom;
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
