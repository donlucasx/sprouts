import { describe, it, expect } from "vitest";
import { formatUsd, formatSkr, formatAsOf, roundUpTo } from "@/lib/format";

describe("format", () => {
  it("dollars first, two decimals, whole cents", () => {
    expect(formatUsd(1727)).toBe("$17.27");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(0)).toBe("$0.00");
  });
  it("SKR always with its dollar value beside it", () => {
    expect(formatSkr(266_000_000n, 0.01833)).toBe("266.00 SKR ($4.88)");
    expect(formatSkr(5_260_937n, 0.01833)).toBe("5.26 SKR ($0.10)");
    expect(formatSkr(266_000_000n, null)).toBe("266.00 SKR");
  });
  it("as of: today shows the time, yesterday says so", () => {
    const now = new Date("2026-09-28T16:41:00-07:00");
    expect(formatAsOf(new Date("2026-09-28T09:41:00-07:00"), now)).toBe("as of 9:41 AM");
    expect(formatAsOf(new Date("2026-09-27T09:41:00-07:00"), now)).toBe("as of yesterday 9:41 AM");
    expect(formatAsOf(new Date("2026-09-20T09:41:00-07:00"), now)).toBe("as of Sep 20");
  });
  it("round up to the next dollar: a whole dollar rounds up a whole dollar", () => {
    expect(roundUpTo(117, 100)).toBe(83);
    expect(roundUpTo(2000, 100)).toBe(100);
  });
});
