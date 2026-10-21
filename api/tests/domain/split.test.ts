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
      expect(d.stORE).toBe(10);   // R-O1 (10-21): was 0
    }
  });
});

describe("validatePins (spec 4.2)", () => {
  it("accepts pins within the room, rejects a sum over it", () => {
    expect(validatePins({ cbBTC: 10, hSOL: 20 }, 35)).toBeNull();
    expect(validatePins({ cbBTC: 40, hSOL: 30 }, 35)).toBe("sum");      // 70 > 65
    expect(validatePins({ cbBTC: 30, hSOL: 25 }, 35)).toBeNull();        // exactly 55: R-O1 keeps 10 for an unpinned stORE
    expect(validatePins({ cbBTC: 35, hSOL: 30 }, 35)).toBe("sum");       // 65 was the room before R-O1
  });
  it("SKR pinned under the floor is refused; at or above it is fine", () => {
    expect(validatePins({ SKR: 30 }, 35)).toBe("skr_floor");
    expect(validatePins({ SKR: 35, hSOL: 55 }, 35)).toBeNull();
    expect(validatePins({ SKR: 35, hSOL: 65 }, 35)).toBe("sum");         // R-O1: no room left for stORE's 10
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
  it("off: pins are the split and SKR is the rest (stORE at least its floor, R-O1)", () => {
    expect(effectiveSplit({ managed: false, stop: "balanced", pins: { stORE: 20 }, stopSplit: BAL })).toEqual(split({ SKR: 80, stORE: 20 }));
    expect(effectiveSplit({ managed: false, stop: "balanced", pins: {}, stopSplit: BAL })).toEqual(split({ SKR: 90, stORE: 10 }));   // SKR_ONLY before R-O1
  });
  it("on with no pins: the stop's split as is", () => {
    expect(effectiveSplit({ managed: true, stop: "balanced", pins: {}, stopSplit: BAL })).toEqual(BAL);
  });
  it("on with a pin: the pinned coin is fixed and the rest is renormalised over the free coins", () => {
    const s = effectiveSplit({ managed: true, stop: "balanced", pins: { cbBTC: 20 }, stopSplit: BAL });
    expect(s.cbBTC).toBe(20);
    expect(sum(s)).toBe(100);
    expect(s.SKR).toBeGreaterThanOrEqual(35);
    // By hand (R-O1 defaults): BAL without cbBTC is SKR 35, stORE 10, USDC_LEND 15, SOL_LEND 10, hSOL 20 over 90, scaled to 80:
    // 31.1 / 8.9 / 13.3 / 8.9 / 17.8. SKR is topped to 35 from hSOL (17.8 -> 13.9; stORE is kept), rounding gives stORE, SOL_LEND
    // and hSOL the .9 points (9 / 9 / 14), and stORE's last point to the floor comes from the largest free coin, hSOL: 13.
    expect(s).toEqual({ SKR: 35, stORE: 10, USDC_LEND: 13, SOL_LEND: 9, hSOL: 13, cbBTC: 20 });
  });
  it("pins fill everything but the two floors: SKR and stORE land exactly on them, other free coins at 0", () => {
    const s = effectiveSplit({ managed: true, stop: "balanced", pins: { hSOL: 25, cbBTC: 30 }, stopSplit: BAL });
    expect(s).toEqual(split({ SKR: 35, stORE: 10, hSOL: 25, cbBTC: 30 }));
    // The pre-R-O1 room (hSOL 35 + cbBTC 30) is now refused at save; a row saved before keeps SKR's floor and trims the largest pin.
    expect(effectiveSplit({ managed: true, stop: "balanced", pins: { hSOL: 35, cbBTC: 30 }, stopSplit: BAL })).toEqual(split({ SKR: 35, stORE: 10, hSOL: 25, cbBTC: 30 }));
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
    expect(noYesterday.stORE).toBe(10);   // R-O1
    expect(noYesterday.SKR).toBe(65);
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
    expect(s.SKR).toBe(35);                       // max(floor 35, default 35; 45 before R-O1)
    expect(s.stORE).toBe(20);                     // its floor of 10 first (R-O1), then the highest growth, capped at 20 (R251)
    expect(s.hSOL).toBe(25);
    expect(s.USDC_LEND).toBe(20);                   // the remainder
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
    const y = split({ SKR: 50, stORE: 10, cbBTC: 20, hSOL: 10, USDC_LEND: 10 });
    expect(fallbackSplit({ stop: "careful", growth: {}, noData: [], yesterday: y })).toEqual(y);
    // A yesterday from before R-O1 (stORE 0): stORE takes its 10 from SKR, and SKR's floor takes 5 back from cbBTC (25 -> 20, inside the move limit).
    const old = split({ SKR: 55, cbBTC: 25, hSOL: 10, USDC_LEND: 10 });
    expect(fallbackSplit({ stop: "careful", growth: {}, noData: [], yesterday: old })).toEqual(split({ SKR: 50, stORE: 10, cbBTC: 20, hSOL: 10, USDC_LEND: 10 }));
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

describe("redistributeDisabled (R336 + Claude follow-up: water-fill to the stop maxes, remainder to USDC lending)", () => {
  const DEF = STOP_DEFAULTS;
  const sum = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0);
  // Day-1 leash legs {2,6,7}: USDC on K-Lend, hSOL, cbBTC enabled; SKR, stORE and SOL_LEND disabled.
  const DAY1 = ["SKR", "stORE", "SOL_LEND"] as const;
  // With stORE (leg 1): {1,2,6,7}.
  const DAY1_STORE = ["SKR", "SOL_LEND"] as const;
  it("Careful, legs {2,6,7}: hSOL and cbBTC fill to their maxes (15, 30), USDC to 30 then takes the remainder 25: no 80% cbBTC", () => {
    expect(redistributeDisabled(DEF.careful, DAY1, "careful")).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 55, SOL_LEND: 0, hSOL: 15, cbBTC: 30 });
  });
  it("Balanced, legs {2,6,7}: hSOL 25, cbBTC 25 (maxes), USDC the rest (50)", () => {
    expect(redistributeDisabled(DEF.balanced, DAY1, "balanced")).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 50, SOL_LEND: 0, hSOL: 25, cbBTC: 25 });
  });
  it("Bold, legs {2,6,7}: hSOL 35, cbBTC 20 (maxes), USDC 45", () => {
    expect(redistributeDisabled(DEF.bold, DAY1, "bold")).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 45, SOL_LEND: 0, hSOL: 35, cbBTC: 20 });
  });
  it("legs {1,2,6,7}: stORE takes up to its max too, before the remainder goes to USDC", () => {
    expect(redistributeDisabled(DEF.careful, DAY1_STORE, "careful")).toEqual({ SKR: 0, stORE: 10, USDC_LEND: 45, SOL_LEND: 0, hSOL: 15, cbBTC: 30 });
    expect(redistributeDisabled(DEF.balanced, DAY1_STORE, "balanced")).toEqual({ SKR: 0, stORE: 20, USDC_LEND: 30, SOL_LEND: 0, hSOL: 25, cbBTC: 25 });
    // Bold: 45 points, headroom stORE 30, hSOL 10, cbBTC 10: stORE first to the common level, then one point each (ties in ASSETS order).
    expect(redistributeDisabled(DEF.bold, DAY1_STORE, "bold")).toEqual({ SKR: 0, stORE: 29, USDC_LEND: 20, SOL_LEND: 0, hSOL: 33, cbBTC: 18 });
  });
  it("every result: sums to 100, and no enabled leg but USDC_LEND sits over its stop max", () => {
    for (const stop of ["careful", "balanced", "bold"] as const) for (const dis of [DAY1, DAY1_STORE]) {
      const r = redistributeDisabled(DEF[stop], dis, stop)!;
      expect(sum(r)).toBe(100);
      for (const a of ["stORE", "SOL_LEND", "hSOL", "cbBTC"] as const) expect(r[a]).toBeLessThanOrEqual(STOPS[stop].max[a]);
    }
  });
  it("the fill goes to the leg with the most headroom first (water levels), so a small share spreads instead of piling on one leg", () => {
    // Unleashed, Balanced, SOL_LEND has no eligible venue: its 10 points go one by one to the most headroom (SKR has 65).
    expect(redistributeDisabled(DEF.balanced, ["SOL_LEND"], "balanced")).toEqual({ SKR: 45, stORE: 10, USDC_LEND: 15, SOL_LEND: 0, hSOL: 20, cbBTC: 10 });
    const s = { SKR: 30, stORE: 20, USDC_LEND: 10, SOL_LEND: 10, hSOL: 15, cbBTC: 15 };
    // SKR and SOL_LEND off (leashed): 40 points; careful headroom stORE 0 (already over), USDC 20, hSOL 0, cbBTC 15; 5 left go to USDC.
    expect(redistributeDisabled(s, ["SKR", "SOL_LEND"], "careful")).toEqual({ SKR: 0, stORE: 20, USDC_LEND: 35, SOL_LEND: 0, hSOL: 15, cbBTC: 30 });
  });
  it("USDC_LEND disabled and every enabled leg at its max: the remainder is left unpulled (the split sums under 100)", () => {
    const r = redistributeDisabled(DEF.careful, ["SKR", "stORE", "USDC_LEND", "SOL_LEND"], "careful")!;
    expect(r).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 15, cbBTC: 30 });
    expect(sum(r)).toBe(45);
  });
  it("an enabled leg already over its max (a pin) keeps its share and takes nothing more", () => {
    const s = { SKR: 25, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 75 };
    expect(redistributeDisabled(s, ["SKR", "stORE", "SOL_LEND", "hSOL"], "careful")).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 25, SOL_LEND: 0, hSOL: 0, cbBTC: 75 });
  });
  it("leaves a split alone when nothing disabled holds a share, and answers null when nothing is enabled", () => {
    const s = { SKR: 100, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 };
    expect(redistributeDisabled(s, ["stORE"], "balanced")).toEqual(s);
    expect(redistributeDisabled(s, ["SKR", "stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC"], "balanced")).toBeNull();
  });
});

import { STORE_FLOOR, MANUAL_FLOOR, PIN_MAX } from "@/domain/split";

// R-O1 (10-21): every planting includes stORE at a guaranteed 10%, beside SKR's floor, unless stORE is switched off or disabled.
describe("the stORE floor (R-O1, 10-21)", () => {
  const STOPS3 = ["careful", "balanced", "bold"] as const;
  const OLD_DEFAULTS = { careful: split({ SKR: 60, USDC_LEND: 10, hSOL: 10, cbBTC: 20 }), balanced: split({ SKR: 45, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 }), bold: split({ SKR: 30, USDC_LEND: 20, SOL_LEND: 15, hSOL: 25, cbBTC: 10 }) };
  it("is 10, beside the manual SKR floor of 25", () => {
    expect(STORE_FLOOR).toBe(10);
    expect(MANUAL_FLOOR).toBe(25);
  });

  it("every stop default gives stORE the floor and satisfies every bound", () => {
    for (const stop of STOPS3) {
      const d = STOP_DEFAULTS[stop];
      expect(sum(d)).toBe(100);
      expect(d.stORE).toBe(STORE_FLOOR);
      expect(d.SKR).toBeGreaterThanOrEqual(STOPS[stop].floor);
      for (const a of ASSETS) {
        expect(Number.isInteger(d[a])).toBe(true);
        expect(d[a]).toBeGreaterThanOrEqual(0);
        if (a !== "SKR") expect(d[a]).toBeLessThanOrEqual(STOPS[stop].max[a]);
      }
    }
    // The 10 came from SKR down to (not below) the floor, the rest from the largest other coin (bold: SKR 30 floor 25, hSOL 25).
    expect(STOP_DEFAULTS.careful).toEqual({ SKR: 50, stORE: 10, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 20 });
    expect(STOP_DEFAULTS.balanced).toEqual({ SKR: 35, stORE: 10, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 });
    expect(STOP_DEFAULTS.bold).toEqual({ SKR: 25, stORE: 10, USDC_LEND: 20, SOL_LEND: 15, hSOL: 20, cbBTC: 10 });
  });

  describe("validatePins", () => {
    it("a stORE pin under 10 is refused as store_floor; 10 and up is fine; 0 (switched off, R346) is allowed", () => {
      expect(validatePins({ stORE: 5 }, 35)).toBe("store_floor");
      expect(validatePins({ stORE: 9 }, 25)).toBe("store_floor");
      expect(validatePins({ stORE: 10 }, 35)).toBeNull();
      expect(validatePins({ stORE: 0 }, 35)).toBeNull();
    });
    it("non-SKR pins must leave room for both floors when stORE is unpinned", () => {
      expect(validatePins({ cbBTC: 30, hSOL: 25 }, 35)).toBeNull();        // 55 = 100 - 35 - 10
      expect(validatePins({ cbBTC: 30, hSOL: 26 }, 35)).toBe("sum");       // 56 leaves no room for stORE's 10
      expect(validatePins({ cbBTC: 35, hSOL: 30, stORE: 0 }, 35)).toBeNull(); // stORE off: only SKR's floor needs room
      expect(validatePins({ stORE: 10, hSOL: 55 }, 35)).toBeNull();         // stORE pinned: its pin is its room
      expect(validatePins({ SKR: 35, hSOL: 55 }, 35)).toBeNull();           // SKR pinned, 10 left for stORE
      expect(validatePins({ SKR: 35, hSOL: 60 }, 35)).toBe("sum");
    });
  });

  describe("effectiveSplit, manager on", () => {
    it("every stop, no pins, a stop split with stORE at 0: stORE is raised to 10, SKR keeps its floor", () => {
      for (const stop of STOPS3) {
        const s = effectiveSplit({ managed: true, stop, pins: {}, stopSplit: OLD_DEFAULTS[stop] });
        expect(sum(s)).toBe(100);
        expect(s.stORE).toBe(STORE_FLOOR);
        expect(s.SKR).toBeGreaterThanOrEqual(STOPS[stop].floor);
      }
    });
    it("raises stORE from the largest free non-SKR coin first", () => {
      const s = effectiveSplit({ managed: true, stop: "balanced", pins: {}, stopSplit: split({ SKR: 45, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 }) });
      expect(s).toEqual(split({ SKR: 45, stORE: 10, USDC_LEND: 15, SOL_LEND: 10, hSOL: 10, cbBTC: 10 }));
    });
    it("then from SKR above its floor when the free coins have nothing", () => {
      const s = effectiveSplit({ managed: true, stop: "careful", pins: {}, stopSplit: split({ SKR: 100 }) });
      expect(s).toEqual(split({ SKR: 90, stORE: 10 }));
    });
    it("stORE switched off (a 0 pin, R346): no floor", () => {
      const s = effectiveSplit({ managed: true, stop: "balanced", pins: { stORE: 0 }, stopSplit: STOP_DEFAULTS.balanced });
      expect(s.stORE).toBe(0);
      expect(sum(s)).toBe(100);
    });
    it("stORE disabled (its leash leg off): no floor, its share goes the way redistributeDisabled sends it", () => {
      const old = split({ SKR: 60, USDC_LEND: 10, hSOL: 10, cbBTC: 20 });
      const s = effectiveSplit({ managed: true, stop: "careful", pins: {}, stopSplit: old, disabled: ["stORE"] });
      expect(s).toEqual(old);
    });
    it("an old stORE pin under 10 still yields 10, not a throw", () => {
      const s = effectiveSplit({ managed: true, stop: "balanced", pins: { stORE: 5 }, stopSplit: STOP_DEFAULTS.balanced });
      expect(s.stORE).toBe(10);
      expect(sum(s)).toBe(100);
      expect(s.SKR).toBeGreaterThanOrEqual(35);
    });
    it("old pins that fill everything but SKR's floor: stORE still gets 10 (the floor beats an old pin)", () => {
      const s = effectiveSplit({ managed: true, stop: "balanced", pins: { hSOL: 35, cbBTC: 30 }, stopSplit: BAL });
      expect(s.stORE).toBe(10);
      expect(s.SKR).toBe(35);
      expect(sum(s)).toBe(100);
    });
    it("a sweep of valid pins over every stop: stORE at least 10, SKR at least its floor, pins kept", () => {
      for (const stop of STOPS3) for (const c of [0, 5, 10, 20]) for (const h of [0, 15, 25]) for (const st of [undefined, 10, 15]) {
        const pins = { cbBTC: c, hSOL: h, ...(st === undefined ? {} : { stORE: st }) };
        if (validatePins(pins, STOPS[stop].floor)) continue;
        const s = effectiveSplit({ managed: true, stop, pins, stopSplit: STOP_DEFAULTS[stop] });
        expect(sum(s)).toBe(100);
        expect(s.stORE).toBeGreaterThanOrEqual(STORE_FLOOR);
        expect(s.SKR).toBeGreaterThanOrEqual(STOPS[stop].floor);
        expect([s.cbBTC, s.hSOL]).toEqual([c, h]);
        if (st !== undefined) expect(s.stORE).toBe(st);
      }
    });
  });

  describe("effectiveSplit, manager off", () => {
    it("unpinned stORE gets 10 from SKR's rest", () => {
      expect(effectiveSplit({ managed: false, stop: "balanced", pins: {}, stopSplit: BAL })).toEqual(split({ SKR: 90, stORE: 10 }));
      expect(effectiveSplit({ managed: false, stop: "bold", pins: { hSOL: 30 }, stopSplit: BAL })).toEqual(split({ SKR: 60, stORE: 10, hSOL: 30 }));
    });
    it("a stORE pin at or over 10 is the split", () => {
      expect(effectiveSplit({ managed: false, stop: "balanced", pins: { stORE: 20 }, stopSplit: BAL })).toEqual(split({ SKR: 80, stORE: 20 }));
    });
    it("an old stORE pin under 10 yields 10, taken from SKR", () => {
      expect(effectiveSplit({ managed: false, stop: "balanced", pins: { stORE: 5, cbBTC: 20 }, stopSplit: BAL })).toEqual(split({ SKR: 70, stORE: 10, cbBTC: 20 }));
    });
    it("old pins at the old room (75): SKR keeps its 25, stORE's 10 comes from the largest other pin", () => {
      const s = effectiveSplit({ managed: false, stop: "balanced", pins: { hSOL: 45, cbBTC: 30 }, stopSplit: BAL });
      expect(s).toEqual(split({ SKR: 25, stORE: 10, hSOL: 35, cbBTC: 30 }));
    });
    it("stORE disabled: no floor", () => {
      const s = effectiveSplit({ managed: false, stop: "balanced", pins: { hSOL: 30 }, stopSplit: BAL, disabled: ["stORE"] });
      expect(s.stORE).toBe(0);
      expect(s.SKR).toBe(70);
    });
    it("every valid manual pin set keeps SKR at 25 and stORE at 10", () => {
      for (const c of [0, 20, 40]) for (const h of [0, 15, 25]) for (const st of [undefined, 10, 30]) {
        const pins = { ...(c ? { cbBTC: c } : {}), ...(h ? { hSOL: h } : {}), ...(st === undefined ? {} : { stORE: st }) };
        if (validatePins(pins, MANUAL_FLOOR)) continue;
        const s = effectiveSplit({ managed: false, stop: "careful", pins, stopSplit: BAL });
        expect(sum(s)).toBe(100);
        expect(s.SKR).toBeGreaterThanOrEqual(MANUAL_FLOOR);
        expect(s.stORE).toBe(st ?? STORE_FLOOR);
      }
    });
  });

  describe("clampSplit", () => {
    it("a yesterday with stORE 0 and a model answer with stORE 0: stORE comes out at 10 (the floor beats the move limit)", () => {
      for (const stop of STOPS3) {
        const y = OLD_DEFAULTS[stop];   // the defaults before R-O1: stORE 0
        const s = clampSplit({ stop, proposed: y, noData: [], yesterday: y })!;
        expect(s).not.toBeNull();
        expect(s.stORE).toBe(STORE_FLOOR);
        expect(s.SKR).toBeGreaterThanOrEqual(STOPS[stop].floor);
        expect(sum(s)).toBe(100);
      }
    });
    it("no yesterday, stORE 0 proposed: raised to 10", () => {
      const s = clampSplit({ stop: "bold", proposed: split({ SKR: 25, hSOL: 35, USDC_LEND: 20, cbBTC: 20 }), noData: [], yesterday: null })!;
      expect(s.stORE).toBe(10);
      expect(s.SKR).toBeGreaterThanOrEqual(25);
      expect(sum(s)).toBe(100);
    });
    it("stORE with no data and a yesterday of 0 is still held at the floor", () => {
      const y = split({ SKR: 45, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 });
      const s = clampSplit({ stop: "balanced", proposed: y, noData: ["stORE"], yesterday: y })!;
      expect(s.stORE).toBe(10);
      expect(sum(s)).toBe(100);
    });
    it("a stORE above the floor can still fall, but not under 10", () => {
      const y = split({ SKR: 45, stORE: 15, USDC_LEND: 15, hSOL: 15, cbBTC: 10 });
      const s = clampSplit({ stop: "balanced", proposed: split({ SKR: 55, USDC_LEND: 15, hSOL: 20, cbBTC: 10 }), noData: [], yesterday: y })!;
      expect(s.stORE).toBe(10);
    });
  });

  describe("fallbackSplit", () => {
    it("stORE gets the floor before the growth-ranked fill, even with no growth number", () => {
      const s = fallbackSplit({ stop: "careful", growth: { hSOL: 7.2, USDC_LEND: 6.1, SOL_LEND: 5.9, stORE: null, cbBTC: 0 }, noData: [], yesterday: null });
      expect(s.stORE).toBe(10);
      expect(s.SKR).toBeGreaterThanOrEqual(50);
      expect(sum(s)).toBe(100);
    });
    it("the floor is set aside before the fill, so the top-growth coin keeps its full max", () => {
      // By hand: careful, SKR 50, stORE 10, 40 left: cbBTC (9) takes its max 30, USDC_LEND (8) the last 10. Seeding stORE only in
      // the clamp would take its 10 from SKR and then from the largest coin, cutting cbBTC to 20.
      const s = fallbackSplit({ stop: "careful", growth: { cbBTC: 9, USDC_LEND: 8, hSOL: 7, SOL_LEND: 6 }, noData: [], yesterday: null });
      expect(s).toEqual(split({ SKR: 50, stORE: 10, USDC_LEND: 10, cbBTC: 30 }));
    });
    it("every stop, any growth order: stORE at least 10", () => {
      for (const stop of STOPS3) for (const g of [{ hSOL: 9, cbBTC: 8 }, { USDC_LEND: 5 }, { stORE: 1, hSOL: 2, SOL_LEND: 3 }]) {
        const s = fallbackSplit({ stop, growth: g, noData: [], yesterday: null });
        expect(s.stORE).toBeGreaterThanOrEqual(10);
        expect(s.SKR).toBeGreaterThanOrEqual(STOPS[stop].floor);
        expect(sum(s)).toBe(100);
      }
    });
    it("with yesterday at stORE 0: the move limit still lets it reach 10", () => {
      const y = split({ SKR: 45, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 });
      const s = fallbackSplit({ stop: "balanced", growth: { hSOL: 7 }, noData: [], yesterday: y });
      expect(s.stORE).toBe(10);
      expect(sum(s)).toBe(100);
    });
  });
});
