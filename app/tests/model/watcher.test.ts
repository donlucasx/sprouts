import { describe, it, expect } from "vitest";
import { watcherLine } from "@/model/watcher";

// The design as locked (audits/watering-ux/RECONCILED.md, R96), with the can in the garden (R175) and ONE line joining the can to
// the buds (R184; R186's words): the line and the can always agree, and there is no clock. R199: no line after a watering.
const rest = { unrevealed: 0, failed: false, nudged: false };

describe("watcherLine", () => {
  it("a bud waits: the can is in colour and one line joins the planting to the can and the buds (R186)", () => {
    expect(watcherLine({ ...rest, unrevealed: 1 })).toEqual({ line: "Your change was planted. Drag the can onto the new sprout to open it.", can: "ready" });
    expect(watcherLine({ ...rest, unrevealed: 3 }).line).toBe("Your change was planted. Drag the can onto the new sprouts to open them.");
  });
  it("nothing to open, including just after a watering opened every bud: no line and the can greyed (R164, R199)", () => {
    expect(watcherLine(rest)).toEqual({ line: null, can: "grey" });
  });
  it("R199: the input no longer carries an opened count, so no 'Opened N new sprouts.' line can come back through it", () => {
    // a caller still passing the old field gets the same answer as without it: the field is read by nothing
    expect(watcherLine({ ...rest, opened: 2 } as typeof rest)).toEqual({ line: null, can: "grey" });
  });
  it("a tap on the greyed can says why nothing happens (R175's optional hint)", () => {
    expect(watcherLine({ ...rest, nudged: true })).toEqual({ line: "Nothing to water yet.", can: "grey" });
  });
  it("a failed watering says so and keeps the can ready", () => {
    expect(watcherLine({ ...rest, unrevealed: 1, failed: true })).toEqual({ line: "Could not water. Try again.", can: "ready" });
  });
  it("a waiting bud outranks the nudge hint, so the line always agrees with the can", () => {
    expect(watcherLine({ ...rest, unrevealed: 1, nudged: true })).toEqual({ line: "Your change was planted. Drag the can onto the new sprout to open it.", can: "ready" });
  });
});
