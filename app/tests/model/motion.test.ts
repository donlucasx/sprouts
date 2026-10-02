import { describe, it, expect } from "vitest";
import { SWAY, swayAngle, swayPhase, frameAt, clampZoom, panLimit, pinchOffset } from "@/model/motion";
import { PLANT_ORDER } from "@/model/garden";

describe("the sway (his note: swaying all the time with the wind; R179: 3 degrees either way, 3.2 s each way)", () => {
  it("swings 3 degrees either way, 3.2 s each way (a 6.4 s period)", () => {
    expect(SWAY).toEqual({ deg: 3, periodMs: 6400 });
    expect(swayAngle(0.25, 0)).toBeCloseTo(3, 9);
    expect(swayAngle(0.75, 0)).toBeCloseTo(-3, 9);
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
