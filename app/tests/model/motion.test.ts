import { describe, it, expect } from "vitest";
import { SWAY, swayAngle, swayPhase, frameAt, clampZoom, panLimit, pinchOffset, GUST, GUST_IDLE, gustGap, gustDelays, gustSpanMs, gustEnvelope, windAngle } from "@/model/motion";
import { PLANT_ORDER } from "@/model/garden";

describe("the sway (his note: swaying all the time with the wind; R179, R183: 5 degrees either way, 3.2 s each way)", () => {
  it("swings 5 degrees either way, 3.2 s each way (a 6.4 s period)", () => {
    expect(SWAY).toEqual({ deg: 5, periodMs: 6400 });
    expect(swayAngle(0.25, 0)).toBeCloseTo(5, 9);
    expect(swayAngle(0.75, 0)).toBeCloseTo(-5, 9);
    expect(swayAngle(0, 0)).toBeCloseTo(0, 9);
    expect(swayAngle(1, 0)).toBeCloseTo(swayAngle(0, 0), 9);   // the clock wraps without a jump
  });
  it("every plant on its own phase, so the garden never moves in lockstep", () => {
    const phases = PLANT_ORDER.map(swayPhase);
    expect(new Set(phases.map((p) => p.toFixed(3))).size).toBe(6);
    for (const p of phases) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(1); }
    // no two plants closer than a twentieth of a period (320 ms), at any clock
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) { const d = Math.abs(phases[i] - phases[j]); expect(Math.min(d, 1 - d)).toBeGreaterThan(0.05); }
  });
});

describe("the strip's frame over time (A-STRIP: whole frames, one per sixteenth of the leaf's time)", () => {
  it("steps 0 to 15 by whole frames and holds the last", () => {
    expect(frameAt(0, 16)).toBe(0);
    expect(frameAt(1 / 16 - 1e-9, 16)).toBe(0);
    expect(frameAt(1 / 16, 16)).toBe(1);
    expect(frameAt(0.5, 16)).toBe(8);
    expect(frameAt(15 / 16, 16)).toBe(15);
    expect(frameAt(1, 16)).toBe(15);
    expect(frameAt(1.2, 16)).toBe(15);
    expect(frameAt(-0.1, 16)).toBe(0);
  });
});

describe("two-finger zoom (R173: up to 3x with pan, snapping back to the automatic frame)", () => {
  it("the zoom stays between the automatic frame (1) and 3", () => {
    expect(clampZoom(0.5)).toBe(1); expect(clampZoom(2.2)).toBe(2.2); expect(clampZoom(4)).toBe(3);
  });
  it("the pan keeps the zoomed garden covering its view", () => {
    expect(panLimit(0, 1, 300)).toBe(0);
    expect(panLimit(20, 2, 300)).toBe(0);         // never past the left/top edge
    expect(panLimit(-400, 2, 300)).toBe(-300);    // never past the right/bottom edge: 300 * (1 - 2)
    expect(panLimit(-100, 2, 300)).toBe(-100);
  });
  it("the point under the fingers stays under them as the zoom changes and the fingers move (the two-finger pan)", () => {
    // at zoom 1 and no offset, pinching to 2 about x 100 puts the content's x 100 back under x 100: offset -100
    expect(pinchOffset(0, 1, 2, 100, 100, 300)).toBe(-100);
    // already at 2 with offset -100 (content x 100 at screen 100); to 3 about screen 100: content x 100 must stay at 100 => -200
    expect(pinchOffset(-100, 2, 3, 100, 100, 300)).toBe(-200);
    // the fingers slide 20 left while zooming to 2: the content's x 100 follows them to screen 80
    expect(pinchOffset(0, 1, 2, 100, 80, 300)).toBe(-120);
    // clamped inside the view
    expect(pinchOffset(0, 1, 2, 0, 0, 300)).toBe(0);
    expect(pinchOffset(0, 1, 2, 290, 10, 300)).toBe(-300);
  });
});

describe("the gusts (R189: every 8 to 15 s at random, about 12 degrees, eased over about 1.5 s, rolling left to right 120 ms a plant)", () => {
  it("the schedule: the next gust starts 8 to 15 s after the last, spread over the whole range", () => {
    expect(gustGap(0)).toBe(8000);
    expect(gustGap(0.999999)).toBeCloseTo(15000, 0);
    expect(gustGap(0.5)).toBe(11500);
    for (let i = 0; i < 200; i++) { const g = gustGap(Math.random()); expect(g).toBeGreaterThanOrEqual(8000); expect(g).toBeLessThanOrEqual(15000); }
    expect(gustGap(-1)).toBe(8000); expect(gustGap(2)).toBe(15000);   // a bad draw never leaves the range
    // the whole roll (six plants) is over well before the next gust can start
    expect(gustSpanMs(6)).toBe(1500 + 5 * 120);
    expect(gustSpanMs(6)).toBeLessThan(gustGap(0));
  });
  it("the per-plant delay: 120 ms after its left neighbour, across both rows, by where each plant stands", () => {
    // at 320 wide: hsol 28.8, skr 96, jitosol 160, jupsol 214.4, ore 256, cbbtc 294.4
    expect(gustDelays({ skr: 96, ore: 256, hsol: 28.8, jitosol: 160, jupsol: 214.4, cbbtc: 294.4 })).toEqual({ hsol: 0, skr: 120, jitosol: 240, jupsol: 360, ore: 480, cbbtc: 600 });
    expect(gustDelays({ ore: 200, skr: 100 })).toEqual({ skr: 0, ore: 120 });   // two plants: the left one first
    expect(gustDelays({})).toEqual({});
    expect(GUST.stepMs).toBe(120);
  });
  it("the envelope: nothing before or after, eased in and out over 1.5 s, the peak in the middle", () => {
    expect(GUST.ms).toBe(1500);
    expect(gustEnvelope(-50)).toBe(0); expect(gustEnvelope(0)).toBe(0); expect(gustEnvelope(1500)).toBe(0); expect(gustEnvelope(GUST_IDLE)).toBe(0);
    expect(gustEnvelope(750)).toBeCloseTo(1, 9);
    // eased: slow at both ends (a tenth of the way in moves under a tenth of the swing), rising to the peak, then falling back
    expect(gustEnvelope(150)).toBeLessThan(0.1); expect(gustEnvelope(1350)).toBeLessThan(0.1);
    for (let t = 0; t < 750; t += 50) expect(gustEnvelope(t + 50)).toBeGreaterThan(gustEnvelope(t));
    for (let t = 750; t < 1450; t += 50) expect(gustEnvelope(t + 50)).toBeLessThan(gustEnvelope(t));
  });
  it("the peak: about 12 degrees with the wind (rightward, as it rolls left to right), from any point of the steady sway", () => {
    expect(GUST.deg).toBe(12);
    for (const t of [0, 0.25, 0.5, 0.75]) for (const ph of [0, 0.3]) expect(windAngle(t, ph, 750)).toBeCloseTo(12, 9);
    // no gust: the steady 5 degree sway, unchanged
    for (const t of [0, 0.1, 0.25, 0.6]) expect(windAngle(t, 0.2, GUST_IDLE)).toBeCloseTo(swayAngle(t, 0.2), 9);
    // never past the peak at any point of a gust
    for (let ms = 0; ms <= 1500; ms += 25) for (const t of [0, 0.25, 0.75]) { const a = windAngle(t, 0, ms); expect(a).toBeLessThanOrEqual(12 + 1e-9); expect(a).toBeGreaterThanOrEqual(-SWAY.deg - 1e-9); }
  });
});
