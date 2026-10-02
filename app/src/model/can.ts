// The can's size and seat in the garden (R175, R180), pure so the frame's room for it is tested. Every function is a worklet where the
// can's gestures read it. Dependency-free: the boxes come from the generated sprite-meta (no require()).
import { SPRITE_META } from "@/garden/sprite-meta";

const REST = SPRITE_META["can"] ?? { w: 73.67, h: 57.33, ax: 47.67, ay: 31.33 };
const HALF = Math.max(...[SPRITE_META["can"], SPRITE_META["can-tilt"]].flatMap((m) => (m ? [m.ax, m.w - m.ax, m.ay, m.h - m.ay] : [0])));
/** R180 (10-02): the can 1.6x the size it first had (G11's proportion, can11 at a third of the frame's zoom, at least 32 px wide). */
export const CAN_GROW = 1.6;
/** R175: the can's top sits this many px over the garden view's bottom edge (the soil's), so it reads as connected. */
export const CAN_OVERLAP = 8;
/** px per sprite unit at the frame's zoom. */
export const canScale = (zoom: number) => CAN_GROW * Math.max(32 / REST.w, zoom / 3);
/** The can's square touch box, centred on its body: room for the rest and the tilted sprite, never under 48 dp (R180). */
export const canTouch = (s: number) => Math.max(48, Math.ceil(2 * HALF * s) + 2);
/** How far the can reaches below the garden's view at scale `s`: the wrapper adds this much room so nothing of it is cut. */
export const canBelow = (s: number) => REST.h * s - CAN_OVERLAP;
/** The can's seat (its body's centre) in the wrapper's frame (px from the garden view's top-left): bottom right, 4 px in. */
export const canHome = (width: number, viewH: number, s: number) => {
  "worklet";
  return { x: width - 4 - (REST.w - REST.ax) * s, y: viewH - CAN_OVERLAP + REST.ay * s };
};
/** The drops are drawn at the garden's scale (screen px per canvas px), which is the can's without R180's growth. */
export const dropSize = (s: number) => (s * 3) / CAN_GROW;
