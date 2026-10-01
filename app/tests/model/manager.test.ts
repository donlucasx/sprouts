import { describe, it, expect, vi } from "vitest";
import type { Split } from "@/lib/api";
import {
  STOP_FLOOR, STOP_MAX, PIN_MAX, PIN_STEP, STOP_LINE, OFF_TEXT, ON_TEXT, UNDONE_TEXT,
  splitRows, togglePin, stepPin, managerSentence, undoLine, changeSummary, splitRowLine, pinsForOn,
} from "@/model/manager";

// Mock react-native modules to avoid SSR parsing issues
vi.mock("react", () => ({ createContext: () => ({}), useContext: () => ({}) }));
vi.mock("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));

// Use ASSETS from manager module instead of api
const ASSETS = ["SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const;

const split = (p: Partial<Split>): Split => ({ SKR: 0, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0, ...p });
const rules = (p: Partial<Parameters<typeof splitRows>[0]>) => ({ managed: false, stop: "balanced" as const, pins: {}, allocation: split({ SKR: 100 }), ...p });

// Spec 4.1 mirrored for labels and stepper bounds; the API is the authority.
describe("the tables", () => {
  it("floors, maxes, pin maxes and the step", () => {
    expect(STOP_FLOOR).toEqual({ careful: 50, balanced: 35, bold: 25 });
    expect(STOP_MAX.careful).toEqual({ stORE: 5, hSOL: 15, JitoSOL: 15, JupSOL: 15, cbBTC: 30 });
    expect(STOP_MAX.bold.cbBTC).toBe(20);
    expect(PIN_MAX).toEqual({ SKR: 100, stORE: 50, hSOL: 75, JitoSOL: 75, JupSOL: 75, cbBTC: 75 });
    expect(PIN_STEP).toBe(5);
    expect(STOP_LINE).toBe("Careful keeps at least 50% in SKR, Balanced 35%, Bold 25%.");
    expect(OFF_TEXT).toBe("Sprouts can choose how new change is split across six coins, inside limits you set. Nothing you hold is ever sold.");
    expect(ON_TEXT).toBe("Sprouts chooses the split each day inside these limits. Pin a coin to fix its share. Nothing you hold is ever sold.");
    expect(UNDONE_TEXT).toBe("Yesterday's split is back. The Yield Manager is off until you turn it on.");
  });
});

describe("splitRows (spec 3.1)", () => {
  // Review Focus 1: the Saga after the migration.
  it("off: rows from a migrated stORE pin; SKR is the rest, every other coin pinned at 0", () => {
    const rows = splitRows(rules({ pins: { stORE: 50 }, allocation: split({ SKR: 50, stORE: 50 }) }));
    expect(rows.map((r) => r.asset)).toEqual([...ASSETS]);
    expect(rows[0]).toEqual({ asset: "SKR", pct: 50, mode: "the rest", bound: null });
    expect(rows[1]).toEqual({ asset: "stORE", pct: 50, mode: "pinned", bound: null });
    expect(rows[2]).toEqual({ asset: "hSOL", pct: 0, mode: "pinned", bound: null });
  });

  it("off with no pins: SKR 100 the rest", () => {
    expect(splitRows(rules({}))[0]).toEqual({ asset: "SKR", pct: 100, mode: "the rest", bound: null });
  });

  it("on with no pins: every row auto, SKR with its floor, the others with their max", () => {
    const rows = splitRows(rules({ managed: true, stop: "balanced", allocation: split({ SKR: 45, stORE: 5, hSOL: 20, JitoSOL: 10, JupSOL: 10, cbBTC: 10 }) }));
    expect(rows[0]).toEqual({ asset: "SKR", pct: 45, mode: "auto", bound: "at least 35%" });
    expect(rows[1]).toEqual({ asset: "stORE", pct: 5, mode: "auto", bound: "at most 10%" });
    expect(rows[5]).toEqual({ asset: "cbBTC", pct: 10, mode: "auto", bound: "at most 25%" });
  });

  // Review Focus 2: a pin above the stop's max is the user's authority.
  it("on: a pin above the stop max keeps its row; the pinned value is the pin, not the allocation", () => {
    const rows = splitRows(rules({ managed: true, stop: "balanced", pins: { stORE: 50 }, allocation: split({ SKR: 35, stORE: 50, hSOL: 8, JitoSOL: 4, JupSOL: 2, cbBTC: 1 }) }));
    expect(rows[1]).toEqual({ asset: "stORE", pct: 50, mode: "pinned", bound: null });
    expect(rows[0].mode).toBe("auto");
  });

  it("on with SKR pinned: SKR reads pinned with no bound", () => {
    const rows = splitRows(rules({ managed: true, stop: "careful", pins: { SKR: 70 }, allocation: split({ SKR: 70, hSOL: 10, JitoSOL: 10, JupSOL: 10 }) }));
    expect(rows[0]).toEqual({ asset: "SKR", pct: 70, mode: "pinned", bound: null });
  });
});

describe("pins", () => {
  it("togglePin pins a coin at its current percent and unpins it", () => {
    expect(togglePin({}, "hSOL", true, 23)).toEqual({ hSOL: 23 });
    expect(togglePin({ hSOL: 23, cbBTC: 10 }, "hSOL", false, 23)).toEqual({ cbBTC: 10 });
  });
  it("stepPin moves by 5 inside 0 and the coin's pin max", () => {
    expect(stepPin({ hSOL: 20 }, "hSOL", 1)).toEqual({ hSOL: 25 });
    expect(stepPin({ hSOL: 75 }, "hSOL", 1)).toEqual({ hSOL: 75 });
    expect(stepPin({ stORE: 50 }, "stORE", 1)).toEqual({ stORE: 50 });
    expect(stepPin({ hSOL: 3 }, "hSOL", -1)).toEqual({ hSOL: 0 });
    expect(stepPin({}, "cbBTC", 1)).toEqual({ cbBTC: 5 });
  });
  it("pinsForOn drops zero pins so the manager is free to buy those coins (Ruling P5)", () => {
    expect(pinsForOn({ hSOL: 0, stORE: 50, cbBTC: 0 })).toEqual({ stORE: 50 });
    expect(pinsForOn({})).toEqual({});
  });
});

describe("the sentence, the undo line, Activity's rows", () => {
  it("managerSentence adds the manager clause when on and a share clause per non-SKR pin", () => {
    expect(managerSentence(rules({}))).toBe("");
    expect(managerSentence(rules({ managed: true, stop: "bold" }))).toBe(" The Yield Manager splits new change across six coins, Bold.");
    expect(managerSentence(rules({ pins: { stORE: 20 } }))).toBe(" About 20 cents of every dollar grows stORE.");
    expect(managerSentence(rules({ managed: true, stop: "balanced", pins: { cbBTC: 10, SKR: 50 } })))
      .toBe(" The Yield Manager splits new change across six coins, Balanced. About 10 cents of every dollar grows cbBTC.");
  });

  it("undoLine labels the day as given, or nothing", () => {
    expect(undoLine("2026-10-02")).toBe("Changed Oct 2.");
    expect(undoLine(null)).toBeNull();
  });

  it("changeSummary names each coin that moved, in the registry's order", () => {
    const from = split({ SKR: 45, hSOL: 15, JitoSOL: 15, JupSOL: 15, cbBTC: 10 });
    const to = split({ SKR: 45, hSOL: 20, JitoSOL: 15, JupSOL: 15, cbBTC: 5 });
    expect(changeSummary(from, to)).toBe("hSOL 15 to 20, cbBTC 10 to 5");
    expect(changeSummary(from, from)).toBe("");
  });

  it("splitRowLine: the manager with a why, a fallback day, your change, an undo (spec 3.2)", () => {
    const from = split({ SKR: 45, hSOL: 15, JitoSOL: 15, JupSOL: 15, cbBTC: 10 });
    const to = split({ SKR: 45, hSOL: 20, JitoSOL: 15, JupSOL: 15, cbBTC: 5 });
    const ts = "2026-10-03T14:00:00.000Z";
    expect(splitRowLine({ ts, by: "manager", from, to, stop: "balanced", why: "hSOL grew at 7.2% a year over the past week, the most of your coins.", fallback: null }))
      .toBe("Oct 3, hSOL 15 to 20, cbBTC 10 to 5. hSOL grew at 7.2% a year over the past week, the most of your coins.");
    expect(splitRowLine({ ts, by: "manager", from, to, stop: "balanced", why: "x", fallback: "model" })).toBe("Oct 3, chosen by rule today: hSOL 15 to 20, cbBTC 10 to 5.");
    expect(splitRowLine({ ts, by: "you", from, to, stop: "balanced", why: null, fallback: null })).toBe("Oct 3, you: hSOL 15 to 20, cbBTC 10 to 5.");
    expect(splitRowLine({ ts, by: "you", from, to: from, stop: "bold", why: null, fallback: null })).toBe("Oct 3, you: Bold.");
    // Review Focus 3.
    expect(splitRowLine({ ts, by: "undo", from: to, to: from, stop: null, why: null, fallback: null })).toBe("Oct 3, undone. Yesterday's split is back; the Yield Manager is off.");
  });
});
