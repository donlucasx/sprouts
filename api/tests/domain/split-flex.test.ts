import { describe, it, expect } from "vitest";
import { ASSETS, zeroSplit, type LiveAsset, type Split } from "@/domain/coins";
import { STOPS, STOP_DEFAULTS, STORE_FLOOR, isOn, restCoin, validatePins, effectiveSplit, withStoreFloor, redistributeDisabled } from "@/domain/split";
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
    expect(validatePins({ stORE: 60 })).toBe("range");
    expect(validatePins({ USDC_LEND: 60, cbBTC: 50 })).toBe("sum");
  });
});

describe("effectiveSplit, manager off", () => {
  const manual = (pins: Record<string, number>) => effectiveSplit({ managed: false, stop: "careful", pins, stopSplit: CAREFUL });
  it("SKR off: the rest goes to USDC lending", () => {
    const s = manual({ SKR: 0, cbBTC: 30, USDC_LEND: 40, stORE: 0 });
    expect(s).toEqual(split({ USDC_LEND: 70, cbBTC: 30 }));
    expect(sum(s)).toBe(100);
  });
  it("SKR and USDC lending off: the rest goes to the largest on coin", () => {
    expect(manual({ SKR: 0, USDC_LEND: 0, stORE: 0, cbBTC: 30, hSOL: 20 })).toEqual(split({ cbBTC: 80, hSOL: 20 }));
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
      if (h !== undefined) expect(s.hSOL).toBeGreaterThanOrEqual(h);
    }
  });
});
