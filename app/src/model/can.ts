// The can's size, its seat at the end of the Next planting bar, its touch box, drag, drip and pour (R175 to R188, R195, R196, R201), pure so
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
 * top and bottom, its right edge RIGHT_IN past the drawn can (at its seat, on the garden's right edge); never under 48 dp a side (grown
 * left and up). At its seat it lies wholly inside the overlay (canRoomBelow gives the row the room under it), so Android never drops a
 * touch on it. */
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
/** R196: the finger's point stays at least this far inside the overlay. */
export const FINGER_IN = 4;
/** The finger's point at rest in the overlay's frame, from its point `local` in the touch box (the box unmoved, unlifted). */
export function grabAt(seat: { x: number; y: number }, hit: { ox: number; oy: number }, local: { x: number; y: number }) {
  "worklet";
  return { x: seat.x - hit.ox + local.x, y: seat.y - hit.oy + local.y };
}
/** The drag's translation, held so the FINGER's point (`grab` at rest, from grabAt) stays FINGER_IN inside the overlay's `bounds`:
 * Android drops touches outside a parent's bounds, during a drag too, and the finger is what it tracks. R196 (device check 2, "the
 * can should be able to be dragged off screen to the right"): at the right only the finger is held, so the can's art may hang past the
 * overlay and the screen's edge and its rose, at its left, reaches the right-most plant; at the left, top and bottom the whole touch box
 * (lifted `lift` about its centre) stays inside too, as before. A translation inside passes through. */
export function clampDrag(dx: number, dy: number, seat: { x: number; y: number }, hit: { w: number; h: number; ox: number; oy: number }, bounds: { w: number; h: number }, lift: number, grab: { x: number; y: number }) {
  "worklet";
  const cx = seat.x - hit.ox + hit.w / 2, cy = seat.y - hit.oy + hit.h / 2, hw = (lift * hit.w) / 2, hh = (lift * hit.h) / 2;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  return {
    dx: clamp(dx, Math.max(hw - cx, FINGER_IN - grab.x), bounds.w - FINGER_IN - grab.x),
    dy: clamp(dy, Math.max(hh - cy, FINGER_IN - grab.y), Math.min(bounds.h - hh - cy, bounds.h - FINGER_IN - grab.y)),
  };
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
/** The rose on screen (the overlay's frame): the can seated at `seat`, moved by `d`, tilted `tilt` degrees about its body's centre and
 * lifted `lift` about its touch box's centre (the view's transform origin), which is where the stream leaves it. */
export function roseOnScreen(seat: { x: number; y: number }, d: { dx: number; dy: number }, tilt: number, lift: number, s: number, hit: { w: number; h: number; ox: number; oy: number }) {
  "worklet";
  const r = roseAt(tilt, s), cx = hit.w / 2, cy = hit.h / 2;
  return { x: seat.x - hit.ox + d.dx + cx + lift * (hit.ox + r.x - cx), y: seat.y - hit.oy + d.dy + cy + lift * (hit.oy + r.y - cy) };
}
/** gen11_motion.py:159: the tap's whole sequence, 5.4 s, doubled by R202 ("About 2x slower", the pour ~4 s): 0 to 18 percent slide to
 * the plant, 18 to 32 tilt to -40 degrees, 32 to 70 pour (POUR_SHARE), 70 to 82 back to level, 82 to 100 home. A drag released over a
 * plant pours POUR_SHARE of it from the release. Then (R202) the can waits, level, until the opening ends, and only then goes home. */
export const CAN_MS = 10800;
export const POUR_SHARE = 0.38;
/** R195 (device check 2, "it should wait about 2 seconds before it wobbles"): the can's one wobble starts this long after it shows
 * ready, and again on every landing on the garden and every pull-to-refresh while a bud waits. */
export const WOBBLE_WAIT_MS = 2000;
/**
 * R201, the pour (his pick: "a thin see-through stream from the rose that wavers slightly, breaking into a few drops near the soil, a
 * small splash where it lands"): in WATER at `opacity`, sizes in screen px per canvas px (dropSize). The unbroken stream covers the top
 * `body` of the fall in `segments` pieces, thinning as it falls (`widths`), each swinging up to `waver` times its index sideways, so the
 * column bends a little and never as one stiff line; below it `drops` drops fall the rest of the way, accelerating; at the ground a
 * splash ring spreads and fades, two droplets hop out of it. One clock of `clockMs` drives all of it (the drops and the splash run
 * `beats` times per turn); the stream grows from the rose over `growMs` and fades over `fadeMs`.
 */
export const STREAM = { body: 0.62, segments: 3, widths: [1.6, 1.3, 1.05], waver: 0.55, drops: 3, dropW: 1.25, dropH: 2.3, splashW: 7, splashH: 2, opacity: 0.4, clockMs: 2400, beats: 4, growMs: 350, fadeMs: 300 } as const;
/** Where piece `k` of the unbroken stream lies, px down from the rose, for a fall of `fall` px (never under 8) and a stream grown `grown`
 * (0 to 1): its top and its drawn height (0 while the stream has not reached it). Worklet: the stream's styles read it. */
export function streamPiece(k: number, fall: number, grown: number) {
  "worklet";
  const f = Math.max(8, fall), h = (f * STREAM.body) / STREAM.segments;
  const reach = Math.min(1, Math.max(0, grown * STREAM.segments - k));
  return { top: k * h, h: reach * h };
}
/** Drop `i` of the broken part at clock phase `q` (0 to 1): px down from the rose (falling from the stream's end to the ground,
 * accelerating) and its opacity share (it fades over the last tenth, just above the splash). */
export function streamDrop(i: number, q: number, fall: number) {
  "worklet";
  const f = Math.max(8, fall), p = (q * STREAM.beats + i / STREAM.drops) % 1, from = f * (STREAM.body - 0.03);
  return { y: from + (f - from) * p * p, alpha: p < 0.9 ? 1 : (1 - p) / 0.1 };
}
/** The drops are drawn at the garden's scale (screen px per canvas px), which is the can's without its growth. */
export const dropSize = (s: number) => (s * 3) / CAN_GROW;
/** R184 item 3: while a bud waits, one drop forms at the rose, falls a short way and fades, every 4 s. */
export const DRIP = { everyMs: 4000, formMs: 700, fallMs: 450, fallPx: 12 } as const;
