// R200 (device check 2, his note 4: "wind should be visible ... as natural and realistic as possible (motion wise)"; his ruling:
// "painted with curls, watercolor style, subtle and animated"): the timing and the path of the painted wind curls, as plain numbers.
// Every function the UI thread calls is a worklet (Wind.tsx reads them inside animated styles); dependency-free, so tests run in node.
//
// How a gust looks: R189's gust (motion.ts GUST) rolls left to right every 8 to 15 s; the moment it starts, the wind's own clock
// starts too and runs WIND.spanMs. Two or three curls ride it: each lands softly at the garden's left, drifts right (fast at first,
// easing as the gust spends itself, a little lift and a slow bob as it goes), and fades out as the gust passes the last plant. Between
// gusts the sky is empty; under reduced motion there are no curls at all. Each gust draws its own curls from a seed (the gust's
// count), so no two gusts repeat: which painted curl, its size, its height, its speed and its start all vary.
import { GUST, gustSpanMs } from "./motion";

/** The wind clock and the curls' ranges. `spanMs`: one gust's curls, start to last fade (3.2 s: the gust's 2.1 s roll across six
 * plants, plus the time a curl needs to fade without looking cut). `maxOpacity`: the peak over the garden (subtle: the preview at 0.75
 * read as wind without covering a plant; the curls also draw behind the plant layer). Heights are fractions of the garden view's
 * height, kept to the sky above the soil (the soil's top sits at about 0.45 of the view on the demo garden). */
export const WIND = {
  spanMs: 3200,
  maxOpacity: 0.75,
  minCurls: 2, maxCurls: 3,
  delayMs: [0, 650] as const,     // when a curl lands after the gust starts (the first one always within the first 250 ms)
  lifeMs: [2100, 2700] as const,  // how long it is on screen
  top: [0.04, 0.34] as const,     // its top edge, as a fraction of the view's height
  scale: [0.9, 1.3] as const,     // dp per painted 1x unit (the curls are 54 to 77 units long)
  startX: [-0.12, 0.08] as const, // its left edge at landing, as a fraction of the garden's width
  travel: [0.55, 0.85] as const,  // how far it drifts, as a fraction of the garden's width
  lift: [-10, 4] as const,        // dp it rises (negative) or sinks over its life
  bob: 3,                         // dp of a slow vertical bob, one swell per life
} as const;
/** The wind clock's value between gusts and under reduced motion: past every curl's life, so every curl reads opacity 0. */
export const WIND_IDLE = 1e6;
/** The painted curls (wind-sprites.ts WIND_NAMES), by index. */
export const WIND_SPRITE_COUNT = 3;

/** One curl's draw for one gust: `sprite` the painted curl's index, `delay` and `life` in ms on the wind clock, `top` and `x0`
 * fractions (of the view's height and the garden's width), `travel` a fraction of the width, `scale` dp per 1x unit, `lift` dp,
 * `phase` the bob's phase (0 to 1), `peak` its opacity at full strength. `on` false = this slot sits out this gust. */
export type Curl = { on: boolean; sprite: number; delay: number; life: number; top: number; x0: number; travel: number; scale: number; lift: number; phase: number; peak: number };

/** A tiny seeded PRNG (mulberry32): the k-th draw in [0, 1) for seed `seed`. Pure, so the UI thread and the tests agree on a plan. */
export function rand(seed: number, k: number): number {
  "worklet";
  let a = (Math.imul(seed | 0, 0x9e3779b1) + Math.imul(k + 1, 0x85ebca6b)) | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const lerp = (r: readonly [number, number], u: number) => {
  "worklet";
  return r[0] + (r[1] - r[0]) * u;
};

/** How many curls a gust brings: 2 or 3, from the seed. */
export function curlCount(seed: number): number {
  "worklet";
  return rand(seed, 0) < 0.5 ? WIND.minCurls : WIND.maxCurls;
}

/** Slot `i` (0, 1 or 2) of gust `seed`. The slots are spread so the curls never stack: each takes its own band of the sky (a third of
 * the height range, jittered inside it, the band order shuffled per gust), lands one after another (slot 0 within 250 ms of the gust's
 * start, the others later), and paints a different curl. Every curl is gone by `WIND.spanMs`. */
export function curlPlan(seed: number, i: number): Curl {
  "worklet";
  const r = (k: number) => rand(seed, 1 + i * 8 + k);
  const n = curlCount(seed);
  const rot = Math.floor(rand(seed, 40) * 3);                     // the band order and the painted-curl order, shuffled per gust
  const band = (i + rot) % 3;
  const top = lerp(WIND.top, (band + 0.15 + 0.7 * r(0)) / 3);
  const delay = i === 0 ? 250 * r(1) : lerp(WIND.delayMs, (i - 1 + r(1)) / 2) + 120;
  const life = Math.min(lerp(WIND.lifeMs, r(2)), WIND.spanMs - delay);
  return {
    on: i < n,
    sprite: (i + Math.floor(rand(seed, 41) * WIND_SPRITE_COUNT)) % WIND_SPRITE_COUNT,
    delay, life, top,
    x0: lerp(WIND.startX, r(3)),
    travel: lerp(WIND.travel, r(4)),
    scale: lerp(WIND.scale, r(5)),
    lift: lerp(WIND.lift, r(6)),
    phase: r(7),
    peak: WIND.maxOpacity * (0.75 + 0.25 * r(8)),
  };
}

/** Where a curl is `ms` into the wind clock: `x` its left edge as a fraction of the garden's width, `dy` dp from its planned top,
 * `stretch` a horizontal scale (it lengthens a touch while it is quickest, as a gust's streak would), `opacity`. Off its life, or under
 * reduced motion, opacity 0. The drift is front-loaded (an ease-out: the gust's push is strongest as it arrives, then the air slows);
 * the fade is a smooth rise over the first quarter and a longer fall over the last 40 %, so it never pops in or out. */
export function curlAt(c: Curl, ms: number, reduced: boolean): { x: number; dy: number; stretch: number; opacity: number } {
  "worklet";
  const u = (ms - c.delay) / c.life;
  if (reduced || !c.on || !(u > 0 && u < 1)) return { x: c.x0, dy: 0, stretch: 1, opacity: 0 };
  const ease = 1 - (1 - u) * (1 - u) * (1 - u) * 0.6 - (1 - u) * 0.4;   // ease-out, never flat at the start (it arrives moving)
  const speed = 3 * 0.6 * (1 - u) * (1 - u) + 0.4;                     // d(ease)/du: 2.2 at landing, 0.4 at the end
  const fadeIn = Math.min(1, u / 0.25), fadeOut = Math.min(1, (1 - u) / 0.4);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  return {
    x: c.x0 + c.travel * ease,
    dy: c.lift * u + WIND.bob * Math.sin(2 * Math.PI * (u + c.phase)),
    stretch: 0.94 + 0.05 * (speed / 2.2),
    opacity: c.peak * smooth(fadeIn) * smooth(fadeOut),
  };
}

/** True when the gust clock (motion.ts: idle at GUST_IDLE or held at the last gust's end, reset to 0 at each new gust) has just
 * restarted: it only ever falls at a gust's start. */
export function isGustStart(cur: number, prev: number | null): boolean {
  "worklet";
  return prev !== null && cur < prev;
}

/** For the record and the tests: the gust the curls ride (six plants, 2.1 s from the first plant's push to the last one's rest). */
export const GUST_ROLL_MS = gustSpanMs(6);
export const GUST_PEAK_MS = GUST.ms / 2;
