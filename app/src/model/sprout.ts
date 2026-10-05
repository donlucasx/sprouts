// R351 (10-05, approved on the draft: "new art looks good"; brand/garden/gen13_sprout.py, screens/r351-NOTES.md): the mandarin's
// closed shoot is the twig it will become, folded. No new art: the nub is the twig's own painted stem cut to NUB of its length about
// its node, and the furled pair is the twig's own two leaf sprites turned in to +-FURL_ROT, shortened to FURL_S and narrowed to FURL_X,
// their axis leaning FURL_LEAN of the way to upright. Watering eases every number to the open twig's (one motion, no crossfade), so
// the last frame IS the static leaf pair and the garden's settle has nothing to swap. Pure and dependency-free; the functions marked
// "worklet" also run on the UI thread (Plant's Unfurl player).
import type { Placed, PlantLayout } from "./species";

type Stem = Extract<Placed, { kind: "stem" }>;
type Sprite = Extract<Placed, { kind: "sprite" }>;

export const NUB = 0.28;        // the nub: 28% of the twig's stem
export const FURL_ROT = 8;      // each leaf +-8 degrees off the pair's axis
export const FURL_S = 0.74;     // furled at 74% of the open length ...
export const FURL_X = 0.62;     // ... and folded to 62% of the width
export const FURL_LEAN = 0.6;   // the closed pair's axis at 0.6 of the twig's angle (more upright), turning out to 1.0
export const FAN = 38;          // the open pair: gen03_garden.py:80 (common.ts twig's 2-blade fan)
/** His #4 on the draft ("should be slow enough so the user can appreciate it"; the windows are Claude's call): the stem grows over the
 * first 40% of the unfurl, the pair opens from 25% to the end, overlapping it, so it reads as one motion. */
export const UNFURL_STEM = [0, 0.4] as const;
export const UNFURL_PAIR = [0.25, 1] as const;
/** A soft ease-in-out (cubic-bezier .45 .05 .35 1): each phase starts gently and settles, so the slow unfurl never snaps. */
const EASE = [0.45, 0.05, 0.35, 1] as const;

function bezierY(t: number): number {
  "worklet";
  const x1 = EASE[0], y1 = EASE[1], x2 = EASE[2], y2 = EASE[3];
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let lo = 0, hi = 1, m = t;
  for (let i = 0; i < 30; i++) {
    m = (lo + hi) / 2;
    const x = 3 * (1 - m) * (1 - m) * m * x1 + 3 * (1 - m) * m * m * x2 + m * m * m;
    if (x < t) lo = m; else hi = m;
  }
  m = (lo + hi) / 2;
  return 3 * (1 - m) * (1 - m) * m * y1 + 3 * (1 - m) * m * m * y2 + m * m * m;
}
const phase = (u: number, a: number, b: number) => {
  "worklet";
  return bezierY(Math.min(1, Math.max(0, (u - a) / (b - a))));
};
const lerp = (a: number, b: number, t: number) => {
  "worklet";
  return t >= 1 ? b : a + (b - a) * t;   // exact at the end: the last frame must equal the static twig
};

export type SproutState = { stem: number; rot: number; scale: number; xs: number; lean: number };
/** u 0 closed .. 1 the open twig (gen13_sprout.py sprout_state, with R351's windows and easing). */
export function sproutState(u: number): SproutState {
  "worklet";
  const s = phase(u, UNFURL_STEM[0], UNFURL_STEM[1]), p = phase(u, UNFURL_PAIR[0], UNFURL_PAIR[1]);
  return { stem: lerp(NUB, 1, s), rot: lerp(FURL_ROT, FAN, p), scale: lerp(FURL_S, 1, p), xs: lerp(FURL_X, 1, p), lean: lerp(FURL_LEAN, 1, p) };
}
/** A stem's direction in degrees from straight up, SVG sense (common.ts twig: ex = x + sin(ang) len, ey = y - cos(ang) len). */
export const twigAxis = (s: { x0: number; y0: number; x1: number; y1: number }) => (Math.atan2(s.x1 - s.x0, -(s.y1 - s.y0)) * 180) / Math.PI;

/** One leaf of the pair at progress u, from its open placement on a twig whose stem runs (x0, y0) to the open tip at axis `ang`:
 * position on the stem at the state's fraction, rotation, scale and x scale. Shared by the static closed shoot (u = 0), the frame
 * strips and the Unfurl player (as a view transform). At u = 1 it returns the open values exactly. */
export function leafAt(leaf: { x: number; y: number; rot: number; scale: number; xScale?: number }, x0: number, y0: number, ang: number, st: SproutState) {
  "worklet";
  const off = leaf.rot - ang, xs0 = leaf.xScale ?? leaf.scale;
  if (st.stem === 1 && st.rot === FAN && st.scale === 1 && st.xs === 1 && st.lean === 1) return { x: leaf.x, y: leaf.y, rot: leaf.rot, scale: leaf.scale, xScale: xs0 };
  return {
    x: x0 + (leaf.x - x0) * st.stem,
    y: y0 + (leaf.y - y0) * st.stem,
    rot: ang * st.lean + (off / FAN) * st.rot,
    scale: leaf.scale * st.scale,
    xScale: xs0 * st.scale * st.xs,
  };
}

/** The open twig's parts (one stem, two leaves: an open pair) or null when the shoot's parts are anything else. */
export function pairOf(parts: Placed[]): { stem: Stem; leaves: [Sprite, Sprite] } | null {
  const stems = parts.filter((p): p is Stem => p.kind === "stem"), leaves = parts.filter((p): p is Sprite => p.kind === "sprite" && p.part === "leaf");
  if (stems.length !== 1 || stems[0].part !== "twig" || leaves.length !== 2 || parts.length !== 3) return null;
  return { stem: stems[0], leaves: [leaves[0], leaves[1]] };
}

/** An open twig's parts (stem + pair) drawn at progress u, in the same order. At u = 0 they are the closed sprout, tagged `nub` and
 * `furl` (what the geometry places for a closed mandarin shoot); at u = 1 they are the parts given, unchanged. */
export function unfurlParts(parts: Placed[], u: number): Placed[] {
  const pair = pairOf(parts); if (!pair) return parts;
  if (u >= 1) return parts;
  const st = sproutState(u), s = pair.stem, ang = twigAxis(s), closed = u <= 0;
  return parts.map((q): Placed => {
    if (q.kind === "stem") return { ...q, x1: s.x0 + (s.x1 - s.x0) * st.stem, y1: s.y0 + (s.y1 - s.y0) * st.stem, ...(closed ? { part: "nub" as const } : {}) };
    const l = leafAt(q, s.x0, s.y0, ang, st);
    return { ...q, x: l.x, y: l.y, rot: l.rot, scale: l.scale, xScale: l.xScale, ...(closed ? { part: "furl" as const } : {}) };
  });
}
/** A whole layout with one shoot's twig at unfurl progress u (the frame strips; tests). */
export function unfurlLayout(layout: Pick<PlantLayout, "parts">, shoot: string, u: number): Placed[] {
  const mine = layout.parts.filter((p) => p.shoot === shoot), at = unfurlParts(mine, u);
  let k = 0;
  return layout.parts.map((p) => (p.shoot === shoot ? at[k++] : p));
}
/** A closed shoot's part: a bud sprite (the other five species), or the mandarin sprout's nub and furled leaves. */
export const isClosedPart = (q: Placed) => q.part === "bud" || q.part === "nub" || q.part === "furl";
