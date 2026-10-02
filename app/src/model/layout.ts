import type { PlantId } from "./species";

/** Spec 5: the canvas is the screen width minus 40 by 260; the soil line at 200; the back row's feet at 214 and the front's at 244. */
export const CANVAS = { height: 260, soilLine: 200, backFeet: 214, frontFeet: 244, backScale: 0.8 } as const;
export const ROW_OF: Record<PlantId, "front" | "back"> = { skr: "front", ore: "front", hsol: "back", jitosol: "back", jupsol: "back", cbbtc: "back" };
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
/** gen06:72-74: 14 px from the foot plus a fifth of the sign's half width, clamped a pixel inside the canvas. `scale` is 1 or 0.8. */
export function signX(x: number, side: -1 | 1, width: number, scale: number): number {
  const half = 15 * scale;
  return Math.min(Math.max(x + side * (14 + half * 0.2), half + 1), width - half - 1);
}
