import { describe, it, expect } from "vitest";
import { ASSETS, zeroSplit, type LiveAsset, type Split } from "@/domain/coins";
import { STOPS, STOP_DEFAULTS, STORE_FLOOR, PIN_MAX, isOn, restCoin, validatePins, effectiveSplit, withStoreFloor, redistributeDisabled } from "@/domain/split";
import { pickAsset } from "@/domain/allocation";

// Coin flexibility (11-15): any coin can be switched off (a 0 pin), no coin has a user-facing minimum, stORE's 10% is a default.
const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });
const sum = (s: Split) => ASSETS.reduce((t, a) => t + s[a], 0);
const zero = zeroSplit();
const CAREFUL = STOP_DEFAULTS.careful;

describe("isOn and restCoin", () => {
  it("a coin is off only at a 0 pin", () => {
    expect(isOn({ SKR: 0 }, "SKR")).toBe(false);
    expect(isOn({}, "SKR")).toBe(true);
    expect(isOn({ SKR: 5 }, "SKR")).toBe(true);
  });
  it("SKR, else USDC_LEND, else the largest share (ASSETS order on ties); null with nothing on", () => {
    expect(restCoin(["SKR", "USDC_LEND", "cbBTC"], split({ cbBTC: 90 }))).toBe("SKR");
    expect(restCoin(["USDC_LEND", "cbBTC"], split({ cbBTC: 90 }))).toBe("USDC_LEND");
    expect(restCoin(["hSOL", "cbBTC"], split({ hSOL: 20, cbBTC: 30 }))).toBe("cbBTC");
    expect(restCoin(["SOL_LEND", "hSOL"], split({ SOL_LEND: 15, hSOL: 15 }))).toBe("SOL_LEND");
    expect(restCoin([], split({ SKR: 100 }))).toBeNull();
  });
  it("with pins: an on coin without a pin first; every on coin pinned, the largest on coin", () => {
    expect(restCoin(["SKR", "USDC_LEND", "hSOL"], split({ SKR: 10 }), ["SKR"])).toBe("USDC_LEND");
    expect(restCoin(["SKR", "hSOL"], split({ SKR: 10, hSOL: 40 }), ["SKR", "hSOL"])).toBe("hSOL");
  });
});

describe("validatePins without minimums", () => {
  it("none_on, range, sum; a low SKR pin is fine", () => {
    expect(validatePins({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 })).toBe("none_on");
    expect(validatePins({ SKR: 5 })).toBeNull();
    expect(validatePins({ stORE: 101 })).toBe("range");
    expect(validatePins({ USDC_LEND: 100 })).toBeNull();   // owner 11-15: 100% for every coin
    expect(validatePins({ stORE: 100 })).toBeNull();
    expect(validatePins({ USDC_LEND: 60, cbBTC: 50 })).toBe("sum");
  });
});

describe("effectiveSplit, manager off", () => {
  const manual = (pins: Record<string, number>) => effectiveSplit({ managed: false, stop: "careful", pins, stopSplit: CAREFUL });
  it("one coin at 100 (owner 11-15): USDC lending 100 with SKR off and stORE pinned 0 is that coin alone; with stORE unpinned its default 10 comes off it", () => {
    expect(manual({ USDC_LEND: 100, SKR: 0 })).toEqual(split({ USDC_LEND: 90, stORE: 10 }));   // stORE unpinned keeps its default 10, from the largest pin
    expect(manual({ USDC_LEND: 100, SKR: 0, stORE: 0 })).toEqual(split({ USDC_LEND: 100 }));
  });
  it("SKR off: the rest goes to USDC lending", () => {
    const s = manual({ SKR: 0, cbBTC: 30, USDC_LEND: 40, stORE: 0 });
    expect(s).toEqual(split({ USDC_LEND: 70, cbBTC: 30 }));
    expect(sum(s)).toBe(100);
  });
  it("SKR and USDC lending off: the rest goes to the largest on coin", () => {
    expect(manual({ SKR: 0, USDC_LEND: 0, stORE: 0, cbBTC: 30, hSOL: 20 })).toEqual(split({ cbBTC: 80, hSOL: 20 }));
  });
  it("SKR on, stORE pinned at 10 with cbBTC 75 (the app plants stORE's 10 with a change): the pins are exact, SKR the rest", () => {
    expect(manual({ cbBTC: 75, stORE: 10 })).toEqual(split({ cbBTC: 75, stORE: 10, SKR: 15 }));
  });
  it("SKR off, stORE on and unpinned: stORE keeps its default 10, USDC lending the rest", () => {
    expect(manual({ SKR: 0, cbBTC: 50 })).toEqual(split({ stORE: 10, USDC_LEND: 40, cbBTC: 50 }));
  });
  it("a stORE pin under 10 wins over the default", () => {
    expect(manual({ stORE: 5 })).toEqual(split({ SKR: 95, stORE: 5 }));
  });
  it("pins that leave stORE's default no room: it comes from the largest other pin (as R-O1 did)", () => {
    expect(manual({ SKR: 0, hSOL: 75, cbBTC: 25 })).toEqual(split({ stORE: 10, hSOL: 65, cbBTC: 25 }));
    expect(manual({ SKR: 0, stORE: 0, hSOL: 75, cbBTC: 25 })).toEqual(split({ hSOL: 75, cbBTC: 25 }));
  });
});

describe("effectiveSplit, manager on", () => {
  it("careful, SKR off: SKR 0, sums to 100, coins inside their stop max but the rest coin, stORE at its default", () => {
    const s = effectiveSplit({ managed: true, stop: "careful", pins: { SKR: 0 }, stopSplit: CAREFUL });
    expect(s.SKR).toBe(0);
    expect(sum(s)).toBe(100);
    const rc = restCoin(ASSETS.filter((c) => c !== "SKR"), s);
    for (const a of ASSETS) if (a !== "SKR" && a !== rc) expect(s[a]).toBeLessThanOrEqual(STOPS.careful.max[a]);
    expect(s.stORE).toBeGreaterThanOrEqual(STORE_FLOOR);
  });
  it("careful, SKR pinned 10: exactly 10, no lift to the stop's 50", () => {
    const s = effectiveSplit({ managed: true, stop: "careful", pins: { SKR: 10 }, stopSplit: CAREFUL });
    expect(s.SKR).toBe(10);
    expect(sum(s)).toBe(100);
  });
  it("SKR pinned 10 and the free coins cannot hold the rest: SKR stays 10, the overflow goes to an unpinned on coin", () => {
    // A stop split with every free coin at 0 weight.
    const a = effectiveSplit({ managed: true, stop: "careful", pins: { SKR: 10 }, stopSplit: split({ SKR: 100 }) });
    expect(a.SKR).toBe(10);
    expect(sum(a)).toBe(100);
    // Free coins whose maxes add up to less than the rest (stORE 10 + USDC_LEND 30 + SOL_LEND 15 = 55 of 90): USDC lending takes 35 more.
    const b = effectiveSplit({ managed: true, stop: "careful", pins: { SKR: 10, hSOL: 0, cbBTC: 0 }, stopSplit: CAREFUL });
    expect(b).toEqual(split({ SKR: 10, stORE: 10, USDC_LEND: 65, SOL_LEND: 15 }));
  });
  it("off coins stay 0 across every stop and every single coin switched off", () => {
    for (const stop of ["careful", "balanced", "bold"] as const) for (const off of ASSETS) for (const managed of [true, false]) {
      const s = effectiveSplit({ managed, stop, pins: { [off]: 0 }, stopSplit: STOP_DEFAULTS[stop] });
      expect(s[off]).toBe(0);
      expect(sum(s)).toBe(100);
    }
  });
});

describe("redistributeDisabled with the user's off coins", () => {
  it("an off SKR never receives; the overflow goes to USDC lending", () => {
    const r = redistributeDisabled({ ...zero, cbBTC: 100 }, ["cbBTC"], "careful", ["SKR"])!;
    expect(r.SKR).toBe(0);
    expect(sum(r)).toBe(100);
  });
  it("null when no enabled coin is on", () => {
    expect(redistributeDisabled(CAREFUL, ["USDC_LEND"], "careful", ["SKR", "stORE", "SOL_LEND", "hSOL", "cbBTC"])).toBeNull();
  });
  it("an off coin's stale share is zeroed and handed on", () => {
    const r = redistributeDisabled(split({ SKR: 40, cbBTC: 60 }), [], "careful", ["SKR"])!;
    expect(r.SKR).toBe(0);
    expect(sum(r)).toBe(100);
  });
  it("USDC lending disabled too and every on coin at its max: the largest on coin takes the rest, the target sums to 100", () => {
    const r = redistributeDisabled(CAREFUL, ["SKR", "stORE", "USDC_LEND", "SOL_LEND"], "careful")!;
    expect(r).toEqual(split({ hSOL: 15, cbBTC: 85 }));
  });
});

describe("withStoreFloor and a stORE pin", () => {
  it("a stORE pin returns the input", () => {
    const s = { ...zero, SKR: 95, stORE: 5 };
    expect(withStoreFloor(s, { skrFloor: 25, off: false, pinned: true })).toEqual(s);
  });
});

describe("pickAsset", () => {
  it("an empty target answers null", () => {
    expect(pickAsset({}, zeroSplit())).toBeNull();
  });
});

// Every on/off combination of SKR, stORE and USDC lending, both modes: sums to 100, off coins at 0, pins kept.
describe("the combinations sweep", () => {
  it("manager on/off x SKR on/off x stORE on/off x USDC lending on/off", () => {
    for (const managed of [true, false]) for (const stop of ["careful", "balanced", "bold"] as const) for (const skr of [true, false]) for (const st of [true, false]) for (const usdc of [true, false]) for (const h of [undefined, 20]) {
      const pins: Partial<Record<LiveAsset, number>> = { ...(skr ? {} : { SKR: 0 }), ...(st ? {} : { stORE: 0 }), ...(usdc ? {} : { USDC_LEND: 0 }), ...(h === undefined ? {} : { hSOL: h }) };
      const s = effectiveSplit({ managed, stop, pins, stopSplit: STOP_DEFAULTS[stop] });
      expect(sum(s)).toBe(100);
      for (const c of ASSETS) if (pins[c] === 0) expect(s[c]).toBe(0);
      // A pin is exact, except manager off with SKR and USDC lending off: hSOL (20) is then the largest on coin and takes the rest.
      if (h !== undefined) expect(s.hSOL).toBe(!managed && !skr && !usdc ? 100 - s.stORE : h);
    }
  });
});

// Review fix 1 (11-15): stORE as the only free on coin with R < 10 made the fallback's raiseStore use stORE as its own donor (105).
describe("stORE never donates to itself", () => {
  it("the three reproduced literals sum to 100", () => {
    const a = effectiveSplit({ managed: true, stop: "careful", pins: { SKR: 30, USDC_LEND: 65, SOL_LEND: 0, hSOL: 0, cbBTC: 0 }, stopSplit: CAREFUL });
    const b = effectiveSplit({ managed: true, stop: "careful", pins: { SKR: 0, USDC_LEND: 50, cbBTC: 45, SOL_LEND: 0, hSOL: 0 }, stopSplit: CAREFUL });
    const c = effectiveSplit({ managed: true, stop: "balanced", pins: { SKR: 10, SOL_LEND: 10, cbBTC: 75, USDC_LEND: 0, hSOL: 0 }, stopSplit: STOP_DEFAULTS.balanced });
    for (const s of [a, b, c]) {
      expect(sum(s)).toBe(100);
      expect(s.stORE).toBe(10);
    }
    expect(a).toEqual(split({ SKR: 30, stORE: 10, USDC_LEND: 60 }));
  });
  it("a seeded random sweep of pin sets (SKR pins too), both modes, random disabled legs: sums to 100, no off coin above 0", () => {
    let seed = 20261115;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    let checked = 0;
    for (let i = 0; i < 6000; i++) {
      const stop = (["careful", "balanced", "bold"] as const)[rnd(3)];
      const pins: Partial<Record<LiveAsset, number>> = {};
      if (i % 2 === 0) {
        let room = 100;
        for (const c of ASSETS) {
          const k = rnd(4);   // 0: free, 1: off, 2-3: a pin
          if (k === 1) pins[c] = 0;
          else if (k >= 2) {
            const v = rnd(Math.min(PIN_MAX[c], room) + 1);
            pins[c] = v;
            room -= v;
          }
        }
      } else {
        // stORE the only free coin and a rest R of 0..9: every other coin pinned (0 = off), the pins summing to 100 - R.
        let left = 100 - rnd(10);
        for (const c of ASSETS) {
          if (c === "stORE") continue;
          const v = rnd(3) === 0 ? 0 : Math.min(PIN_MAX[c], left, 1 + rnd(left + 1));
          pins[c] = v;
          left -= v;
        }
        if (left > 0) continue;
      }
      if (validatePins(pins)) continue;
      checked++;
      const disabled = ASSETS.filter(() => rnd(5) === 0);
      for (const managed of [true, false]) {
        const s = effectiveSplit({ managed, stop, pins, stopSplit: STOP_DEFAULTS[stop] });
        expect(sum(s)).toBe(100);
        for (const c of ASSETS) if (pins[c] === 0) expect(s[c]).toBe(0);
        const userOff = ASSETS.filter((c) => pins[c] === 0);
        const r = redistributeDisabled(s, disabled, stop, userOff);
        if (r === null) expect(ASSETS.every((c) => disabled.includes(c) || userOff.includes(c))).toBe(true);
        else {
          expect(sum(r)).toBeCloseTo(100, 9);
          for (const c of [...userOff, ...disabled]) expect(r[c]).toBe(0);
        }
        const d = effectiveSplit({ managed, stop, pins, stopSplit: STOP_DEFAULTS[stop], disabled });
        expect(sum(d)).toBeCloseTo(100, 9);
        for (const c of userOff) expect(d[c]).toBe(0);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
