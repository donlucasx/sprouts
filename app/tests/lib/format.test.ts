import { describe, it, expect } from "vitest";
import { formatUsd, formatSkr, formatAsOf, roundUpTo, formatWallet, formatStore, formatAmount, oreShareLine, DECIMALS } from "@/lib/format";

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

// Home lists the linked wallets (Lucas, 2026-09-29: "Would be great to have info on existing wallets connected on the sprouts dashboard").
describe("formatWallet", () => {
  it("short address, status, daily limit", () => {
    expect(formatWallet({ pubkey: "887dEPR85vfSZ45zFrxttJ6cLomwvnYbh5HnyGbTAXVu", status: "active", dailyCapCents: 500 })).toBe("887d...AXVu, active, limit $5.00 a day");
    expect(formatWallet({ pubkey: "9ZKiQdmEvTKxt9e5yWRT1XbZW1b1D7n2AySLU5HyUZtZ", status: "paused", dailyCapCents: 250 })).toBe("9ZKi...UZtZ, paused, limit $2.50 a day");
  });
});

// audits/ore-plan, finding 1: stORE has 11 decimals; four are shown, since a $2 planting is about 0.02 stORE.
describe("stORE amounts", () => {
  it("formats at 11 decimals, four shown, dollars beside it", () => {
    expect(DECIMALS).toEqual({ SKR: 6, stORE: 11 });
    expect(formatStore(2_150_000_000n, 88.21)).toBe("0.0215 stORE ($1.90)");
    expect(formatStore(122_495_137n, null)).toBe("0.0012 stORE"); // Spike 2's dust quote
    expect(formatAmount("SKR", 266_000_000n, 0.01833)).toBe("266.00 SKR ($4.88)");
    expect(formatAmount("stORE", 2_150_000_000n, 88.21)).toBe("0.0215 stORE ($1.90)");
  });
  it("the fence's line speaks in money, not plantings (finding 9)", () => {
    expect(oreShareLine(0)).toBe("Every planting grows SKR.");
    expect(oreShareLine(30)).toBe("About 30 cents of every dollar grows ORE.");
  });
});
