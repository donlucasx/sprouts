import { describe, it, expect } from "vitest";
import { watcherLine } from "@/model/watcher";

// The design as locked (audits/watering-ux/RECONCILED.md, R96): the line and the button always agree, and there is no clock.
const rest = { unrevealed: 0, hasPlant: true, neverWatered: false, pendingCents: 0, thresholdCents: 200, watering: false, opened: 0, failed: false };
const FIRST_RUN = "Your garden grows on its own. Watering opens the new growth so you can see it.";

describe("watcherLine", () => {
  it("a bud waits: the line invites the tap and the button is there", () => {
    expect(watcherLine({ ...rest, unrevealed: 1 })).toEqual({ line: "1 new sprout is waiting. Water to open it.", button: "Water", note: null });
    expect(watcherLine({ ...rest, unrevealed: 2 }).line).toBe("2 new sprouts are waiting. Water to open them.");
  });
  it("watering runs: the same line, the button says so", () => {
    expect(watcherLine({ ...rest, unrevealed: 1, watering: true })).toEqual({ line: "1 new sprout is waiting. Water to open it.", button: "Watering...", note: null });
  });
  it("just opened: the count, no button", () => {
    expect(watcherLine({ ...rest, opened: 1 })).toEqual({ line: "Opened 1 new sprout.", button: null, note: null });
    expect(watcherLine({ ...rest, opened: 3 }).line).toBe("Opened 3 new sprouts.");
  });
  it("nothing to open, change waiting: the next planting", () => {
    expect(watcherLine({ ...rest, pendingCents: 62 })).toEqual({ line: "Nothing new to open. Next planting: $0.62 of $2.00.", button: null, note: null });
  });
  it("nothing to open, nothing waiting", () => {
    expect(watcherLine(rest)).toEqual({ line: "Nothing new to open yet.", button: null, note: null });
  });
  it("before the first planting: seeds", () => {
    expect(watcherLine({ ...rest, hasPlant: false, neverWatered: true, pendingCents: 60 })).toEqual({ line: "Seeds are waiting: $0.60 of $2.00 until the first planting.", button: null, note: null });
  });
  it("bare soil before the first swap reads as nothing to open yet", () => {
    expect(watcherLine({ ...rest, hasPlant: false, neverWatered: true }).line).toBe("Nothing new to open yet.");
  });
  it("a failed tap says so and keeps the button", () => {
    expect(watcherLine({ ...rest, unrevealed: 1, failed: true })).toEqual({ line: "Could not water. Try again.", button: "Water", note: null });
  });
  it("the first-run sentence sits under the button until the first watering", () => {
    expect(watcherLine({ ...rest, unrevealed: 1, neverWatered: true }).note).toBe(FIRST_RUN);
    expect(watcherLine({ ...rest, unrevealed: 1 }).note).toBeNull();
    expect(watcherLine({ ...rest, neverWatered: true }).note).toBeNull();   // no button, no sentence
  });
  it("a new bud outranks the opened line, so the line always agrees with the can", () => {
    expect(watcherLine({ ...rest, unrevealed: 1, opened: 2 })).toEqual({ line: "1 new sprout is waiting. Water to open it.", button: "Water", note: null });
  });
});
