// The can's size, its seat at the end of the Next planting bar, its touch box, drag and drip (R175, R180, R184, R186, R188), pure so
// the room for it is tested. Every function is a worklet where the can's gestures read it. No require(): the boxes come from the
// generated sprite-meta.
import { SPRITE_META } from "@/garden/sprite-meta";
import { toCanvas } from "./layout";

const REST = SPRITE_META["can"] ?? { w: 73.67, h: 57.33, ax: 47.67, ay: 31.33 };
const HALF = Math.max(...[SPRITE_META["can"], SPRITE_META["can-tilt"]].flatMap((m) => (m ? [m.ax, m.w - m.ax, m.ay, m.h - m.ay] : [0])));
/** R188 (10-02, "a tad bigger so it stands out"): the can 2.6x the size it first had (G11's proportion, can11 at a third of the frame's
 * zoom, at least 32 px wide); R184 had 2.2x, R180 1.6x. */
export const CAN_GROW = 2.6;
/** R186: the row sits this far under the garden's view (the overlay's origin is the garden's top-left). */
export const ROW_GAP = 8;
/** R186: the bar's right end stops this far before the drawn can. */
export const BAR_GAP = 6;
/** The touch box reaches this far past the drawn can at its left, top and bottom; at its right it stops at the overlay's edge. */
const HIT_PAD = 8, RIGHT_IN = 4;
/** px per sprite unit at the frame's zoom. */
export const canScale = (zoom: number) => CAN_GROW * Math.max(32 / REST.w, zoom / 3);
/** A square that holds the rest and the tilted sprite about the body's centre: the drawing layers' box. */
export const canArt = (s: number) => Math.ceil(2 * HALF * s) + 2;
/** R184 item 5: the touch box, `w` by `h` with the body's centre at (ox, oy) inside it: the drawn rest can plus HIT_PAD at its left,
 * top and bottom, its right edge on the overlay's right edge; never under 48 dp a side (grown left and up). At its seat it lies wholly
 * inside the overlay (canRoomBelow gives the row the room under it), so Android never drops a touch on it. */
export function canHit(s: number) {
  "worklet";
  const right = (REST.w - REST.ax) * s + RIGHT_IN, bottom = (REST.h - REST.ay) * s + HIT_PAD;
  const w = Math.max(48, REST.ax * s + HIT_PAD + right), h = Math.max(48, REST.ay * s + HIT_PAD + bottom);
  return { w, h, ox: w - right, oy: h - bottom };
}
/** R186: the width the Next planting row keeps free at its right for the can: the drawn can, 4 px in from the edge, and the gap the bar
 * stops short of it. The row's text and bar end there. */
export const canSlot = (s: number) => REST.w * s + RIGHT_IN + BAR_GAP;
/** R186: the room the row needs under its bar (a bar `barH` tall) so the can's touch box, centred on the bar, ends inside it. */
export const canRoomBelow = (s: number, barH: number) => Math.max(0, (REST.h / 2) * s + HIT_PAD - barH / 2);
/** R186: the can's seat (its body's centre) in the overlay's frame: at the right end of the bar, 4 px in from the edge, its drawn box
 * vertically centred on the bar's centre `barY` (px from the garden's top). */
export function canSeat(width: number, barY: number, s: number) {
  "worklet";
  return { x: width - RIGHT_IN - (REST.w - REST.ax) * s, y: barY - (REST.h / 2 - REST.ay) * s };
}
/** The drag's translation, held so the whole touch box (lifted `lift` about its centre) stays inside the overlay's `bounds` (Android
 * drops touches outside a parent's bounds, during a drag too); a translation inside passes through. */
export function clampDrag(dx: number, dy: number, seat: { x: number; y: number }, hit: { w: number; h: number; ox: number; oy: number }, bounds: { w: number; h: number }, lift: number) {
  "worklet";
  const cx = seat.x - hit.ox + hit.w / 2, cy = seat.y - hit.oy + hit.h / 2, hw = (lift * hit.w) / 2, hh = (lift * hit.h) / 2;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return { dx: clamp(dx, hw - cx, bounds.w - hw - cx), dy: clamp(dy, hh - cy, bounds.h - hh - cy) };
}
/** R186's drop hit-test: a point in the overlay (whose origin is the garden view's top-left) on the garden's canvas, through RG30's frame
 * (canvas p lands at (p - frame) * zoom). A point over the row maps below the front feet, so plantUnder finds nothing there. */
export const overlayToCanvas = (pt: { x: number; y: number }, frame: { x: number; y: number; zoom: number }) => toCanvas(pt, frame);
/** The rose, in the rest sprite's frame at k = 1 (sprite units), from the body's centre, the anchor (gen11_motion.py:123). */
const ROSE = { x: -38, y: -22 };
/** The rose from the body's centre at `tilt` degrees, on screen at sprite scale `s` (gen11_motion.py:123-124). */
export const roseAt = (tilt: number, s: number) => {
  "worklet";
  const a = (tilt * Math.PI) / 180;
  return { x: (ROSE.x * Math.cos(a) - ROSE.y * Math.sin(a)) * s, y: (ROSE.x * Math.sin(a) + ROSE.y * Math.cos(a)) * s };
};
/** The drops are drawn at the garden's scale (screen px per canvas px), which is the can's without its growth. */
export const dropSize = (s: number) => (s * 3) / CAN_GROW;
/** R184 item 3: while a bud waits, one drop forms at the rose, falls a short way and fades, every 4 s. */
export const DRIP = { everyMs: 4000, formMs: 700, fallMs: 450, fallPx: 12 } as const;
