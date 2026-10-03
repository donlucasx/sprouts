// The garden's continuous motion and the two-finger zoom as plain numbers (Task I4), so the worklets that drive them are tested here.
// Every function is a worklet: Garden and Plant call them on the UI thread. Dependency-free.
import { PLANT_ORDER, type PlantId } from "./garden";

/** His note (10-02), "the plants should be swaying all the time w the wind"; R179 (1.4 degrees could not be seen): 3.2 s each way
 * (a 6.4 s period); R183 (3 was "swaying but too subtly"): 5 degrees either way. */
export const SWAY = { deg: 5, periodMs: 6400 } as const;
/** Each plant's own phase, a fraction of the period: the golden ratio's steps keep the six far apart, so the garden never sways in lockstep. */
export const swayPhase = (plant: PlantId) => (PLANT_ORDER.indexOf(plant) * 0.618034) % 1;
/** The angle at clock `t` (0 to 1 over one period, one clock for the whole garden) for a plant at `phase`: a sine, so the wrap is seamless. */
export function swayAngle(t: number, phase: number): number {
  "worklet";
  return SWAY.deg * Math.sin(2 * Math.PI * (t + phase));
}
/** R189 (10-02, "every now and then a lil gust of wind moves the plants even more"): the steady sway stays, and every 8 to 15 s at
 * random a gust swings each plant to about 12 degrees with the wind, eased in and out over 1.5 s, rolling across the garden from left
 * to right, each plant 120 ms after its left neighbour; then back to the steady sway. Off under reduced motion. */
export const GUST = { deg: 12, ms: 1500, minGapMs: 8000, maxGapMs: 15000, stepMs: 120 } as const;
/** The gust clock's value between gusts: far past every plant's gust, so the envelope reads 0. */
export const GUST_IDLE = 1e6;
/** The wait from one gust's start to the next, from a draw `r` in [0, 1) (Math.random), clamped into 8 to 15 s. */
export const gustGap = (r: number) => GUST.minGapMs + Math.min(1, Math.max(0, r)) * (GUST.maxGapMs - GUST.minGapMs);
/** The gust clock's whole run for `n` plants: the last plant's delay plus one gust. */
export const gustSpanMs = (n: number) => GUST.ms + Math.max(0, n - 1) * GUST.stepMs;
/** Each plant's delay into the gust: its rank from the left by foot x (both rows together) times 120 ms; ties keep PLANT_ORDER. */
export function gustDelays(xs: Partial<Record<PlantId, number>>): Partial<Record<PlantId, number>> {
  const order = (Object.keys(xs) as PlantId[]).sort((a, b) => (xs[a] as number) - (xs[b] as number) || PLANT_ORDER.indexOf(a) - PLANT_ORDER.indexOf(b));
  return Object.fromEntries(order.map((p, i) => [p, i * GUST.stepMs]));
}
/** How much of the gust a plant feels `ms` into its own gust: 0 outside the 1.5 s, sin squared inside (eased in and out), 1 at 750 ms. */
export function gustEnvelope(ms: number): number {
  "worklet";
  if (ms <= 0 || ms >= GUST.ms) return 0;
  const s = Math.sin((Math.PI * ms) / GUST.ms);
  return s * s;
}
/** The plant's angle: the steady sway (clock `t`, its `phase`) blended toward the gust's 12 degrees by the envelope at `gustMs`, the
 * ms into this plant's own gust (the garden's gust clock minus the plant's delay). With no gust it is exactly the steady sway. */
export function windAngle(t: number, phase: number, gustMs: number): number {
  "worklet";
  const g = gustEnvelope(gustMs);
  return swayAngle(t, phase) * (1 - g) + GUST.deg * g;
}
/** A-STRIP: the frame shown at progress `p` (0 to 1 over the leaf's time): whole frames only, each held a 1/frames share, the last held. */
export function frameAt(p: number, frames: number): number {
  "worklet";
  return Math.max(0, Math.min(frames - 1, Math.floor(p * frames)));
}
/** R173: two fingers zoom the garden up to 3x over its automatic frame (RG30), never below it. */
export const MAX_PINCH = 3;
export function clampZoom(s: number): number {
  "worklet";
  return Math.min(MAX_PINCH, Math.max(1, s));
}
/** The zoom's transform origin is the view's top-left (screen = offset + s * content), so the zoomed garden covers its view while the
 * offset stays between size * (1 - s) and 0. */
export function panLimit(offset: number, s: number, size: number): number {
  "worklet";
  return Math.min(0, Math.max(size * (1 - s), offset));
}
/** The offset that keeps the content that was under the fingers' focal point at the gesture's start (`focal0`, at zoom `s0` and offset
 * `o0`) under the focal point now (`focal`) at zoom `s`, clamped: one pinch both zooms and, as the two fingers move, pans. */
export function pinchOffset(o0: number, s0: number, s: number, focal0: number, focal: number, size: number): number {
  "worklet";
  return panLimit(focal - ((focal0 - o0) * s) / s0, s, size);
}
