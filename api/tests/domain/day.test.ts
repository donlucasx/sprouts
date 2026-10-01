import { describe, it, expect } from "vitest";
import { dayOf, daysBetween, addDays } from "@/domain/day";

// Days are UTC dates; the cron runs at 14:00 UTC, so a run is one day everywhere.
describe("days", () => {
  it("dayOf is the UTC date", () => {
    expect(dayOf(new Date("2026-10-01T14:00:00Z"))).toBe("2026-10-01");
    expect(dayOf(new Date("2026-10-01T23:30:00-07:00"))).toBe("2026-10-02");
  });
  it("daysBetween and addDays", () => {
    expect(daysBetween("2026-09-24", "2026-10-01")).toBe(7);
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(addDays("2026-10-01", -7)).toBe("2026-09-24");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
