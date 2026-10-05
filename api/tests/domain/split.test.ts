import { describe, it, expect } from "vitest";
import { ASSETS, SKR_ONLY, zeroSplit, type Split } from "@/domain/coins";
import { STOPS, STOP_DEFAULTS, MOVE_LIMIT, validatePins, effectiveSplit, clampSplit, fallbackSplit, checkWhy, templateWhy, floorFor } from "@/domain/split";

const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });
const sum = (s: Split) => ASSETS.reduce((t, a) => t + s[a], 0);
const BAL = STOP_DEFAULTS.balanced;

// Spec section 4 (R110, R111, R119, R120): the stop tables, pins, the user's split, the clamp, the fallback, the why check.
describe("the stop tables", () => {
  it("floors 50 / 35 / 25, manual 25; stORE capped 5 / 10 / 20", () => {
    expect([STOPS.careful.floor, STOPS.balanced.floor, STOPS.bold.floor]).toEqual([50, 35, 25]);
    expect(floorFor(false, "bold")).toBe(25);
    expect([STOPS.careful.max.stORE, STOPS.balanced.max.stORE, STOPS.bold.max.stORE]).toEqual([10, 20, 30]);   // R251 (5 / 10 / 20 before)
  });
  it("every stop default sums to 100, keeps the floor and respects every max", () => {
    for (const stop of ["careful", "balanced", "bold"] as const) {
      const d = STOP_DEFAULTS[stop];
      expect(sum(d)).toBe(100);
      expect(d.SKR).toBeGreaterThanOrEqual(STOPS[stop].floor);
      for (const a of ASSETS) if (a !== "SKR") expect(d[a]).toBeLessThanOrEqual(STOPS[stop].max[a]);
      expect(d.stORE).toBe(0);
    }
  });
});

describe("validatePins (spec 4.2)", () => {
  it("accepts pins within the room, rejects a sum over it", () => {
    expect(validatePins({ cbBTC: 10, hSOL: 20 }, 35)).toBeNull();
    expect(validatePins({ cbBTC: 40, hSOL: 30 }, 35)).toBe("sum");      // 70 > 65
    expect(validatePins({ cbBTC: 35, hSOL: 30 }, 35)).toBeNull();        // exactly 65
  });
  it("SKR pinned under the floor is refused; at or above it is fine", () => {
    expect(validatePins({ SKR: 30 }, 35)).toBe("skr_floor");
    expect(validatePins({ SKR: 35, hSOL: 65 }, 35)).toBeNull();
    expect(validatePins({ SKR: 35, hSOL: 70 }, 35)).toBe("sum");
  });
  it("the pin maxes: stORE 50, others 75; whole percents only", () => {
    expect(validatePins({ stORE: 55 }, 25)).toBe("range");
    expect(validatePins({ hSOL: 80 }, 25)).toBe("range");
    expect(validatePins({ hSOL: 12.5 }, 25)).toBe("range");
    expect(validatePins({ hSOL: 12 }, 25)).toBeNull();
    expect(validatePins({ stORE: 50 }, 25)).toBeNull();
  });
});

describe("effectiveSplit (spec 4.3)", () => {
  it("off: pins are the split and SKR is the rest", () => {
    expect(effectiveSplit({ managed: false, stop: "balanced", pins: { stORE: 20 }, stopSplit: BAL })).toEqual(split({ SKR: 80, stORE: 20 }));
    expect(effectiveSplit({ managed: false, stop: "balanced", pins: {}, stopSplit: BAL })).toEqual(SKR_ONLY);
  });
  it("on with no pins: the stop's split as is", () => {
    expect(effectiveSplit({ managed: true, stop: "balanced", pins: {}, stopSplit: BAL })).toEqual(BAL);
  });
  it("on with a pin: the pinned coin is fixed and the rest is renormalised over the free coins", () => {
    const s = effectiveSplit({ managed: true, stop: "balanced", pins: { cbBTC: 20 }, stopSplit: BAL });
    expect(s.cbBTC).toBe(20);
    expect(sum(s)).toBe(100);
    expect(s.SKR).toBeGreaterThanOrEqual(35);
    // BAL without cbBTC is SKR 45, hSOL 20, USDC_LEND 15, SOL_LEND 10 over 90, scaled to 80
    expect(s.SKR).toBe(40);
    expect(s.hSOL).toBe(18);
  });
  it("pins fill everything but the floor: SKR lands exactly on the floor, free coins at 0", () => {
    const s = effectiveSplit({ managed: true, stop: "balanced", pins: { hSOL: 35, cbBTC: 30 }, stopSplit: BAL });
    expect(s).toEqual(split({ SKR: 35, hSOL: 35, cbBTC: 30 }));
  });
  it("a renormalised coin over its max is clamped and the excess goes to SKR last", () => {
    // Bold stop split leaning hard on hSOL; pin USDC_LEND small so hSOL would exceed 35 after renormalisation
    const lean = split({ SKR: 30, hSOL: 35, USDC_LEND: 35 });
    const s = effectiveSplit({ managed: true, stop: "bold", pins: { USDC_LEND: 5 }, stopSplit: lean });
    expect(s.hSOL).toBeLessThanOrEqual(35);
    expect(s.USDC_LEND).toBe(5);
    expect(sum(s)).toBe(100);
    expect(s.SKR).toBeGreaterThanOrEqual(25);
  });
  it("a pinned no-data coin keeps its pin (the user's authority)", () => {
    const s = effectiveSplit({ managed: true, stop: "balanced", pins: { SOL_LEND: 15 }, stopSplit: split({ SKR: 60, hSOL: 40 }) });
    expect(s.SOL_LEND).toBe(15);
    expect(sum(s)).toBe(100);
  });
  it("SKR pinned: the manager fills the rest around it", () => {
    const s = effectiveSplit({ managed: true, stop: "careful", pins: { SKR: 70 }, stopSplit: STOP_DEFAULTS.careful });
    expect(s.SKR).toBe(70);
    expect(sum(s)).toBe(100);
    for (const a of ASSETS) if (a !== "SKR") expect(s[a]).toBeLessThanOrEqual(STOPS.careful.max[a]);
  });
  it("a pinned SKR with room around it: the free coins water-fill what one coin cannot hold", () => {
    const s = effectiveSplit({ managed: true, stop: "careful", pins: { SKR: 50, stORE: 0, cbBTC: 0 }, stopSplit: STOP_DEFAULTS.careful });
    // By hand (careful maxes hSOL 15, USDC_LEND 30, SOL_LEND 15; weights 10/10/0 over R=50 give 25/25/0): hSOL caps at 15, its 10 excess
    // pours over the room left (USDC_LEND 5, SOL_LEND 15) as 2.5 and 7.5, so x = 15 / 27.5 / 7.5; roundTo100 floors to 99 and the first
    // tied .5 remainder in ASSETS order (USDC_LEND) takes the last point: 28 / 7. SKR stays at its pin of 50.
    expect(s).toEqual({ SKR: 50, hSOL: 15, USDC_LEND: 28, SOL_LEND: 7, stORE: 0, cbBTC: 0 });
  });
  it("a pinned SKR is a floor: what the free coins cannot hold goes to SKR, not all of the rest", () => {
    // By hand: careful, pins SKR 50, stORE 0, cbBTC 0, USDC_LEND 0 leave hSOL and SOL_LEND free over R=50. Weights 10/0 give hSOL 50,
    // SOL_LEND 0. Caps are hSOL 15, SOL_LEND 15: hSOL caps at 15 (excess 35), SOL_LEND takes its whole room of 15, and the 20 left
    // that no free coin can hold goes to SKR: 50 + 20 = 70. Sum 70 + 15 + 15 = 100.
    const s = effectiveSplit({ managed: true, stop: "careful", pins: { SKR: 50, stORE: 0, cbBTC: 0, USDC_LEND: 0 }, stopSplit: STOP_DEFAULTS.careful });
    expect(s).toEqual({ SKR: 70, hSOL: 15, USDC_LEND: 0, SOL_LEND: 15, stORE: 0, cbBTC: 0 });
  });
  it("a pinned SKR the free coins can fill around stays exactly at its pin (positive control)", () => {
    const s = effectiveSplit({ managed: true, stop: "balanced", pins: { SKR: 40 }, stopSplit: BAL });
    expect(s.SKR).toBe(40);
    expect(sum(s)).toBe(100);
  });
  it("always sums to 100 over a sweep of pins and stops", () => {
    for (const stop of ["careful", "balanced", "bold"] as const) {
      for (const c of [0, 5, 10, 25]) for (const h of [0, 15, 30]) {
        const pins = { cbBTC: c, hSOL: h };
        if (validatePins(pins, STOPS[stop].floor)) continue;
        const s = effectiveSplit({ managed: true, stop, pins, stopSplit: STOP_DEFAULTS[stop] });
        expect(sum(s)).toBe(100);
        expect(s.SKR).toBeGreaterThanOrEqual(STOPS[stop].floor);
        expect(s.cbBTC).toBe(c);
        expect(s.hSOL).toBe(h);
      }
    }
  });
});

describe("clampSplit (spec 6.3)", () => {
  it("passes an answer inside the stop untouched (positive control)", () => {
    expect(clampSplit({ stop: "balanced", proposed: BAL, noData: [], yesterday: null })).toEqual(BAL);
  });
  it("an all-in answer is clamped to the stop and the move limit", () => {
    const allIn = split({ hSOL: 100 });
    const noYesterday = clampSplit({ stop: "balanced", proposed: allIn, noData: [], yesterday: null })!;
    expect(noYesterday.hSOL).toBe(25);
    expect(noYesterday.SKR).toBe(75);
    const withYesterday = clampSplit({ stop: "balanced", proposed: allIn, noData: [], yesterday: BAL })!;
    expect(withYesterday.hSOL).toBe(Math.min(STOPS.balanced.max.hSOL, BAL.hSOL + MOVE_LIMIT));
    expect(withYesterday.SKR).toBeGreaterThanOrEqual(35);
    expect(sum(withYesterday)).toBe(100);
  });
  it("with no yesterday a no-data coin is 0, even if the model wanted more (R132)", () => {
    const s = clampSplit({ stop: "bold", proposed: split({ SKR: 30, SOL_LEND: 35, hSOL: 35 }), noData: ["SOL_LEND"], yesterday: null })!;
    expect(s.SOL_LEND).toBe(0);
    expect(sum(s)).toBe(100);
  });
  it("a no-data coin keeps yesterday's share for the stop when there is one (R132)", () => {
    const s = clampSplit({ stop: "balanced", proposed: split({ SKR: 55, hSOL: 25, USDC_LEND: 15, cbBTC: 5 }), noData: ["SOL_LEND"], yesterday: BAL })!;
    expect(s.SOL_LEND).toBe(BAL.SOL_LEND);
    expect(sum(s)).toBe(100);
  });

  it("a no-data coin's held share is capped at the stop max (R132)", () => {
    const y = split({ SKR: 50, SOL_LEND: 20, hSOL: 15, cbBTC: 15 }); // a row from before the max applied
    const s = clampSplit({ stop: "careful", proposed: split({ SKR: 70, hSOL: 15, cbBTC: 15 }), noData: ["SOL_LEND"], yesterday: y })!;
    expect(s.SOL_LEND).toBe(STOPS.careful.max.SOL_LEND);
    expect(sum(s)).toBe(100);
  });

  it("a coin cannot fall more than the move limit either", () => {
    const s = clampSplit({ stop: "balanced", proposed: split({ SKR: 100 }), noData: [], yesterday: BAL })!;
    expect(s.hSOL).toBe(BAL.hSOL - MOVE_LIMIT);
    expect(s.cbBTC).toBe(Math.max(0, BAL.cbBTC - MOVE_LIMIT));
    expect(sum(s)).toBe(100);
  });
  it("SKR below the floor is raised by taking from the largest coins first", () => {
    const s = clampSplit({ stop: "careful", proposed: split({ SKR: 10, cbBTC: 30, hSOL: 15, USDC_LEND: 15, SOL_LEND: 15, stORE: 15 }), noData: [], yesterday: null })!;
    expect(s.SKR).toBe(50);
    expect(s.stORE).toBeLessThanOrEqual(10);
    expect(sum(s)).toBe(100);
  });
  it("the move limit never applies to the first day", () => {
    const s = clampSplit({ stop: "bold", proposed: split({ SKR: 25, hSOL: 35, USDC_LEND: 35, cbBTC: 5 }), noData: [], yesterday: null })!;
    expect(s.hSOL).toBe(35);
  });
});

describe("fallbackSplit (spec 6.5)", () => {
  it("fills the highest measured growth first, each to its max, SKR at least the floor", () => {
    const s = fallbackSplit({ stop: "balanced", growth: { hSOL: 7.2, USDC_LEND: 6.1, SOL_LEND: 5.9, stORE: 9.0, cbBTC: 0 }, noData: [], yesterday: null });
    expect(s.SKR).toBe(45);                       // max(floor 35, default 45)
    expect(s.stORE).toBe(20);                     // the highest, capped at 20 (R251)
    expect(s.hSOL).toBe(25);
    expect(s.USDC_LEND).toBe(10);                   // the remainder (20 before R251 raised stORE)
    expect(sum(s)).toBe(100);
  });
  it("skips coins without a measured number and obeys the move limit against yesterday", () => {
    const s = fallbackSplit({ stop: "balanced", growth: { hSOL: 7.2, USDC_LEND: null, SOL_LEND: null, stORE: null, cbBTC: 0 }, noData: ["SOL_LEND"], yesterday: BAL });
    expect(s.hSOL).toBeLessThanOrEqual(BAL.hSOL + MOVE_LIMIT);
    expect(s.SOL_LEND).toBe(BAL.SOL_LEND);                 // R132: the no-data coin keeps yesterday's share
    expect(sum(s)).toBe(100);
  });
  it("with nothing measured, yesterday stands, or the stop default on day one", () => {
    expect(fallbackSplit({ stop: "careful", growth: {}, noData: [], yesterday: null })).toEqual(STOP_DEFAULTS.careful);
    const y = split({ SKR: 55, cbBTC: 25, hSOL: 10, USDC_LEND: 10 });
    expect(fallbackSplit({ stop: "careful", growth: {}, noData: [], yesterday: y })).toEqual(y);
  });
});

describe("checkWhy (spec 6.4)", () => {
  const facts = [7.2, 6.1, 5.9, 0, 35, 25, 45, 20, 15, 10, 7];
  it("accepts a true line", () => {
    expect(checkWhy("hSOL grew at 7.2% a year over the past week, the most of your SOL coins.", facts)).toBe("hSOL grew at 7.2% a year over the past week, the most of your SOL coins.");
  });
  it("rejects a number not in the facts", () => {
    expect(checkWhy("hSOL grew at 9.9% a year this week.", facts)).toBeNull();
  });
  it("rejects exclamation marks, persona words, advice words and over-length, and strips URLs", () => {
    expect(checkWhy("hSOL grew 7.2% this week!", facts)).toBeNull();
    expect(checkWhy("hSOL leads at 7.2% this week. https://x.y", facts)).toBe("hSOL leads at 7.2% this week.");
    expect(checkWhy("I moved 10 points to hSOL, which grew 7.2%.", facts)).toBeNull();
    expect(checkWhy("You should buy more hSOL, it grew 7.2%.", facts)).toBeNull();
    expect(checkWhy("We moved 10 points to hSOL.", facts)).toBeNull();
    expect(checkWhy("The watcher leans to hSOL at 7.2%.", facts)).toBeNull();
    expect(checkWhy("hSOL grew 7.2% \u2014 the most this week.", facts)).toBeNull();
    expect(checkWhy("hSOL grew 7.2% this week \u{1F331}", facts)).toBeNull();
    expect(checkWhy("Your portfolio leans to hSOL at 7.2%.", facts)).toBeNull();
    expect(checkWhy(`${"hSOL leads at 7.2%. ".repeat(10)}`, facts)).toBeNull();
  });
  it("the template names the top coin, or says it is collecting", () => {
    expect(templateWhy({ stop: "balanced", top: { asset: "hSOL", pct: 7.24 } })).toBe("hSOL grew at 7.2% a year over the past week, the most of your coins.");
    expect(templateWhy({ stop: "bold", top: null })).toBe("Collecting the first week of numbers; the split follows the limits for Bold.");
    expect(templateWhy({ stop: "bold", top: { asset: "stORE", pct: 7.46 } })).toBe("stORE grew at 7.5% a year over the past week, the most of your coins, from ORE mining fees.");
  });
});

import { redistributeDisabled } from "@/domain/split";

describe("redistributeDisabled (spec 6.5: a disabled leg's share goes to the next enabled leg)", () => {
  it("moves every disabled share to the enabled leg with the largest share", () => {
    const s = { SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 };
    expect(redistributeDisabled(s, ["SKR", "SOL_LEND", "stORE"])).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 15, SOL_LEND: 0, hSOL: 75, cbBTC: 10 });
  });
  it("leaves a split alone when nothing disabled holds a share, and answers null when nothing is enabled", () => {
    const s = { SKR: 100, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 };
    expect(redistributeDisabled(s, ["stORE"])).toEqual(s);
    expect(redistributeDisabled(s, ["SKR", "stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC"])).toBeNull();
  });
  it("ties go to the first leg in ASSETS order", () => {
    const s = { SKR: 50, stORE: 0, USDC_LEND: 25, SOL_LEND: 0, hSOL: 25, cbBTC: 0 };
    expect(redistributeDisabled(s, ["SKR"])).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 75, SOL_LEND: 0, hSOL: 25, cbBTC: 0 });
  });
});
