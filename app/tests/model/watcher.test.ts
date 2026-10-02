import { describe, it, expect } from "vitest";
import { watcherLine } from "@/model/watcher";

// The design as locked (audits/watering-ux/RECONCILED.md, R96), with the can in the garden (R175) and ONE line joining the can to
// the buds (R184): the line and the can always agree, and there is no clock.
const rest = { unrevealed: 0, opened: 0, failed: false, nudged: false };

describe("watcherLine", () => {
  it("a bud waits: the can is in colour and one line joins it to the buds (R184)", () => {
    expect(watcherLine({ ...rest, unrevealed: 1 })).toEqual({ line: "1 new sprout is waiting. Drag the can onto it to water.", can: "ready" });
    expect(watcherLine({ ...rest, unrevealed: 3 }).line).toBe("3 new sprouts are waiting. Drag the can onto them to water.");
  });
  it("just opened: the count, the can greyed", () => {
    expect(watcherLine({ ...rest, opened: 1 })).toEqual({ line: "Opened 1 new sprout.", can: "grey" });
    expect(watcherLine({ ...rest, opened: 3 }).line).toBe("Opened 3 new sprouts.");
  });
  it("nothing to open: no line and the can greyed, whatever is waiting to be planted (R164: the progress row says it)", () => {
    expect(watcherLine(rest)).toEqual({ line: null, can: "grey" });
  });
  it("a tap on the greyed can says why nothing happens (R175's optional hint)", () => {
    expect(watcherLine({ ...rest, nudged: true })).toEqual({ line: "Nothing to water yet.", can: "grey" });
    expect(watcherLine({ ...rest, nudged: true, opened: 2 }).line).toBe("Opened 2 new sprouts.");
  });
  it("a failed watering says so and keeps the can ready", () => {
    expect(watcherLine({ ...rest, unrevealed: 1, failed: true })).toEqual({ line: "Could not water. Try again.", can: "ready" });
  });
  it("a new bud outranks the opened line, so the line always agrees with the can", () => {
    expect(watcherLine({ ...rest, unrevealed: 1, opened: 2 })).toEqual({ line: "1 new sprout is waiting. Drag the can onto it to water.", can: "ready" });
  });
});
