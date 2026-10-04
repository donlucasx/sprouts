import type { Part, PlantId, Scene } from "./garden";
import { plantLayouts } from "./scene-to-layout";
import { frameFor, signScale, windSpan, SIGN_GAP } from "./layout";

/**
 * R234 (10-04, his ruling, "Adaptive spacing"): while the plants are small the garden packs them together, so RG30's frame can zoom in
 * on them (2x cap); as they grow the gaps open back out to RG17's locked composition, and never past it.
 *
 * Each occupant (a plant and its stake) takes the room it needs: its plant's reach in the wind (R187's 1.25x, the gust's 12 degrees)
 * and its stake at the stake's screen size (R234: the stakes keep one size while the plants zoom). Walking the occupants left to right
 * in the composition's order, each one stands as close to the one before as the composition allows (each gap at least SPREAD.share of
 * its locked width, so the picture keeps its rhythm) while clearing, by SPREAD.margin, every earlier occupant of ITS row (the rows
 * pass in front of each other); and never farther than its locked gap. Measured at the 320 reference width (a wider screen only has more
 * room), then centred on the composition's middle. The stakes' size depends on the zoom the packing allows, so two passes settle it.
 */
/** R235 (10-04, "split the difference in size from before to now"): the drawn garden's zoom is `take` of the way from the locked
 * composition's zoom to the fully packed one's (0.5: halfway). */
export const SPREAD = { share: 0.3, margin: 4, ref: 320, passes: 2, take: 0.5 } as const;

/** R247 (10-04, the glitch before the rings): the packing is measured on the scene with every bud open, so a watering that opens buds
 * never moves a slot (it did: an opened plant reaches farther and the packing jumped as the buds opened). */
const opened = (scene: Scene): Scene => ({ ...scene, parts: scene.parts.map((q): Part => (q.kind === "sprout" && q.bud ? { ...q, bud: false } : q)) });

type Occ = { plant: PlantId; row: "front" | "back"; x: number; lo: number; hi: number };

/** Each occupant's reach from its foot (canvas px at `width`): its plant in the wind and its stake at `zoom`. */
function occupants(scene: Scene, width: number, zoom: number): Occ[] {
  const L = plantLayouts(opened(scene)), out: Occ[] = [];
  for (const q of scene.parts) if (q.kind === "sign") {
    const foot = q.x * width, half = (15 * signScale(q.row)) / zoom, mid = q.side * (half + SIGN_GAP);
    let lo = mid - half, hi = mid + half;
    const p = L.find((l) => l.plant === q.plant);
    if (p) { const w = windSpan([p], width); lo = Math.min(lo, w.lo - foot); hi = Math.max(hi, w.hi - foot); }
    out.push({ plant: q.plant, row: q.row, x: q.x, lo, hi });
  }
  return out.sort((a, b) => a.x - b.x);
}

/** The packed slots (fractions of the width) for one zoom; null when packing gains nothing. */
function packAt(scene: Scene, width: number, zoom: number): Map<PlantId, number> | null {
  const occ = occupants(scene, width, zoom);
  if (occ.length < 2) return null;
  const pos: number[] = [];
  occ.forEach((o, k) => {
    if (k === 0) { pos.push(o.x * width); return; }
    const gap = (o.x - occ[k - 1].x) * width;
    let need = pos[k - 1] + SPREAD.share * gap;
    for (let j = 0; j < k; j++) if (occ[j].row === o.row) need = Math.max(need, pos[j] + occ[j].hi - o.lo + SPREAD.margin);
    pos.push(Math.min(pos[k - 1] + gap, need));
  });
  const span0 = (occ[occ.length - 1].x - occ[0].x) * width, span = pos[pos.length - 1] - pos[0];
  if (span >= span0 - 0.5) return null;
  const shift = ((occ[0].x + occ[occ.length - 1].x) / 2) * width - (pos[0] + pos[pos.length - 1]) / 2;
  return new Map(occ.map((o, k) => [o.plant, (pos[k] + shift) / width]));
}

/** The scene with every plant and stake on its packed slot (part order kept: the opening plans index the parts). */
const zoomOf = (scene: Scene, width: number) => frameFor(scene, plantLayouts(scene), width).zoom;
/** Each plant and stake moved `t` of the way from its locked slot to `slots`. */
const moved = (scene: Scene, slots: Map<PlantId, number>, t: number): Scene =>
  ({ ...scene, parts: scene.parts.map((q): Part => ((q.kind === "plant" || q.kind === "sign") && slots.has(q.plant) ? { ...q, x: q.x + (slots.get(q.plant)! - q.x) * t } : q)) });
export function packScene(scene: Scene, width: number = SPREAD.ref): Scene {
  const z0 = zoomOf(opened(scene), width);
  let zoom = z0, slots: Map<PlantId, number> | null = null;
  for (let i = 0; i < SPREAD.passes; i++) {
    const next = packAt(scene, width, zoom);
    if (!next) break;
    slots = next; zoom = zoomOf(opened(moved(scene, slots, 1)), width);
  }
  if (!slots || zoom <= z0) return scene;
  // R235: the zoom a share t of the way gives is about the width over a span linear in t, so t for the zoom `take` of the way is
  // (1/zT - 1/z0) / (1/zf - 1/z0)
  const zT = z0 + (zoom - z0) * SPREAD.take, t = Math.min(1, Math.max(0, (1 / zT - 1 / z0) / (1 / zoom - 1 / z0)));
  return moved(scene, slots, t);
}

/** True when no plant or stake reaches into another coin's in the same row (the packing's promise; tests hold it). */
export function clearIn(scene: Scene, width: number = SPREAD.ref): boolean {
  const zoom = frameFor(scene, plantLayouts(scene), width).zoom, occ = occupants(scene, width, zoom);
  for (let i = 0; i < occ.length; i++) for (let j = i + 1; j < occ.length; j++) {
    const a = occ[i], b = occ[j];
    if (a.row === b.row && a.x * width + a.hi + SPREAD.margin - 1e-6 > b.x * width + b.lo) return false;
  }
  return true;
}
