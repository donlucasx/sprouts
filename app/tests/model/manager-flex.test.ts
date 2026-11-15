import { describe, it, expect } from "vitest";
import { ASSETS, type LiveAsset, type Pins, type Split, type Stop } from "@/lib/coins";
import {
  STOP_LINE, ROWS_LINE, STORE_FLOOR_LINE, STOP_MAX, STORE_FLOOR,
  manualSplit, managedPreview, managedPins, setCoinOn, setManualCoinOn, offCoins, stepPin, canStepUp, canSwitchOff, restLine, splitRows,
  type RulesView,
} from "@/model/manager";
import golden from "../fixtures/split-parity-golden.json";

// Coin flexibility (11-15): the app's mirror of api/src/domain/split.ts. Every split literal below is copied from the API's own
// test, api/tests/domain/split-flex.test.ts (Task 1); the golden file is the API's effectiveSplit run over a seeded sweep
// (tests/fixtures/gen-split-parity.mts; regenerate whenever api/src/domain/split.ts changes).
const split = (p: Partial<Split>): Split => ({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0, ...p });
const sum = (s: Split) => ASSETS.reduce((t, a) => t + s[a], 0);
// The API's STOP_DEFAULTS (api/src/domain/split.ts).
const STOP_DEFAULTS: Record<Stop, Split> = {
  careful: { SKR: 50, stORE: 10, USDC_LEND: 10, SOL_LEND: 0, hSOL: 10, cbBTC: 20 },
  balanced: { SKR: 35, stORE: 10, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 },
  bold: { SKR: 25, stORE: 10, USDC_LEND: 20, SOL_LEND: 15, hSOL: 20, cbBTC: 10 },
};
const CAREFUL = STOP_DEFAULTS.careful;
const view = (p: Partial<RulesView>): RulesView => ({ managed: false, stop: "balanced", pins: {}, allocation: split({ SKR: 100 }), ...p });

describe("manualSplit equals the API's effectiveSplit, manager off (split-flex.test.ts)", () => {
  it("SKR off: the rest goes to USDC lending", () => {
    expect(manualSplit({ SKR: 0, cbBTC: 30, USDC_LEND: 40, stORE: 0 })).toEqual(split({ USDC_LEND: 70, cbBTC: 30 }));
  });
  it("SKR and USDC lending off: the rest goes to the largest on coin", () => {
    expect(manualSplit({ SKR: 0, USDC_LEND: 0, stORE: 0, cbBTC: 30, hSOL: 20 })).toEqual(split({ cbBTC: 80, hSOL: 20 }));
  });
  it("SKR off, stORE on and unpinned: stORE keeps its default 10, USDC lending the rest", () => {
    expect(manualSplit({ SKR: 0, cbBTC: 50 })).toEqual(split({ stORE: 10, USDC_LEND: 40, cbBTC: 50 }));
  });
  it("a stORE pin under 10 wins over the default", () => {
    expect(manualSplit({ stORE: 5 })).toEqual(split({ SKR: 95, stORE: 5 }));
  });
  it("pins that leave stORE's default no room: it comes from the largest other pin", () => {
    expect(manualSplit({ SKR: 0, hSOL: 75, cbBTC: 25 })).toEqual(split({ stORE: 10, hSOL: 65, cbBTC: 25 }));
    expect(manualSplit({ SKR: 0, stORE: 0, hSOL: 75, cbBTC: 25 })).toEqual(split({ hSOL: 75, cbBTC: 25 }));
  });
});

describe("managedPreview equals the API's effectiveSplit, manager on (split-flex.test.ts)", () => {
  it("careful, SKR off: SKR 0, sums to 100, inside the stop maxes, stORE at its default", () => {
    const s = managedPreview(CAREFUL, { SKR: 0 }, "careful");
    expect(s).toEqual(split({ stORE: 10, USDC_LEND: 30, SOL_LEND: 15, hSOL: 15, cbBTC: 30 }));   // the API's answer (tsx, 11-15)
    for (const a of ASSETS) if (a !== "SKR") expect(s[a]).toBeLessThanOrEqual(STOP_MAX.careful[a]);
    expect(s.stORE).toBeGreaterThanOrEqual(STORE_FLOOR);
  });
  it("careful, SKR pinned 10: exactly 10, no lift to the stop's 50", () => {
    expect(managedPreview(CAREFUL, { SKR: 10 }, "careful")).toEqual(split({ SKR: 10, stORE: 10, USDC_LEND: 26, SOL_LEND: 9, hSOL: 15, cbBTC: 30 }));
  });
  it("SKR pinned 10 and the free coins cannot hold the rest: SKR stays 10", () => {
    const a = managedPreview(split({ SKR: 100 }), { SKR: 10 }, "careful");
    expect(a.SKR).toBe(10);
    expect(sum(a)).toBe(100);
    expect(managedPreview(CAREFUL, { SKR: 10, hSOL: 0, cbBTC: 0 }, "careful")).toEqual(split({ SKR: 10, stORE: 10, USDC_LEND: 65, SOL_LEND: 15 }));
  });
  it("off coins stay 0 across every stop and every single coin switched off, both modes", () => {
    for (const stop of ["careful", "balanced", "bold"] as const) for (const off of ASSETS) {
      for (const s of [managedPreview(STOP_DEFAULTS[stop], { [off]: 0 }, stop), manualSplit({ [off]: 0 })]) {
        expect(s[off]).toBe(0);
        expect(sum(s)).toBe(100);
      }
    }
  });
  it("stORE never donates to itself: the three reproduced literals", () => {
    expect(managedPreview(CAREFUL, { SKR: 30, USDC_LEND: 65, SOL_LEND: 0, hSOL: 0, cbBTC: 0 }, "careful")).toEqual(split({ SKR: 30, stORE: 10, USDC_LEND: 60 }));
    expect(managedPreview(CAREFUL, { SKR: 0, USDC_LEND: 50, cbBTC: 45, SOL_LEND: 0, hSOL: 0 }, "careful")).toEqual(split({ stORE: 10, USDC_LEND: 45, cbBTC: 45 }));
    expect(managedPreview(STOP_DEFAULTS.balanced, { SKR: 10, SOL_LEND: 10, cbBTC: 75, USDC_LEND: 0, hSOL: 0 }, "balanced")).toEqual(split({ SKR: 10, stORE: 10, SOL_LEND: 10, cbBTC: 70 }));
  });
  it("the combinations sweep: manager on/off x SKR x stORE x USDC lending on/off", () => {
    for (const managed of [true, false]) for (const stop of ["careful", "balanced", "bold"] as const) for (const skr of [true, false]) for (const st of [true, false]) for (const usdc of [true, false]) for (const h of [undefined, 20]) {
      const pins: Pins = { ...(skr ? {} : { SKR: 0 }), ...(st ? {} : { stORE: 0 }), ...(usdc ? {} : { USDC_LEND: 0 }), ...(h === undefined ? {} : { hSOL: h }) };
      const s = managed ? managedPreview(STOP_DEFAULTS[stop], pins, stop) : manualSplit(pins);
      expect(sum(s)).toBe(100);
      for (const c of ASSETS) if (pins[c] === 0) expect(s[c]).toBe(0);
      if (h !== undefined) expect(s.hSOL).toBe(!managed && !skr && !usdc ? 100 - s.stORE : h);
    }
  });
});

describe("parity with the API over its own seeded sweep (split-parity-golden.json)", () => {
  type Case = { managed: boolean; stop: Stop; pins: Pins; stopSplit: Split; want: Split };
  it("every case, both modes, SKR switched off included", () => {
    const cases = golden as Case[];
    expect(cases.length).toBe(1200);
    expect(cases.filter((c) => c.pins.SKR === 0).length).toBeGreaterThan(100);
    cases.forEach((c, i) =>
      expect(c.managed ? managedPreview(c.stopSplit, c.pins, c.stop) : manualSplit(c.pins), `case ${i}`).toEqual(c.want));
  });
});

describe("switches (A3, A14)", () => {
  it("managedPins keeps a SKR 0 pin", () => {
    expect(managedPins({ SKR: 0, cbBTC: 30 })).toEqual({ SKR: 0 });
  });
  it("setCoinOn switches SKR off and back on", () => {
    expect(setCoinOn({}, "SKR", false)).toEqual({ SKR: 0 });
    expect(setCoinOn({ SKR: 0, hSOL: 0 }, "SKR", true)).toEqual({ hSOL: 0 });
  });
  it("managedPreview with SKR off plants no SKR", () => {
    expect(managedPreview(CAREFUL, { SKR: 0 }, "careful").SKR).toBe(0);
  });
  it("setManualCoinOn switches SKR off and back on", () => {
    expect(setManualCoinOn({}, "SKR", false)).toEqual({ SKR: 0 });
    expect(setManualCoinOn({ SKR: 0, hSOL: 20 }, "SKR", true)).toEqual({ hSOL: 20 });
  });
  it("offCoins lists every 0 pin, SKR included", () => {
    expect(offCoins({ SKR: 0 })).toEqual(["SKR"]);
    expect(offCoins({ SKR: 0, stORE: 0, hSOL: 20 })).toEqual(["SKR", "stORE"]);
  });
  it("canSwitchOff is false only for the last coin on", () => {
    const allOffBut = (c: LiveAsset): Pins => Object.fromEntries(ASSETS.filter((a) => a !== c).map((a) => [a, 0]));
    for (const managed of [true, false]) {
      expect(canSwitchOff(view({ managed, pins: allOffBut("cbBTC") }), "cbBTC")).toBe(false);
      expect(canSwitchOff(view({ managed, pins: allOffBut("SKR") }), "SKR")).toBe(false);
      expect(canSwitchOff(view({ managed, pins: { ...allOffBut("cbBTC"), hSOL: 20 } }), "cbBTC")).toBe(true);
      expect(canSwitchOff(view({ managed, pins: {} }), "SKR")).toBe(true);
    }
  });
});

describe("steppers without minimums", () => {
  it("stORE steps down from its default 10 to a pin of 5 and stops there (off is the switch)", () => {
    expect(stepPin({}, "stORE", -1)).toEqual({ stORE: 5 });
    expect(stepPin({ stORE: 5 }, "stORE", -1)).toEqual({ stORE: 5 });
    expect(stepPin({ stORE: 10 }, "stORE", -1)).toEqual({ stORE: 5 });
    expect(stepPin({}, "stORE", 1)).toEqual({ stORE: 15 });
    expect(stepPin({ stORE: 0 }, "stORE", -1)).toEqual({ stORE: 0 });   // an off stORE stays off
  });
  it("canStepUp has no SKR quarter: 75 is the coin's own max", () => {
    expect(canStepUp(view({ pins: { cbBTC: 70 } }), "cbBTC")).toBe(true);
    expect(canStepUp(view({ pins: { cbBTC: 75 } }), "cbBTC")).toBe(false);
    // stORE's default still counts while it is on and unpinned, so a pin the user sets is planted as set.
    expect(canStepUp(view({ pins: { hSOL: 75, cbBTC: 15 } }), "cbBTC")).toBe(false);
    expect(canStepUp(view({ pins: { hSOL: 75, cbBTC: 10 } }), "cbBTC")).toBe(true);
    expect(canStepUp(view({ pins: { hSOL: 75, cbBTC: 15, stORE: 0 } }), "cbBTC")).toBe(true);
    expect(canStepUp(view({ pins: { hSOL: 75, cbBTC: 15, stORE: 5 } }), "cbBTC")).toBe(true);
  });
});

describe("rows and the rest line", () => {
  it("manager off: SKR reads off at a 0 pin, else the rest", () => {
    expect(splitRows(view({ pins: { SKR: 0, cbBTC: 30 } }))[0]).toEqual({ asset: "SKR", pct: 0, mode: "off", bound: null });
    expect(splitRows(view({ pins: { cbBTC: 30 } }))[0]).toEqual({ asset: "SKR", pct: 60, mode: "the rest", bound: null });
  });
  it("manager on: SKR reads off at a 0 pin, else auto and aims for the stop's share", () => {
    const on = view({ managed: true, stop: "careful", allocation: split({ SKR: 70, hSOL: 30 }) });
    expect(splitRows({ ...on, pins: { SKR: 0 } })[0]).toEqual({ asset: "SKR", pct: 0, mode: "off", bound: null });
    expect(splitRows(on)[0]).toEqual({ asset: "SKR", pct: 70, mode: "auto", bound: "aims for 50%" });
  });
  it("manager off, SKR off: the coin that takes the rest reads 'the rest' with its total, and has no stepper row mode", () => {
    const rows = splitRows(view({ pins: { SKR: 0, cbBTC: 30, USDC_LEND: 40, stORE: 0 } }));
    expect(rows.find((x) => x.asset === "USDC_LEND")).toEqual({ asset: "USDC_LEND", pct: 70, mode: "the rest", bound: null });
    expect(rows.find((x) => x.asset === "cbBTC")!.mode).toBe("pinned");
    expect(rows.find((x) => x.asset === "SKR")!.mode).toBe("off");
  });
  it("restLine: N is the leftover even when stORE is the rest coin", () => {
    expect(restLine(view({ pins: { SKR: 0, USDC_LEND: 0, stORE: 20, cbBTC: 5 } }))).toBe("The rest, 75%, goes to stORE.");
  });
  it("restLine: manager off and SKR off, the share the rest coin takes, net of stORE's default", () => {
    expect(restLine(view({ pins: { SKR: 0, cbBTC: 30, stORE: 0 } }))).toBe("The rest, 70%, goes to USDC lending.");
    expect(restLine(view({ pins: { SKR: 0, cbBTC: 50 } }))).toBe("stORE starts at 10%. The rest, 40%, goes to USDC lending.");
    expect(restLine(view({ pins: { SKR: 0, USDC_LEND: 0, stORE: 0, cbBTC: 30, hSOL: 20 } }))).toBe("The rest, 50%, goes to cbBTC.");
    expect(restLine(view({ pins: { SKR: 0, cbBTC: 30, USDC_LEND: 40, stORE: 0 } }))).toBe("The rest, 30%, goes to USDC lending.");
  });
  it("restLine is null with nothing left over, with SKR on, or with the manager on", () => {
    expect(restLine(view({ pins: { SKR: 0, hSOL: 75, cbBTC: 25 } }))).toBeNull();
    expect(restLine(view({ pins: { cbBTC: 30 } }))).toBeNull();
    expect(restLine(view({ managed: true, pins: { SKR: 0 } }))).toBeNull();
  });
});

describe("copy", () => {
  it("the stop line, the rows line, the stORE line", () => {
    expect(STOP_LINE).toBe("Careful aims for about 50% in SKR, Balanced 35%, Bold 25%.");
    expect(ROWS_LINE).toEqual({ on: "Switch a coin off and the manager won't buy it. Keep at least one on.", off: "Set your own split. Switch a coin off and Sprouts won't buy it." });
    expect(STORE_FLOOR_LINE).toEqual({ on: "stORE starts at 10% until you change it.", off: "stORE starts at 10% until you change it." });
    for (const s of [STOP_LINE, ROWS_LINE.on, ROWS_LINE.off, STORE_FLOOR_LINE.on]) expect(s).not.toMatch(/—/);
  });
});
