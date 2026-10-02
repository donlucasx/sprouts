// The can's size, seat, touch box and drip in the garden (R175, R180, R184), pure so the frame's room for it is tested. Every function
// is a worklet where the can's gestures read it. Dependency-free: the boxes come from the generated sprite-meta (no require()).
import { SPRITE_META } from "@/garden/sprite-meta";

const REST = SPRITE_META["can"] ?? { w: 73.67, h: 57.33, ax: 47.67, ay: 31.33 };
const HALF = Math.max(...[SPRITE_META["can"], SPRITE_META["can-tilt"]].flatMap((m) => (m ? [m.ax, m.w - m.ax, m.ay, m.h - m.ay] : [0])));
/** R184 (10-02): the can 2.2x the size it first had (G11's proportion, can11 at a third of the frame's zoom, at least 32 px wide);
 * R180 had 1.6x. */
export const CAN_GROW = 2.2;
/** R175: the can's top sits this many px over the garden view's bottom edge (the soil's), so it reads as connected. */
export const CAN_OVERLAP = 8;
/** The touch box reaches this far past the drawn can at its left, top and bottom; at its right it stops at the wrapper's edge. */
const HIT_PAD = 8, RIGHT_IN = 4;
/** px per sprite unit at the frame's zoom. */
export const canScale = (zoom: number) => CAN_GROW * Math.max(32 / REST.w, zoom / 3);
/** A square that holds the rest and the tilted sprite about the body's centre: the drawing layers' box. */
export const canArt = (s: number) => Math.ceil(2 * HALF * s) + 2;
/** R184 item 5: the touch box, `w` by `h` with the body's centre at (ox, oy) inside it: the drawn rest can plus HIT_PAD at its left,
 * top and bottom, its right edge on the wrapper's right edge; never under 48 dp a side (grown left and up). With the can at its seat it
 * lies wholly inside the garden's wrapper (canBelow adds the room under it), so Android never drops a touch on it. */
export function canHit(s: number) {
  "worklet";
  const right = (REST.w - REST.ax) * s + RIGHT_IN, bottom = (REST.h - REST.ay) * s + HIT_PAD;
  const w = Math.max(48, REST.ax * s + HIT_PAD + right), h = Math.max(48, REST.ay * s + HIT_PAD + bottom);
  return { w, h, ox: w - right, oy: h - bottom };
}
/** How far the can's touch box reaches below the garden's view at scale `s`: the wrapper adds this much room, so nothing is cut. */
export const canBelow = (s: number) => REST.h * s - CAN_OVERLAP + HIT_PAD;
/** The can's seat (its body's centre) in the wrapper's frame (px from the garden view's top-left): bottom right, 4 px in. */
export const canHome = (width: number, viewH: number, s: number) => {
  "worklet";
  return { x: width - RIGHT_IN - (REST.w - REST.ax) * s, y: viewH - CAN_OVERLAP + REST.ay * s };
};
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
