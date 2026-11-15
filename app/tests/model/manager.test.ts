import { describe, it, expect } from "vitest";
import { ASSETS, type Split, type Pins, type Stop } from "@/lib/coins";
import {
  STOP_FLOOR, STOP_MAX, PIN_MAX, PIN_STEP, MANAGER_LINE, PRO_BADGE, PRO_LINE, ROWS_LINE, STOP_LINE, UNDONE_TEXT,
  splitRows, manualSplit, setCoinOn, managedPins, stepPin, canStepUp, undoLine, changeSummary, splitRowLine, pinsForOn,
} from "@/model/manager";

const split = (p: Partial<Split>): Split => ({ SKR: 0, stORE: 0, hSOL: 0, USDC_LEND: 0, SOL_LEND: 0, cbBTC: 0, ...p });
const rules = (p: Partial<Parameters<typeof splitRows>[0]>) => ({ managed: false, stop: "balanced" as const, pins: {}, allocation: split({ SKR: 100 }), ...p });

// Spec 4.1 mirrored for labels and stepper bounds; the API is the authority.
describe("the tables", () => {
  it("floors, maxes, pin maxes and the step", () => {
    expect(STOP_FLOOR).toEqual({ careful: 50, balanced: 35, bold: 25 });
    expect(STOP_MAX.careful).toEqual({ stORE: 10, USDC_LEND: 30, SOL_LEND: 15, hSOL: 15, cbBTC: 30 });
    expect(STOP_MAX.bold.cbBTC).toBe(20);
    expect(PIN_MAX).toEqual({ SKR: 100, stORE: 50, hSOL: 75, USDC_LEND: 75, SOL_LEND: 75, cbBTC: 75 });
    expect(PIN_STEP).toBe(5);
    expect(MANAGER_LINE).toBe("Each morning, Claude Haiku 5.5 reads live rates and sends your new change where it pays best. It never sells what you hold.");  // R348; 10-12 names the model, as the deck does
    expect(PRO_BADGE).toBe("Pro");
    expect(PRO_LINE).toBe("Included free during launch.");  // R347
    expect(ROWS_LINE).toEqual({ on: "Switch a coin off and the manager won't buy it. Keep at least one on.", off: "Set your own split. Switch a coin off and Sprouts won't buy it. Keep at least one on." });  // 10-23, 11-15: one coin stays on
    expect(STOP_LINE).toBe("Careful aims for about 50% in SKR, Balanced 35%, Bold 25%.");   // 11-15: the aim, not a minimum
    expect(UNDONE_TEXT).toBe("Yesterday's split is back. The AI Yield Manager is off until you turn it on.");
  });
});

describe("splitRows (spec 3.1)", () => {
  // Review Focus 1: the Saga after the migration.
  it("off: rows from a migrated stORE pin; SKR has its own number (addendum 11-15: no rest), every other coin pinned at 0", () => {
    const rows = splitRows(rules({ pins: { stORE: 50 }, allocation: split({ SKR: 50, stORE: 50 }) }));
    expect(rows.map((r) => r.asset)).toEqual([...ASSETS]);
    expect(rows[0]).toEqual({ asset: "SKR", pct: 50, mode: "pinned", bound: null });
    expect(rows[1]).toEqual({ asset: "stORE", pct: 50, mode: "pinned", bound: null });
    expect(rows[4]).toEqual({ asset: "hSOL", pct: 0, mode: "pinned", bound: null });
  });

  it("off with no pins: stORE at its default of 10 (R-O1, the run plants it), SKR 90, both with steppers", () => {
    expect(splitRows(rules({}))[0]).toEqual({ asset: "SKR", pct: 90, mode: "pinned", bound: null });
    expect(splitRows(rules({}))[1]).toEqual({ asset: "stORE", pct: 10, mode: "pinned", bound: null });
  });

  // R-O1 (10-21): the rows show what the API's effectiveSplit (off) plants, the default included.
  it("off: a stORE pin under 10 wins (11-15, a default); old pins that crowd SKR's quarter take the default from SKR above it, then the largest pin", () => {
    expect(manualSplit({ stORE: 5, hSOL: 20 })).toEqual(split({ SKR: 75, stORE: 5, hSOL: 20 }));
    // the API's effectiveSplit (off) answers these (checked with tsx against api/src/domain/split.ts, 10-22)
    expect(manualSplit({ hSOL: 40, cbBTC: 35 })).toEqual(split({ SKR: 25, stORE: 10, hSOL: 30, cbBTC: 35 }));
    expect(manualSplit({ hSOL: 60 })).toEqual(split({ SKR: 30, stORE: 10, hSOL: 60 }));
    expect(manualSplit({ stORE: 50 })).toEqual(split({ SKR: 50, stORE: 50 }));
  });

  it("on with no pins: every row auto, SKR with the stop's aim, the others with their max", () => {
    const rows = splitRows(rules({ managed: true, stop: "balanced", allocation: split({ SKR: 45, stORE: 5, hSOL: 20, USDC_LEND: 10, SOL_LEND: 10, cbBTC: 10 }) }));
    expect(rows[0]).toEqual({ asset: "SKR", pct: 45, mode: "auto", bound: "aims for 35%" });
    expect(rows[1]).toEqual({ asset: "stORE", pct: 5, mode: "auto", bound: "at most 20%" });   // R251
    expect(rows[5]).toEqual({ asset: "cbBTC", pct: 10, mode: "auto", bound: "at most 25%" });
  });

  // R346: on, a 0 pin is a coin switched off; an old non-zero pin reads as on (it becomes on at the next save).
  it("on: a coin pinned at 0 reads off; an old non-zero pin reads on with its bound", () => {
    const rows = splitRows(rules({ managed: true, stop: "balanced", pins: { hSOL: 0, stORE: 50 }, allocation: split({ SKR: 35, stORE: 50, USDC_LEND: 15 }) }));
    expect(rows[4]).toEqual({ asset: "hSOL", pct: 0, mode: "off", bound: null });
    expect(rows[1]).toEqual({ asset: "stORE", pct: 50, mode: "auto", bound: "at most 20%" });
    expect(rows[0].mode).toBe("auto");
  });

  // 11-15: SKR has a switch; a 0 pin reads off (it used to read on).
  it("on: SKR pinned 0 reads off", () => {
    const rows = splitRows(rules({ managed: true, stop: "careful", pins: { SKR: 0 }, allocation: split({ SKR: 70, hSOL: 30 }) }));
    expect(rows[0]).toEqual({ asset: "SKR", pct: 0, mode: "off", bound: null });
  });

  // Audit fix F1: the unsaved ON draft reads the stop's split, not the saved OFF allocation.
  const preview = split({ SKR: 45, stORE: 5, hSOL: 20, USDC_LEND: 10, SOL_LEND: 10, cbBTC: 10 });
  it("on with a preview and no pins: every row reads the preview, with the bounds", () => {
    const rows = splitRows(rules({ managed: true, stop: "balanced" }), preview);
    expect(rows.map((r) => r.pct)).toEqual([45, 5, 10, 10, 20, 10]);
    expect(rows[0]).toEqual({ asset: "SKR", pct: 45, mode: "auto", bound: "aims for 35%" });
    expect(rows[4]).toEqual({ asset: "hSOL", pct: 20, mode: "auto", bound: "at most 25%" });
  });
  it("on with a preview: an off coin reads 0 and off, the rest read the preview", () => {
    const rows = splitRows(rules({ managed: true, stop: "balanced", pins: { stORE: 0 } }), preview);
    expect(rows[1]).toEqual({ asset: "stORE", pct: 0, mode: "off", bound: null });
    expect(rows[4].pct).toBe(20);
  });
  // Addendum 11-15: off, the "preview" is the draft's own shares (draftShares), shown as they are.
  it("off reads the draft's shares when given", () => {
    expect(splitRows(rules({}), preview)[0]).toEqual({ asset: "SKR", pct: 45, mode: "pinned", bound: null });
    expect(splitRows(rules({ pins: { stORE: 0 } }), preview)[1]).toEqual({ asset: "stORE", pct: 0, mode: "off", bound: null });
  });
});

describe("pins", () => {
  it("canStepUp: off, only the coin's pin max (addendum 11-15: the total may pass 100 in the draft, Save waits for 100); on, the stop's share, or 100 when SKR is pinned", () => {
    const off = (pins: Pins) => ({ managed: false, stop: "balanced" as Stop, pins, allocation: split({ SKR: 100 }) });
    expect(canStepUp(off({ stORE: 50, hSOL: 20 }), "hSOL")).toBe(true);
    expect(canStepUp(off({ stORE: 50, hSOL: 50 }), "cbBTC")).toBe(true);   // 105 in the draft: the total line asks for 5% less
    expect(canStepUp(off({ stORE: 50 }), "stORE")).toBe(false);            // stORE's own max is 50
    const on = (pins: Pins) => ({ managed: true, stop: "careful" as Stop, pins, allocation: split({ SKR: 50, hSOL: 50 }) });
    expect(canStepUp(on({ stORE: 5, hSOL: 40 }), "hSOL")).toBe(true);      // Careful: 50 pinned = 100 - the floor of 50
    expect(canStepUp(on({ stORE: 5, hSOL: 45 }), "hSOL")).toBe(false);     // 55 would leave SKR under 50
    expect(canStepUp(on({ SKR: 60, hSOL: 35 }), "hSOL")).toBe(true);       // SKR pinned: the total may reach 100
    expect(canStepUp(on({ SKR: 60, hSOL: 40 }), "hSOL")).toBe(false);      // 105
    expect(canStepUp(on({ hSOL: 75 }), "hSOL")).toBe(false);
  });
  it("setCoinOn (R346): off is a 0 pin, on removes it, SKR too since 11-15, old non-zero pins drop", () => {
    expect(setCoinOn({}, "hSOL", false)).toEqual({ hSOL: 0 });
    expect(setCoinOn({ hSOL: 0, cbBTC: 0 }, "hSOL", true)).toEqual({ cbBTC: 0 });
    expect(setCoinOn({}, "SKR", false)).toEqual({ SKR: 0 });
    expect(setCoinOn({ stORE: 50 }, "cbBTC", false)).toEqual({ cbBTC: 0 });
  });
  it("managedPins keeps only the 0 pins (a SKR 0 pin too, 11-15)", () => {
    expect(managedPins({ SKR: 60, stORE: 50, hSOL: 0, cbBTC: 0 })).toEqual({ hSOL: 0, cbBTC: 0 });
    expect(managedPins({ SKR: 0, hSOL: 0 })).toEqual({ SKR: 0, hSOL: 0 });
    expect(managedPins({})).toEqual({});
  });
  // Addendum 11-15: stepPin works on the draft's explicit pins (explicitPins): only that coin moves; an unpinned on coin is 0.
  it("stepPin moves by 5 inside 0 and the coin's pin max", () => {
    expect(stepPin({ hSOL: 20 }, "hSOL", 1)).toEqual({ hSOL: 25 });
    expect(stepPin({ hSOL: 75 }, "hSOL", 1)).toEqual({ hSOL: 75 });
    expect(stepPin({ stORE: 50 }, "stORE", 1)).toEqual({ stORE: 50 });
    // 10-23: a 0 pin is the off switch, so stepping down to 0% leaves the coin on with no pin
    expect(stepPin({ hSOL: 3 }, "hSOL", -1)).toEqual({});
    expect(stepPin({ hSOL: 5, stORE: 0 }, "hSOL", -1)).toEqual({ stORE: 0 });
    expect(stepPin({}, "cbBTC", 1)).toEqual({ cbBTC: 5 });
  });
  it("stepPin: stORE steps like any coin, down to 0 while on (addendum 11-15)", () => {
    expect(stepPin({}, "stORE", 1)).toEqual({ stORE: 5 });
    expect(stepPin({ stORE: 15 }, "stORE", -1)).toEqual({ stORE: 10 });
    expect(stepPin({ stORE: 5 }, "stORE", -1)).toEqual({});
  });
  it("pinsForOn (R346, 10-23): turning the manager on drops the manual shares and keeps the coins switched off", () => {
    expect(pinsForOn({ hSOL: 0, stORE: 50, cbBTC: 0 })).toEqual({ hSOL: 0, cbBTC: 0 });
    expect(pinsForOn({ stORE: 20 })).toEqual({});
    expect(pinsForOn({})).toEqual({});
  });
});

describe("the sentence, the undo line, Activity's rows", () => {
  it("undoLine labels the day as given, or nothing", () => {
    expect(undoLine("2026-10-02")).toBe("Changed Oct 2.");
    expect(undoLine(null)).toBeNull();
  });

  it("changeSummary names each coin that moved, in the registry's order", () => {
    const from = split({ SKR: 45, hSOL: 15, USDC_LEND: 15, SOL_LEND: 15, cbBTC: 10 });
    const to = split({ SKR: 45, hSOL: 20, USDC_LEND: 15, SOL_LEND: 15, cbBTC: 5 });
    expect(changeSummary(from, to)).toBe("hSOL 15 to 20, cbBTC 10 to 5");
    expect(changeSummary(from, from)).toBe("");
    expect(changeSummary({ SKR: 45, USDC_LEND: 10, hSOL: 20 }, { SKR: 45, USDC_LEND: 15, hSOL: 15 })).toBe("USDC lending 10 to 15, hSOL 20 to 15");
    expect(changeSummary({ SKR: 40, JitoSOL: 10 }, { SKR: 50, JitoSOL: 0 })).toBe("SKR 40 to 50");   // an old row's retired key is not named
  });

  it("a two-lending-leg why of about 200 characters reaches the screen whole (the Text has no numberOfLines and sits in a flex:1 column, so it wraps by word)", () => {
    const from = split({ SKR: 45, hSOL: 15, USDC_LEND: 15, SOL_LEND: 15, cbBTC: 10 });
    const to = split({ SKR: 45, hSOL: 15, USDC_LEND: 20, SOL_LEND: 20, cbBTC: 0 });
    const why = "USDC lending went to Kamino, which paid 4.4% over 7 days against 3.9% on Jupiter Lend, and SOL lending went to Jupiter Lend at 3.9% against 3.4% on Kamino, both inside the 60% limit.";
    expect(why.length).toBeGreaterThan(180);
    expect(splitRowLine({ ts: "2026-10-03T14:00:00.000Z", by: "manager", from, to, stop: "balanced", why, fallback: null }).endsWith(` ${why}`)).toBe(true);
  });

  it("splitRowLine: the manager with a why, a fallback day, your change, an undo (spec 3.2)", () => {
    const from = split({ SKR: 45, hSOL: 15, USDC_LEND: 15, SOL_LEND: 15, cbBTC: 10 });
    const to = split({ SKR: 45, hSOL: 20, USDC_LEND: 15, SOL_LEND: 15, cbBTC: 5 });
    const ts = "2026-10-03T14:00:00.000Z";
    expect(splitRowLine({ ts, by: "manager", from, to, stop: "balanced", why: "hSOL grew at 7.2% a year over the past week, the most of your coins.", fallback: null }))
      .toBe("Oct 3, hSOL 15 to 20, cbBTC 10 to 5. hSOL grew at 7.2% a year over the past week, the most of your coins.");
    expect(splitRowLine({ ts, by: "manager", from, to, stop: "balanced", why: "x", fallback: "model" })).toBe("Oct 3, chosen by rule today: hSOL 15 to 20, cbBTC 10 to 5.");
    expect(splitRowLine({ ts, by: "you", from, to, stop: "balanced", why: null, fallback: null })).toBe("Oct 3, you: hSOL 15 to 20, cbBTC 10 to 5.");
    expect(splitRowLine({ ts, by: "you", from, to: from, stop: "bold", why: null, fallback: null })).toBe("Oct 3, you: Bold.");
    // The API says when a save moved the switch off to on: "you: Balanced, on." (spec 3.2); a pin change while on keeps the summary.
    expect(splitRowLine({ ts, by: "you", from, to, stop: "balanced", why: null, fallback: null, managed: true, turnedOn: true })).toBe("Oct 3, you: Balanced, on.");
    expect(splitRowLine({ ts, by: "you", from, to, stop: "balanced", why: null, fallback: null, managed: true, turnedOn: false })).toBe("Oct 3, you: hSOL 15 to 20, cbBTC 10 to 5.");
    // Review Focus 3.
    expect(splitRowLine({ ts, by: "undo", from: to, to: from, stop: null, why: null, fallback: null })).toBe("Oct 3, undone. Yesterday's split is back; the AI Yield Manager is off.");
    // Audit fix F6: the API's UTC day, so 19:00 PDT on Oct 2 reads Oct 3, as the Rules card's "Changed Oct 3." does.
    expect(splitRowLine({ ts: "2026-10-03T02:00:00.000Z", by: "you", from, to, stop: "balanced", why: null, fallback: null })).toBe("Oct 3, you: hSOL 15 to 20, cbBTC 10 to 5.");
  });
});

