import { describe, it, expect, beforeAll } from "vitest";
import { nextPlantingRow, nextRunLabel } from "@/lib/next-planting";

// The job runs at 14:00 UTC; the label is read in the phone's zone. The zone is pinned per test so the branches are certain.
const base = { thresholdCents: 200, hasPlant: true, now: new Date("2026-10-02T12:00:00Z") };

describe("nextPlantingRow (R164): label by whether a planting exists, value and bar by the amount", () => {
  const cases: Array<[boolean, number, string, string, number, string, string]> = [
    [true, 0, "Next planting", "$0.00 of $2.00", 0, "empty", "Waiting for your next swap"],
    [true, 40, "Next planting", "$0.40 of $2.00", 0.2, "saving", "$0.40 saved"],
    [true, 200, "Next planting", "Today, 2 PM", 1, "reached", "$2.00 saved · planted this afternoon"],
    [false, 0, "First planting", "$0.00 of $2.00", 0, "empty", "Waiting for your next swap"],
    [false, 40, "First planting", "$0.40 of $2.00", 0.2, "saving", "$0.40 saved"],
    [false, 200, "First planting", "Today, 2 PM", 1, "reached", "$2.00 saved · planted this afternoon"],
  ];
  it.each(cases)("hasPlant %s, pending %s", (hasPlant, pendingCents, label, value, fraction, state, line) => {
    process.env.TZ = "UTC";
    expect(nextPlantingRow({ ...base, hasPlant, pendingCents })).toEqual({ state, label, value, fraction, line });
  });
  it("R466: in California the run reads as the morning, today before 7 AM and tomorrow after", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(nextPlantingRow({ ...base, pendingCents: 300, now: new Date("2026-10-02T12:00:00Z") }).line).toBe("$3.00 saved · planted this morning");
    expect(nextPlantingRow({ ...base, pendingCents: 300, now: new Date("2026-10-02T20:00:00Z") }).line).toBe("$3.00 saved · planted tomorrow morning");
    expect(nextPlantingRow({ ...base, pendingCents: 300, paused: true }).line).toBe("$3.00 saved · paused");
  });
  it("past the threshold the bar stays full", () => {
    expect(nextPlantingRow({ ...base, pendingCents: 350 }).fraction).toBe(1);
  });
});

describe("nextRunLabel", () => {
  beforeAll(() => { process.env.TZ = "America/Los_Angeles"; });
  it("Today when 14:00 UTC is still ahead on the phone's day", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(nextRunLabel(new Date("2026-10-02T12:00:00Z"))).toBe("Today, 7 AM");   // 05:00 PDT now
  });
  it("Tomorrow once today's run has passed", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(nextRunLabel(new Date("2026-10-02T14:00:00Z"))).toBe("Tomorrow, 7 AM");  // exactly the run: the next one
    expect(nextRunLabel(new Date("2026-10-02T20:00:00Z"))).toBe("Tomorrow, 7 AM");  // 13:00 PDT now
  });
  it("follows the zone's offset in winter (6 AM in PST), not a fixed 7", () => {
    process.env.TZ = "America/Los_Angeles";
    expect(nextRunLabel(new Date("2026-12-02T20:00:00Z"))).toBe("Tomorrow, 6 AM");
  });
  it("a zone without DST: 2 PM in UTC, and a day boundary ahead of UTC reads Tomorrow", () => {
    process.env.TZ = "UTC";
    expect(nextRunLabel(new Date("2026-10-02T09:00:00Z"))).toBe("Today, 2 PM");
    process.env.TZ = "Pacific/Auckland";
    expect(nextRunLabel(new Date("2026-10-02T09:00:00Z"))).toBe("Tomorrow, 3 AM");   // NZDT, local Oct 2 22:00 now
  });
  it("a half-hour zone keeps its minutes", () => {
    process.env.TZ = "Asia/Kolkata";
    expect(nextRunLabel(new Date("2026-10-02T09:00:00Z"))).toBe("Today, 7:30 PM");
  });
  it("paused: the row says Paused and keeps the saved fraction (his note 10-05)", () => {
    expect(nextPlantingRow({ ...base, pendingCents: 350, paused: true })).toMatchObject({ state: "paused", value: "Paused", fraction: 1 });
    expect(nextPlantingRow({ ...base, pendingCents: 0, paused: true })).toMatchObject({ state: "paused", value: "Paused", fraction: 0 });
  });
});
