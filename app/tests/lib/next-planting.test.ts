import { describe, it, expect, beforeAll } from "vitest";
import { nextPlantingRow, nextRunLabel } from "@/lib/next-planting";

// The job runs at 14:00 UTC; the label is read in the phone's zone. The zone is pinned per test so the branches are certain.
const base = { thresholdCents: 200, hasPlant: true, now: new Date("2026-10-02T12:00:00Z") };

describe("nextPlantingRow (R164)", () => {
  it("usual: Next planting, dollars of dollars, the bar fills", () => {
    expect(nextPlantingRow({ ...base, pendingCents: 40 })).toEqual({ state: "usual", label: "Next planting", value: "$0.40 of $2.00", fraction: 0.2 });
  });
  it("before the first planting: First planting", () => {
    expect(nextPlantingRow({ ...base, hasPlant: false, pendingCents: 40 })).toEqual({ state: "first", label: "First planting", value: "$0.40 of $2.00", fraction: 0.2 });
  });
  it("nothing saved: $0.00 of $2.00, empty", () => {
    expect(nextPlantingRow({ ...base, pendingCents: 0 })).toEqual({ state: "empty", label: "Next planting", value: "$0.00 of $2.00", fraction: 0 });
  });
  it("threshold reached or passed: the run time, full", () => {
    process.env.TZ = "UTC";
    const r = nextPlantingRow({ ...base, pendingCents: 200 });
    expect(r).toEqual({ state: "reached", label: "Next planting", value: "Today, 2 PM", fraction: 1 });
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
});
