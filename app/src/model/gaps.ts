import type { Part, PlantId, Scene } from "./garden";
import { plantLayouts, type PlantOnStage } from "./scene-to-layout";
import { FOOT_Y, FRAME, PLANT_SCALE, frameFor, signX, stakeScale, boardXOf } from "./layout";
import { SPRITE_META } from "@/garden/sprite-meta";

/**
 * R357 (10-05, his ruling "Back plants move to the gaps"; amends G6's locked back-row slots): a back-row plant AND its stake slide
 * together along the back row to open space between the front plants' canopies, so the plant and its sign are both seen and seen
 * together. Each back-row occupant (a plant with its stake, or a bare stake) takes the nearest x to its slot, on a GAP_STEP grid, whose
 * board (at its usual offset beside its own stem, R237's side or the other) no front plant part covers, ranked in order:
 *   1. its board over another back-row board or stem, or the back row out of its order (never: they stay apart and in order);
 *   2. a clear board (no front part over it) inside the frame, the nearest to its slot; else a clear board past the frame whose
 *      widening leaves the garden at least GAP_ZOOM of its zoom, the nearest; else the words' cover in GAP_GRAIN grains plus a grain
 *      for each GAP_WALK px walked (the least covered near its own place);
 * Candidates run along the whole row: between the front canopies and past either outer one (the coordinator's reading of R357).
 *   4. front parts over its own stem's foot (a back plant not standing straight behind a front one), in grains;
 *   5. the distance from its slot, then R237's side before the other.
 * Measured on the scene with every bud open (R247: a watering never moves a slot), with the parts' baked boxes held still (a sway is
 * momentary). The grid keeps a slot still while a front canopy grows past nearby sizes: it moves only once its spot is covered.
 * Part order is kept (the opening plans index the parts).
 */
export const GAP_STEP = 4;
/** The room kept between a board and a front part, or another back-row board or stem (canvas px). */
export const GAP_CLEAR = 1.5;
/** How close another back-row stem may come to a stem (canvas px). */
export const GAP_STEMS = 14;
/** Cover is counted in grains of this many canvas px, so a canopy growing a little does not move a plant to a spot a hair less covered. */
export const GAP_GRAIN = 12;
/** With no clear spot, a plant walks GAP_WALK canvas px from its slot for each grain of its words it uncovers (a sign kept by its
 * plant's place in the composition over one a little clearer far away). */
export const GAP_WALK = 8;
/** The coordinator's reading of R357 (option 3): a clear spot past the frame may widen it, the garden zooming out to no less than
 * GAP_ZOOM of its zoom before the move. */
export const GAP_ZOOM = 0.85;

type Box = { x0: number; x1: number; y0: number; y1: number };
/** Each part's still box (canvas px, at PLANT_SCALE about its foot); a stem's ends padded by its half width. */
export function partBoxes(p: PlantOnStage, width: number): Box[] {
  const fx = p.x * width, fy = FOOT_Y(p.row), at = (x: number, y: number) => [fx + x * PLANT_SCALE, fy + y * PLANT_SCALE] as const;
  const out: Box[] = [];
  for (const q of p.layout.parts) {
    let pts: (readonly [number, number])[], pad = 0;
    if (q.kind === "stem") { pts = [at(q.x0, q.y0), at(q.x1, q.y1)]; pad = (Math.max(q.w0, q.w1) * PLANT_SCALE) / 2; }
    else {
      const m = SPRITE_META[q.name]; if (!m) continue;
      const r = (q.rot * Math.PI) / 180, sx = q.xScale ?? q.scale, sy = q.scale;
      pts = [[0, 0], [m.w, 0], [0, m.h], [m.w, m.h]].map(([u, v]) => { const lx = (u - m.ax) * sx, ly = (v - m.ay) * sy; return at(q.x + lx * Math.cos(r) - ly * Math.sin(r), q.y + lx * Math.sin(r) + ly * Math.cos(r)); });
    }
    const xs = pts.map((t) => t[0]), ys = pts.map((t) => t[1]);
    out.push({ x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad });
  }
  return out;
}
/** How much of [lo, hi] the boxes crossing the band [y0, y1] cover (the union of their x overlaps). */
export function coverOf(lo: number, hi: number, y0: number, y1: number, boxes: readonly Box[]): number {
  const xs = boxes.filter((q) => q.y0 < y1 && q.y1 > y0 && q.x0 < hi && q.x1 > lo).map((q) => [Math.max(q.x0, lo), Math.min(q.x1, hi)] as const).sort((u, v) => u[0] - v[0]);
  let t = 0, end = -Infinity;
  for (const [l, h] of xs) if (h > end) { t += h - Math.max(l, end); end = h; }
  return t;
}
/** A back-row stake's board where it stands beside a stem at `x` on `side` (canvas px), at the frame's zoom. */
export function boardAt(s: Extract<Part, { kind: "sign" }>, x: number, side: -1 | 1, width: number, zoom: number): Box {
  const scale = stakeScale(s.row, s.lines) / zoom, bx = boardXOf(s.lines), h = 15 * scale * bx, c = signX(x, side, width, scale, bx), y = FOOT_Y(s.row) + 4;
  return { x0: c - h, x1: c + h, y0: y - 12 * scale, y1: y - scale };
}

const opened = (scene: Scene): Scene => ({ ...scene, parts: scene.parts.map((q): Part => (q.kind === "sprout" && q.bud ? { ...q, bud: false } : q)) });
const less = (u: number[], v: number[]) => { for (let i = 0; i < u.length; i++) if (Math.abs(u[i] - v[i]) > 1e-9) return u[i] < v[i]; return false; };

type FrameBox = { x: number; w: number; zoom: number };
function placeOnce(scene: Scene, width: number, f: FrameBox, z0: number): Scene {
  const L = plantLayouts(opened(scene));
  const front = L.filter((p) => p.row === "front").flatMap((p) => partBoxes(p, width));
  const back = scene.parts.flatMap((q) => (q.kind === "sign" && q.row === "back" ? [q] : [])).sort((a, b) => a.x - b.x);
  if (back.length === 0 || front.length === 0) return scene;
  const placed: { plant: PlantId; foot: number; board: Box }[] = [], moves = new Map<PlantId, { x: number; side: -1 | 1 }>();
  for (const s of back) {
    const slot = s.x * width;
    const stemY0 = FOOT_Y("back") - 12, stemY1 = FOOT_Y("back");
    let best: { cost: number[]; x: number; side: -1 | 1 } | null = null;
    const reach = Math.ceil(width / GAP_STEP);   // the whole row: between the front canopies and past either outer one
    for (let k = -reach; k <= reach; k++) {
      const x = slot + k * GAP_STEP;
      if (x < 1 || x > width - 1) continue;
      for (const side of [s.side, -s.side as -1 | 1]) {
        const b = boardAt(s, x, side, width, f.zoom);
        if (b.x0 < 0 || b.x1 > width) continue;
        const clash = placed.reduce((t, o) => t + Math.max(0, Math.min(b.x1, o.board.x1) + GAP_CLEAR - Math.max(b.x0, o.board.x0))
          + (Math.abs(x - o.foot) < GAP_STEMS ? GAP_STEMS - Math.abs(x - o.foot) : 0)
          + Math.max(0, Math.min(b.x1 + GAP_CLEAR, o.foot + 3) - Math.max(b.x0 - GAP_CLEAR, o.foot - 3))
          + Math.max(0, Math.min(o.board.x1 + GAP_CLEAR, x + 3) - Math.max(o.board.x0 - GAP_CLEAR, x - 3)), 0);
        const words = coverOf(b.x0 - GAP_CLEAR, b.x1 + GAP_CLEAR, b.y0, b.y1, front);
        const stem = coverOf(x - 3, x + 3, stemY0, stemY1, front);
        // past the frame the frame widens about the board (FRAME.pad each side): the zoom it would leave, estimated
        const lo = Math.min(f.x, b.x0 - FRAME.pad), hi = Math.max(f.x + f.w, b.x1 + FRAME.pad), zoomed = f.zoom * Math.min(1, f.w / (hi - lo));
        const tier = words > 0 ? 2 : b.x0 >= f.x && b.x1 <= f.x + f.w ? 0 : zoomed >= GAP_ZOOM * z0 - 1e-9 ? 1 : 2;
        const order = placed.some((o) => o.foot >= x) ? 1 : 0;   // the back row keeps its order (left to right as its slots)
        const grains = Math.ceil(words / GAP_GRAIN - 1e-9), far = Math.abs(x - slot);
        const cost = [clash + order, tier, tier === 2 ? grains + far / GAP_WALK : far, Math.ceil(stem / GAP_GRAIN - 1e-9), far, side === s.side ? 0 : 1];
        if (!best || less(cost, best.cost)) best = { cost, x, side };
      }
    }
    if (!best) continue;
    placed.push({ plant: s.plant, foot: best.x, board: boardAt(s, best.x, best.side, width, f.zoom) });
    if (Math.abs(best.x - slot) > 1e-9 || best.side !== s.side) moves.set(s.plant, { x: best.x / width, side: best.side });
  }
  if (moves.size === 0) return scene;
  return { ...scene, parts: scene.parts.map((q): Part => {
    if ((q.kind === "plant" || q.kind === "sign") && moves.has(q.plant)) {
      const m = moves.get(q.plant)!;
      return q.kind === "sign" ? { ...q, x: m.x, side: m.side } : { ...q, x: m.x };
    }
    return q;
  }) };
}

/** R357: the back row moved into the front canopies' gaps. The boards' size follows the frame's zoom, and the frame follows the moved
 * garden: a second pass measures at the first pass's frame when its zoom differs. */
export function gapScene(scene: Scene, width: number): Scene {
  const f0 = frameFor(scene, plantLayouts(scene), width), once = placeOnce(scene, width, f0, f0.zoom);
  if (once === scene) return scene;
  const f1 = frameFor(once, plantLayouts(once), width);
  return Math.abs(f1.zoom - f0.zoom) < 1e-6 ? once : placeOnce(scene, width, f1, f0.zoom);
}
