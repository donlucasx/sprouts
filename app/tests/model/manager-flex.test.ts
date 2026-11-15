import { describe, it, expect } from "vitest";
import { ASSETS, type LiveAsset, type Pins, type Split, type Stop } from "@/lib/coins";
import {
  STOP_LINE, ROWS_LINE, STORE_FLOOR_LINE, STOP_MAX, STORE_FLOOR,
  manualSplit, managedPreview, managedPins, setCoinOn, setManualCoinOn, offCoins, stepPin, canStepUp, canSwitchOff, splitRows,
  explicitPins, draftShares, splitTotal, pinsToSave,
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
  it("setManualCoinOn switches SKR off and back on (addendum 11-15: nothing else moves; on starts at 0)", () => {
    expect(setManualCoinOn({ SKR: 90, stORE: 10 }, "SKR", false)).toEqual({ SKR: 0, stORE: 10 });
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

// Addendum 11-15 (owner rulings): manager off, no "rest". Every on coin has its own number; the total must be exactly 100 to save.
describe("manager off, no rest: the draft pins every on coin at its shown share", () => {
  it("explicitPins: an untouched user's SKR 90 / stORE 10 become pins; an off coin stays 0; a 0 share is on and unpinned", () => {
    expect(explicitPins({})).toEqual({ SKR: 90, stORE: 10 });
    expect(explicitPins({ cbBTC: 30 })).toEqual({ SKR: 60, stORE: 10, cbBTC: 30 });
    expect(explicitPins({ hSOL: 40, cbBTC: 35 })).toEqual({ SKR: 25, stORE: 10, hSOL: 30, cbBTC: 35 });
    expect(explicitPins({ SKR: 0, cbBTC: 30, USDC_LEND: 40, stORE: 0 })).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 70, cbBTC: 30 });
  });
  it("draftShares reads the draft as it is: an unpinned on coin is 0, nothing takes a rest", () => {
    expect(draftShares({ SKR: 85, stORE: 10 })).toEqual(split({ SKR: 85, stORE: 10 }));
    expect(draftShares({ SKR: 0, cbBTC: 30 })).toEqual(split({ cbBTC: 30 }));
    for (const pins of [{}, { cbBTC: 30 }, { SKR: 0, cbBTC: 50 }, { stORE: 0, hSOL: 40 }] as Pins[])
      expect(draftShares(explicitPins(pins))).toEqual(manualSplit(pins));
  });
  it("'+' raises only that coin, '-' lowers only that coin; nothing else moves", () => {
    expect(stepPin({ SKR: 90, stORE: 10 }, "SKR", -1)).toEqual({ SKR: 85, stORE: 10 });
    expect(stepPin({ SKR: 90, stORE: 10 }, "cbBTC", 1)).toEqual({ SKR: 90, stORE: 10, cbBTC: 5 });
    expect(stepPin({ SKR: 90, stORE: 10 }, "stORE", 1)).toEqual({ SKR: 90, stORE: 15 });
  });
  it("'-' goes down to 0 and the coin stays on (unpinned, not a 0 pin); SKR and stORE too", () => {
    expect(stepPin({ SKR: 5, stORE: 10 }, "SKR", -1)).toEqual({ stORE: 10 });
    expect(stepPin({ SKR: 90, stORE: 5 }, "stORE", -1)).toEqual({ SKR: 90 });
    expect(stepPin({ SKR: 90 }, "stORE", -1)).toEqual({ SKR: 90 });   // already 0: nothing
  });
  it("'+' stops at the coin's pin max; an off coin is not stepped", () => {
    expect(stepPin({ cbBTC: 100 }, "cbBTC", 1)).toEqual({ cbBTC: 100 });
    expect(stepPin({ stORE: 100 }, "stORE", 1)).toEqual({ stORE: 100 });
    expect(stepPin({ USDC_LEND: 95 }, "USDC_LEND", 1)).toEqual({ USDC_LEND: 100 });   // owner 11-15: 100% for every coin
    expect(stepPin({ SKR: 100 }, "SKR", 1)).toEqual({ SKR: 100 });
    expect(stepPin({ stORE: 0, SKR: 100 }, "stORE", 1)).toEqual({ stORE: 0, SKR: 100 });
    expect(stepPin({ stORE: 0, SKR: 100 }, "stORE", -1)).toEqual({ stORE: 0, SKR: 100 });
  });
  it("switching a coin off drops its share; switching it on starts it at 0; nothing else moves", () => {
    expect(setManualCoinOn({ SKR: 60, stORE: 10, cbBTC: 30 }, "cbBTC", false)).toEqual({ SKR: 60, stORE: 10, cbBTC: 0 });
    expect(setManualCoinOn({ SKR: 60, stORE: 0, cbBTC: 30 }, "stORE", true)).toEqual({ SKR: 60, cbBTC: 30 });
    expect(draftShares(setManualCoinOn({ SKR: 60, stORE: 0, cbBTC: 30 }, "stORE", true)).stORE).toBe(0);
  });
  it("a draft of USDC lending 100, every other coin off, totals 100 and may be saved (owner 11-15)", () => {
    const pins = { SKR: 0, stORE: 0, USDC_LEND: 100 } as Pins;
    expect(splitTotal(draftShares(explicitPins(pins)))).toEqual({ total: 100, line: "Total 100%.", fix: null, ok: true });
    expect(draftShares(pins)).toEqual(split({ USDC_LEND: 100 }));
  });
  it("canStepUp: only the coin's own pin max binds; the total may pass 100 (the total line says what to fix)", () => {
    expect(canStepUp(view({ pins: { SKR: 90, stORE: 10 } }), "cbBTC")).toBe(true);
    expect(canStepUp(view({ pins: { SKR: 95, stORE: 10 } }), "SKR")).toBe(true);
    expect(canStepUp(view({ pins: { SKR: 100 } }), "SKR")).toBe(false);
    expect(canStepUp(view({ pins: { cbBTC: 100 } }), "cbBTC")).toBe(false);
    expect(canStepUp(view({ pins: { stORE: 100 } }), "stORE")).toBe(false);
    expect(canStepUp(view({ pins: { USDC_LEND: 95 } }), "USDC_LEND")).toBe(true);
    expect(canStepUp(view({ pins: { USDC_LEND: 100 } }), "USDC_LEND")).toBe(false);
    expect(canStepUp(view({ pins: { stORE: 0 } }), "stORE")).toBe(false);   // off
  });
  it("splitTotal: 'Total N%.' and, off 100, what to fix; only 100 saves", () => {
    expect(splitTotal(split({ SKR: 90, stORE: 10 }))).toEqual({ total: 100, line: "Total 100%.", fix: null, ok: true });
    expect(splitTotal(split({ SKR: 90, stORE: 15 }))).toEqual({ total: 105, line: "Total 105%.", fix: "Take 5% from another coin to save.", ok: false });
    expect(splitTotal(split({ SKR: 80, stORE: 10 }))).toEqual({ total: 90, line: "Total 90%.", fix: "Add 10% to another coin to save.", ok: false });
    for (const s of ["Take 5% from another coin to save.", "Add 10% to another coin to save."]) expect(s).not.toMatch(/—/);
  });
  it("pinsToSave: stORE on at 0 is sent switched off (the API reads an unpinned stORE as its default 10); nothing else changes", () => {
    expect(pinsToSave({ SKR: 30, USDC_LEND: 40, cbBTC: 30 })).toEqual({ SKR: 30, USDC_LEND: 40, cbBTC: 30, stORE: 0 });
    expect(pinsToSave({ SKR: 20, stORE: 10, USDC_LEND: 40, cbBTC: 30 })).toEqual({ SKR: 20, stORE: 10, USDC_LEND: 40, cbBTC: 30 });
    expect(pinsToSave({ SKR: 100, stORE: 0 })).toEqual({ SKR: 100, stORE: 0 });
  });
});

describe("rows", () => {
  it("manager off: SKR reads off at a 0 pin, else pinned with its share (no rest)", () => {
    expect(splitRows(view({ pins: { SKR: 0, cbBTC: 30 } }))[0]).toEqual({ asset: "SKR", pct: 0, mode: "off", bound: null });
    expect(splitRows(view({ pins: { cbBTC: 30 } }))[0]).toEqual({ asset: "SKR", pct: 60, mode: "pinned", bound: null });
  });
  it("manager on: SKR reads off at a 0 pin, else auto and aims for the stop's share", () => {
    const on = view({ managed: true, stop: "careful", allocation: split({ SKR: 70, hSOL: 30 }) });
    expect(splitRows({ ...on, pins: { SKR: 0 } })[0]).toEqual({ asset: "SKR", pct: 0, mode: "off", bound: null });
    expect(splitRows(on)[0]).toEqual({ asset: "SKR", pct: 70, mode: "auto", bound: "aims for 50%" });
  });
  it("manager off, SKR off: every on coin is pinned with its share; no coin is 'the rest'", () => {
    const rows = splitRows(view({ pins: { SKR: 0, cbBTC: 30, USDC_LEND: 40, stORE: 0 } }));
    expect(rows.find((x) => x.asset === "USDC_LEND")).toEqual({ asset: "USDC_LEND", pct: 70, mode: "pinned", bound: null });
    expect(rows.find((x) => x.asset === "cbBTC")!.mode).toBe("pinned");
    expect(rows.find((x) => x.asset === "SKR")!.mode).toBe("off");
    expect(rows.every((x) => (x.mode as string) !== "the rest")).toBe(true);
  });
  it("manager off with the draft's shares: the rows read them as they are, a total off 100 included", () => {
    const pins: Pins = { SKR: 90, stORE: 15 };
    const rows = splitRows(view({ pins }), draftShares(pins));
    expect(rows.map((x) => x.pct)).toEqual([90, 15, 0, 0, 0, 0]);
    expect(rows.every((x) => x.mode === "pinned")).toBe(true);
  });
});

describe("copy", () => {
  it("the stop line, the rows line, the stORE line", () => {
    expect(STOP_LINE).toBe("Careful aims for about 50% in SKR, Balanced 35%, Bold 25%.");
    expect(ROWS_LINE).toEqual({ on: "Switch a coin off and the manager won't buy it. Keep at least one on.", off: "Set your own split. Switch a coin off and Sprouts won't buy it. Keep at least one on." });
    expect(STORE_FLOOR_LINE).toEqual({ on: "stORE starts at 10% until you change it.", off: "stORE starts at 10% until you change it." });
    for (const s of [STOP_LINE, ROWS_LINE.on, ROWS_LINE.off, STORE_FLOOR_LINE.on]) expect(s).not.toMatch(/—/);
  });
});
