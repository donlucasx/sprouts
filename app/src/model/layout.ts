import { BAKED_L, type Placed, type PlantId } from "./species";
import type { LendAsset } from "@/lib/coins";
import type { Scene } from "./garden";
import type { PlantOnStage } from "./scene-to-layout";   // a type only: no require cycle
import { SPRITE_META } from "@/garden/sprite-meta";   // boxes only, no require(): safe in node
import { appGround, soilBottomAt, GROUND, type GroundPlace } from "./soil-clip";

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
export const SLOT_X: Record<PlantId, number> = { skr: 0.34,   // R237 (10-04): SKR from 0.30, a nudge right
  ore: 0.8, hsol: 0.09, jitosol: 0.5, jupsol: 0.67, cbbtc: 0.92 };
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
 * drawn scale (signScale: 1.35 front, 1.08 back), so its half width (15 at 1x) grows with the board; `boardX` widens a lending board. */
export function signX(x: number, side: -1 | 1, width: number, scale: number, boardX = 1): number {
  const half = 15 * scale * boardX;
  return Math.min(Math.max(x + side * (half + SIGN_GAP), half + 1), width - half - 1);
}
/** R232 (10-04, "the JitoSOL stake should move left a bit as to not cover the sprout"; that stake is now USDC lending's): the board stands wholly beside its plant's
 * foot, its near edge SIGN_GAP px off it (gen06's 14 plus a fifth of the half width overlapped a young sprout). */
export const SIGN_GAP = 3;
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
/** The app's stake for a sign part, at the garden's width: its anchor, its drawn scale and its board's widening. */
/** R234: `zoom` is the frame's; the stake's drawn scale is signScale over it, so a stake keeps one size on screen while the plants zoom. */
/** `spots`: stakeSpots of the scene being drawn (a two-line stake's side and x after R327's flip and R326's clear-spot search);
 * absent, the scene's own side at signX. */
export function signPlacement(s: StakeOf, width: number, zoom = 1, ground: GroundPlace = appGround(width), spots?: Spots) {
  const { x, scale, boardX, side } = stakeAt(s, width, zoom, spots), g = ground;
  return { x, y: signStand(x, FOOT_Y(s.row) + 4, scale, (px) => soilBottomAt(px, g)), scale, boardX, side };
}
type StakeOf = { plant?: PlantId; x: number; side: -1 | 1; row: "front" | "back"; lines?: SignLines };
export type Spot = { side: -1 | 1; x: number | null };
export type Spots = ReadonlyMap<PlantId, Spot>;
/** A stake's x, drawn scale (stakeScale over the zoom), board widening and side: the one place every caller (signPlacement, frameAt,
 * the packing) reads them from. */
export function stakeAt(s: StakeOf, width: number, zoom: number, spots?: Spots) {
  const scale = stakeScale(s.row, s.lines) / zoom, boardX = boardXOf(s.lines), spot = s.plant ? spots?.get(s.plant) : undefined, side = spot?.side ?? s.side;
  return { x: spot?.x ?? signX(s.x * width, side, width, scale, boardX), scale, boardX, side };
}
/**
 * R327 (10-04, ruled; it narrows R237): a two-line (lending) back-row stake whose board would be covered takes the other side of its
 * plant, when that side is clear and its board fits inside the canvas unclamped; otherwise it keeps R237's side. "Covered" here: the
 * board overlaps a present front-row plant's trunk band (its foot x +/- STAKE_TRUNK canvas px) or another back-row stake's board.
 *
 * R326 (10-04, "adjust stake placement for legibility. careful w putting the sign over the leaves, as it may cover the early plant
 * sprout"): then, from that spot, the stake searches outward on both sides for the nearest x where its whole board face clears every
 * plant's drawn parts (front plants cover a board, R226; a board covers back plants and their sprouts, its own plant's included) and
 * every other stake's board, inside the canvas; never drawn over the front row. Its post stays its plant's: at most STAKE_WALK screen
 * px from where signX (after R327) puts it, and nearer its own foot than any other back-row foot. The two-line stakes are placed
 * together; with no clear x in reach they take the least covered (a front part over the words weighs STAKE_FRONT_W, a part under
 * the board 1), and a board never overlaps another while any placement avoids it. One-line stakes keep R237's side and signX.
 */
export const STAKE_TRUNK = 10;
/** R326: how far (screen px) a two-line stake may walk from its signX spot; the clearance (canvas px) kept from a drawn part. */
export const STAKE_WALK = 48, STAKE_CLEAR = 1.5;
/** R326: a front part over a board hides its words; one under it only hides a little plant: the search weighs the first 3 to 1. */
export const STAKE_FRONT_W = 3;
/** The angles the clearance holds a plant at: still and its steady sway either way (motion SWAY.deg; the gust is momentary). */
const STAKE_SWAY = [-5, 0, 5] as const;
/** Each drawn part's x span (canvas px) inside the vertical band [y0, y1], at PLANT_SCALE about its foot and at each STAKE_SWAY angle:
 * a sprite's baked box (a convex quad) or a stem's segment widened by its half width, clipped to the band. */
export function drawnSpans(plants: readonly PlantOnStage[], width: number, y0: number, y1: number, angles: readonly number[] = STAKE_SWAY): [number, number][] {
  const out: [number, number][] = [];
  for (const p of plants) {
    const fx = p.x * width, fy = FOOT_Y(p.row);
    for (const q of p.layout.parts) for (const deg of angles) {
      const a = (deg * Math.PI) / 180, pad = q.kind === "stem" ? (Math.max(q.w0, q.w1) * PLANT_SCALE) / 2 : 0;
      const pts = partCorners(q).map(([x, y]) => [fx + (x * Math.cos(a) - y * Math.sin(a)) * PLANT_SCALE, fy + (x * Math.sin(a) + y * Math.cos(a)) * PLANT_SCALE] as const);
      const xs: number[] = [], lo = y0 - pad, hi = y1 + pad;
      // a quad's corners come as (0,0) (w,0) (0,h) (w,h): walk them in ring order; a stem's two ends are one edge
      const ring = pts.length === 4 ? [pts[0], pts[1], pts[3], pts[2]] : pts;
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
        if (ay >= lo && ay <= hi) xs.push(ax);
        for (const yy of [lo, hi]) if ((ay - yy) * (by - yy) < 0) xs.push(ax + ((yy - ay) / (by - ay)) * (bx - ax));
      }
      if (xs.length) out.push([Math.min(...xs) - pad, Math.max(...xs) + pad]);
    }
  }
  return out;
}
const overlap = (lo: number, hi: number, spans: readonly (readonly [number, number])[]) =>
  spans.reduce((t, [l, h]) => t + Math.max(0, Math.min(hi, h) - Math.max(lo, l)), 0);
export function stakeSpots(scene: Scene, plants: readonly PlantOnStage[], width: number, zoom: number): Map<PlantId, Spot> {
  const signs = scene.parts.flatMap((q) => (q.kind === "sign" ? [q] : [])).sort((a, b) => a.x - b.x);
  const out = new Map<PlantId, Spot>(signs.map((q) => [q.plant, { side: q.side, x: null }]));
  const trunks = scene.parts.flatMap((q) => (q.kind === "plant" && q.row === "front" ? [q.x * width] : []));
  const board = (q: (typeof signs)[number], spot?: Spot) => { const a = stakeAt(q, width, zoom, spot ? new Map([[q.plant, spot]]) : out), h = 15 * a.scale * a.boardX; return [a.x - h, a.x + h] as const; };
  const others = (q: (typeof signs)[number]) => signs.filter((o) => o !== q && o.row === "back").map((o) => board(o));
  const covered = (q: (typeof signs)[number], [lo, hi]: readonly [number, number]) =>
    trunks.some((f) => f + STAKE_TRUNK > lo && f - STAKE_TRUNK < hi) || overlap(lo, hi, others(q)) > 0;
  const lend = signs.filter((q) => q.lines.line2 && q.row === "back");
  // R327: the flip, stake by stake from the left
  for (const q of lend) if (covered(q, board(q))) {
    const other = -q.side as -1 | 1, a = stakeAt(q, width, zoom), h = 15 * a.scale * a.boardX, c = q.x * width + other * (h + SIGN_GAP);
    if (c - h >= 1 && c + h <= width - 1 && !covered(q, board(q, { side: other, x: null }))) out.set(q.plant, { side: other, x: null });
  }
  if (lend.length === 0) return out;
  // R326: the two-line stakes' x together, each within STAKE_WALK of its spot and its post nearer its own foot than any other
  // back-row foot, minimising in turn: board over board (the one-line
  // stakes' and each other's), plant parts over or under a face (front parts weighted STAKE_FRONT_W), then the distance walked
  const fixed = signs.filter((o) => o.row === "back" && !lend.includes(o)).map((o) => board(o));
  const opts = lend.map((q) => {
    const a = stakeAt(q, width, zoom, out), h = 15 * a.scale * a.boardX, y = FOOT_Y(q.row) + 4, y0 = y - 12 * a.scale, y1 = y - a.scale;
    const front = drawnSpans(plants.filter((pl) => pl.row === "front"), width, y0, y1), back = drawnSpans(plants.filter((pl) => pl.row === "back"), width, y0, y1);
    const walk = STAKE_WALK / zoom, lo = Math.max(h + 1, a.x - walk), hi = Math.min(width - h - 1, a.x + walk);
    // its post stays its plant's: nearer its own foot than any other back-row foot (a plant's or a bare stake's)
    const own = q.x * width, feet = signs.filter((o) => o !== q && o.row === "back").map((o) => o.x * width);
    const mine = (c: number) => feet.every((f) => Math.abs(c - own) < Math.abs(c - f));
    const all = lo > hi ? [] : [...new Set([Math.min(Math.max(a.x, lo), hi), ...Array.from({ length: Math.floor(hi - lo) + 1 }, (_, i) => lo + i), hi])].filter(mine);
    const xs = all.length > 0 ? all : [a.x];
    return xs.map((c) => ({ c, h, plant: q.plant, foot: q.x * width, boards: overlap(c - h, c + h, fixed),
      parts: STAKE_FRONT_W * overlap(c - h - STAKE_CLEAR, c + h + STAKE_CLEAR, front) + overlap(c - h - STAKE_CLEAR, c + h + STAKE_CLEAR, back), walk: Math.abs(c - a.x) }));
  });
  type Opt = (typeof opts)[number][number];
  let best: Opt[] = [], bestCost = [Infinity, Infinity, Infinity];
  const less = (u: number[], v: number[]) => { for (let i = 0; i < u.length; i++) if (Math.abs(u[i] - v[i]) > 1e-9) return u[i] < v[i]; return false; };
  const pick = (i: number, chosen: Opt[], cost: number[]) => {
    if (cost[0] > bestCost[0] + 1e-9) return;
    if (i === opts.length) { if (less(cost, bestCost)) { best = [...chosen]; bestCost = cost; } return; }
    for (const o of opts[i]) {
      const pair = chosen.reduce((t, k) => t + Math.max(0, Math.min(o.c + o.h, k.c + k.h) - Math.max(o.c - o.h, k.c - k.h)), 0);
      pick(i + 1, [...chosen, o], [cost[0] + o.boards + pair, cost[1] + o.parts, cost[2] + o.walk]);
    }
  };
  pick(0, [], [0, 0, 0]);
  for (const o of best) out.set(o.plant, { side: o.c >= o.foot ? 1 : -1, x: o.c });
  return out;
}
/** R168 (10-02): the word on a stake, drawn as crisp type over the one blank baked board (`sign`), in the board's own frame: the anchor
 * at (0, 0) before the sign's scale (signScale: 1.35 front, 1.08 back), the board 30 by 11 from y -12 to -1, leaning -4 degrees (gen01_garden.py
 * sign()). 6.8 px was sized for the retired "JitoSOL" (3.62 em in Albert Sans Medium, 24.6 px, 2.7 px a side); today's longest one-line
 * label, "cbBTC", is narrower; the baseline at
 * -4.1 centres the 0.70 em capitals on the face (its centre at -6.5). */
export const SIGN_TEXT = { size: 6.8, y: -4.1, rot: -4 } as const;
/** The words: the ORE stake reads stORE (RG7); the lending plants read their asset (contracts 7.2). */
export const SIGN_LABEL: Record<PlantId, string> = { skr: "SKR", ore: "stORE", hsol: "hSOL", jitosol: "USDC", jupsol: "SOL", cbbtc: "cbBTC" };
export type SignLines = { line1: string; line2: string | null };
export type LendSignLines = Partial<Record<LendAsset, { line2: string } | null>>;
/**
 * R262 / contracts 7.2 (DECIDED 10-04, two lines): a lending stake reads its asset over "<Venue> <rate>%". Sizes from Albert Sans
 * Medium (fontTools, 10-04): the widest line two, "Kamino 12.5%" (6.311 em), is 31.6 px at 5.0, so the board is drawn 1.2x wide (36 px
 * face, 2 px a side); line one at 6.0 (capitals 4.2 px, top -11.1), line two at 5.0 (baseline -2.2, descender to -1.2).
 */
export const LEND_SIGN = { boardX: 1.2, size1: 6.0, y1: -6.9, size2: 5.0, y2: -2.2, max2: 13 } as const;
const LEND_OF: Partial<Record<PlantId, LendAsset>> = { jitosol: "USDC_LEND", jupsol: "SOL_LEND" };
export function signLabel(plant: PlantId, lend: LendSignLines | null | undefined): SignLines {
  const a = LEND_OF[plant];
  const raw = a ? lend?.[a]?.line2 : undefined;
  const line2 = raw ? raw.slice(0, LEND_SIGN.max2).trim() : "";
  return { line1: SIGN_LABEL[plant], line2: line2.length > 0 ? line2 : null };
}
/** A two-line stake's board is LEND_SIGN.boardX wide; every other board 1. */
export const boardXOf = (lines?: SignLines) => (lines?.line2 ? LEND_SIGN.boardX : 1);
/** Fix round 1 (R262, "legible on the phone"): a two-line stake is drawn LEND_STAKE_K times larger as a whole (its board's own geometry,
 * LEND_SIGN, unchanged): line two 7.3 canvas px in the back row (5.0 x 1.08 x 1.35), line one 8.7. The review proposed 1.5; at 1.5 the
 * SOL stake's board and cbBTC's overlap by up to 23 px at 320 wide (the reviewer's fallback, 1.35, still overlaps them by up to 24 px in
 * a packed six-coin garden, and by 4 px even at 1.0: the SOL to cbBTC gap is 80 px at 320; see the report's fix round 1). */
export const LEND_STAKE_K = 1.35;
/** A stake's drawn scale at zoom 1: signScale, times LEND_STAKE_K for a two-line stake. */
export const stakeScale = (row: "front" | "back", lines?: SignLines) => signScale(row) * (lines?.line2 ? LEND_STAKE_K : 1);
/** RG30 (10-02): the garden frames what is planted; 2x is the cap the 3x bakes hold; Garden.tsx eases each change over easeMs.
 * R167 (10-02): the view's HEIGHT follows the content, never shorter than the ground band plus `aboveGround`. */
export const FRAME = { maxZoom: 2, footInset: 0.12, pad: 20, easeMs: 1200, aboveGround: 40 } as const;   // R231: pad from 16, the 1.3x front row's sway
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
const groundH = () => (SPRITE_META["ground"]?.h ?? 86) * GROUND.sy;   // R231: drawn GROUND.sy deep
/** I4 fix round 5: the view's height cap on screen (it was the bed's 260 before R185's headroom). */
export const MAX_VIEW_H = 380;   // R231: from 320, for the deeper ground
/** RG30: the box (canvas px) around the present plants: each foot, its sideways reach and its height above the foot, and its own
 * sign; padded 16 at the sides; the bottom the bed's. The zoom fits that box's breadth (capped at 2) and its CONTENT height (the tallest
 * part down to the bed's bottom) in the bed's 260, never the headroom: R185's room to grow never shrinks the plants (I4 fix round 5).
 * The view then grows upward by the headroom, max(72 px on screen, 60 percent of the content), and its height is capped at MAX_VIEW_H
 * (the headroom gives way first); frame.y goes above the canvas's top (negative) when the headroom reaches past it, the paper showing
 * there. The frame is centred on the box's breadth and clamped inside the bed. R167: the view's height floors at the soil band plus 40
 * and always holds the whole ground sprite; only the empty top is cropped, so the ground and the grain keep their anchor on the soil
 * line. Bare signs and seeds do not widen it, except a bare stake the frame would cut (fix round 1, below); with no plant it is the whole breadth at the floor. `room` is the headroom rule (tests
 * pass none to show the zoom does not depend on it). */
export function frameFor(scene: Scene, plants: PlantOnStage[], width: number, room: { share: number; minPx: number } = HEADROOM): Frame {
  // R234: the stakes keep one size on screen (signScale over the zoom), so the box depends on the zoom it sets: three passes settle it
  // Fix round 1 (minor 3, the mock's cbBTC stake cut at the screen's edge): a bare stake (a share, no plant yet) still does not widen
  // the frame, unless part of it shows: the view draws SIDE_GUTTER past the frame's sides (the plants' spill), so a stake reaching into
  // that band was cut by the screen's edge. Then the frame takes all of it. One wholly past the band stays out (RG30's day 1 zoom)
  const bare = new Set<PlantId>(), present = new Set(plants.map((p) => p.plant));
  let f = frameAt(scene, plants, width, room, 1, bare);
  for (let i = 0; i < 3; i++) f = frameAt(scene, plants, width, room, f.zoom, bare);
  for (let j = 0; j < 3; j++) {
    let grew = false;
    for (const q of scene.parts) if (q.kind === "sign" && !present.has(q.plant) && !bare.has(q.plant)) {
      const a = stakeAt(q, width, f.zoom, stakeSpots(scene, plants, width, f.zoom)), h = 15 * a.scale * a.boardX, lo = a.x - h, hi = a.x + h, g = SIDE_GUTTER / f.zoom;
      if (hi > f.x - g && lo < f.x + f.w + g && (lo < f.x || hi > f.x + f.w)) { bare.add(q.plant); grew = true; }
    }
    if (!grew) break;
    for (let i = 0; i < 3; i++) f = frameAt(scene, plants, width, room, f.zoom, bare);
  }
  return f;
}
function frameAt(scene: Scene, plants: PlantOnStage[], width: number, room: { share: number; minPx: number }, signZoom: number, bare: ReadonlySet<PlantId>): Frame {
  const floor = Math.max(MIN_VIEW_H, groundH());
  if (plants.length === 0) return { x: 0, y: CANVAS.height - floor, w: width, h: floor, zoom: 1, viewH: floor };
  const signs = new Map(scene.parts.flatMap((q) => (q.kind === "sign" ? [[q.plant, q] as const] : [])));
  let x0 = width, x1 = 0, y0: number = CANVAS.height;
  for (const p of plants) {
    const fx = p.x * width, reach = Math.max(0, ...p.layout.parts.map(sideReach));
    x0 = Math.min(x0, fx - reach); x1 = Math.max(x1, fx + reach); y0 = Math.min(y0, FOOT_Y(p.row) - p.layout.top);
  }
  // each present plant's stake, and the bare stakes frameFor found the frame cutting (fix round 1)
  const spots = stakeSpots(scene, plants, width, signZoom), stakes = [...signs.values()].filter((s) => bare.has(s.plant) || plants.some((p) => p.plant === s.plant)).map((s) => stakeAt(s, width, signZoom, spots));
  for (const a of stakes) { const h = 15 * a.scale * a.boardX; x0 = Math.min(x0, a.x - h); x1 = Math.max(x1, a.x + h); }
  x0 -= FRAME.pad; x1 += FRAME.pad;
  // R242 (10-04, "hsol and cbBTC plants are on the very edge- they should be sitting within/on the soil"): the ground spans the frame
  // (R238) and R241's mound thins toward its ends, so every foot and stake post keeps FRAME.footInset of the frame's breadth from either
  // side, where the mound is full: the box widens about the feet when it must
  const feet = [...plants.map((p) => p.x * width), ...stakes.map((a) => a.x)];
  const f0 = Math.min(...feet), f1 = Math.max(...feet), need = (f1 - f0) / (1 - 2 * FRAME.footInset);
  if (f0 - x0 < FRAME.footInset * need) x0 = f0 - FRAME.footInset * Math.max(need, x1 - x0);
  if (x1 - f1 < FRAME.footInset * need) x1 = f1 + FRAME.footInset * Math.max(need, x1 - x0);
  x0 = Math.max(0, x0); x1 = Math.min(width, x1);
  const content = CANVAS.height - Math.max(0, y0);
  const zoom0 = Math.min(FRAME.maxZoom, width / (x1 - x0), CANVAS.height / content);
  const { zoom, x } = gutterFit(zoom0, (x0 + x1) / 2, windSpan(plants, width), width);
  // R291 (10-04, his note on a lone SKR: "plus a bit too much negative space above it"): the share is of the content as a zoom-1 garden
  // shows it, so a garden zoomed in on a few plants no longer multiplies its paper above them by the zoom (a lone plant at 2x had twice
  // a full garden's room); gardens at zoom 1 or under are unchanged
  const headroom = Math.max((room.share * content) / Math.max(1, zoom), room.minPx / zoom);   // canvas px
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
/** R357: the paper over the garden's tallest drawn part (each plant drawn PLANT_SCALE about its foot), in view px from the view's top. */
export function skyAbove(plants: readonly PlantOnStage[], frame: { y: number; zoom: number }): number {
  const top = Math.min(CANVAS.height, ...plants.map((p) => FOOT_Y(p.row) - p.layout.top * PLANT_SCALE));
  return Math.max(0, (top - frame.y) * frame.zoom);
}
/** R356 then R357 (10-05, "tighten the gap ... a bit", then "by another half"): how far Home pulls the garden up under its value
 * block, in dp: the screen's gap (Screen's spacing.lg, 16) plus as much of the garden's sky as lies past SKY_KEEP, at most 40, so the
 * tallest part always keeps SKY_KEEP of paper under the block (a tall garden whose headroom gave way to MAX_VIEW_H is pulled less). */
export const SKY_KEEP = 32;
export const valuePull = (sky: number) => 16 + Math.min(40, Math.max(0, sky - SKY_KEEP));
