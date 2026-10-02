import { BAKED_L, type Placed, type PlantId } from "./species";
import type { Scene } from "./garden";
import type { PlantOnStage } from "./scene-to-layout";   // a type only: no require cycle

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
/** RG30 (10-02): the garden frames what is planted; 2x is the cap the 3x bakes hold; Garden.tsx eases each change over easeMs. */
export const FRAME = { maxZoom: 2, pad: 16, easeMs: 1200 } as const;
export type Frame = { x: number; y: number; w: number; h: number; zoom: number };
/** How far a part reaches sideways from its plant's foot, a safe bound as `topOf` takes it: a leaf-like sprite its baked length times
 * its scale whatever its rotation; the head 17.6 scale; a swelling or dot its radius; the rest 8 scale; a stem its farther end. */
const sideReach = (q: Placed) => {
  if (q.kind === "stem") return Math.max(Math.abs(q.x0), Math.abs(q.x1));
  const base = BAKED_L[q.name.replace(/-s\d$/, "").replace(/-\d$/, "")];
  const len = base ? base[Number(q.name.match(/-s(\d)$/)?.[1] ?? 0)] * q.scale : q.part === "head" ? 17.6 * q.scale : q.part === "swelling" || q.part === "dot" ? q.scale : 8 * q.scale;
  return Math.abs(q.x) + len;
};
/** RG30: the viewBox (canvas px) around the present plants: each foot, its sideways reach and its height above the foot, and its own
 * sign; padded 16; the bottom the bed's. The zoom fits that box, capped at 2; the frame is centred on the box and clamped inside the
 * bed. Bare signs and seeds do not widen it; with no plant it is the whole bed. */
export function frameFor(scene: Scene, plants: PlantOnStage[], width: number): Frame {
  if (plants.length === 0) return { x: 0, y: 0, w: width, h: CANVAS.height, zoom: 1 };
  const signs = new Map(scene.parts.flatMap((q) => (q.kind === "sign" ? [[q.plant, q] as const] : [])));
  let x0 = width, x1 = 0, y0: number = CANVAS.height;
  for (const p of plants) {
    const fx = p.x * width, reach = Math.max(0, ...p.layout.parts.map(sideReach));
    x0 = Math.min(x0, fx - reach); x1 = Math.max(x1, fx + reach); y0 = Math.min(y0, FOOT_Y(p.row) - p.layout.top);
    const s = signs.get(p.plant);
    if (s) { const sc = s.row === "front" ? 1 : CANVAS.backScale, sx = signX(s.x * width, s.side, width, sc); x0 = Math.min(x0, sx - 15 * sc); x1 = Math.max(x1, sx + 15 * sc); }
  }
  x0 = Math.max(0, x0 - FRAME.pad); x1 = Math.min(width, x1 + FRAME.pad); y0 = Math.max(0, y0 - FRAME.pad);
  const zoom = Math.min(FRAME.maxZoom, width / (x1 - x0), CANVAS.height / (CANVAS.height - y0));
  const w = width / zoom, h = CANVAS.height / zoom;
  const x = Math.min(Math.max((x0 + x1) / 2 - w / 2, 0), width - w), y = Math.min(Math.max((y0 + CANVAS.height) / 2 - h / 2, 0), CANVAS.height - h);
  return { x, y, w, h, zoom };
}
