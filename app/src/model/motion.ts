// The garden's continuous motion and the two-finger zoom as plain numbers (Task I4), so the worklets that drive them are tested here.
// Every function is a worklet: Garden and Plant call them on the UI thread. Dependency-free.
import { PLANT_ORDER, type PlantId } from "./garden";

/** His note (10-02), "the plants should be swaying all the time w the wind": 1.4 degrees either way over a 2.6 s period. */
export const SWAY = { deg: 1.4, periodMs: 2600 } as const;
/** Each plant's own phase, a fraction of the period: the golden ratio's steps keep the six far apart, so the garden never sways in lockstep. */
export const swayPhase = (plant: PlantId) => (PLANT_ORDER.indexOf(plant) * 0.618034) % 1;
/** The angle at clock `t` (0 to 1 over one period, one clock for the whole garden) for a plant at `phase`: a sine, so the wrap is seamless. */
export function swayAngle(t: number, phase: number): number {
  "worklet";
  return SWAY.deg * Math.sin(2 * Math.PI * (t + phase));
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
