import { describe, it, expect } from "vitest";
import { formatUsd, formatSkr, formatAsOf, roundUpTo, formatWallet, formatStore, formatAmount, DECIMALS, formatHolding, shareLine, dayLabel, COIN_NAME } from "@/lib/format";

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
    expect(DECIMALS.stORE).toBe(11);
    expect(formatStore(2_150_000_000n, 88.21)).toBe("0.0215 stORE ($1.90)");
    expect(formatStore(122_495_137n, null)).toBe("0.0012 stORE"); // Spike 2's dust quote
    expect(formatAmount("SKR", 266_000_000n, 0.01833)).toBe("266.00 SKR ($4.88)");
    expect(formatAmount("stORE", 2_150_000_000n, 88.21)).toBe("0.0215 stORE ($1.90)");
  });
});

// Spec 3.3, 3.5: six coins format with their own decimals; the SOL coins and stORE show 4 places, cbBTC 6, SKR keeps 2.
describe("six coins", () => {
  it("names and decimals in the registry's order", () => {
    expect(Object.keys(DECIMALS)).toEqual(["SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"]);
    expect(DECIMALS).toEqual({ SKR: 6, stORE: 11, hSOL: 9, JitoSOL: 9, JupSOL: 9, cbBTC: 8 });
    expect(COIN_NAME.JitoSOL).toBe("JitoSOL");
  });

  it("formatAmount keeps SKR and stORE as before and formats the four new coins with a dollar beside", () => {
    expect(formatAmount("hSOL", 14_181_944n, 168)).toBe("0.0142 hSOL ($2.38)");
    expect(formatAmount("JitoSOL", 12_939_970n, null)).toBe("0.0129 JitoSOL");
    expect(formatAmount("cbBTC", 2_352n, 83_600)).toBe("0.000024 cbBTC ($1.97)");
    expect(formatAmount("SKR", 5_256_186n, null)).toBe(formatSkr(5_256_186n, null));
    expect(formatAmount("stORE", 122_495_137n, null)).toBe(formatStore(122_495_137n, null));
  });

  it("shareLine says what a pin grows, SKR when nothing is pinned", () => {
    expect(shareLine("stORE", 0)).toBe("Every planting grows SKR.");
    expect(shareLine("stORE", 20)).toBe("About 20 cents of every dollar grows stORE.");
    expect(shareLine("cbBTC", 10)).toBe("About 10 cents of every dollar grows cbBTC.");
  });

  it("formatHolding is the Home line per held coin: value, earned when measured, where it sits", () => {
    expect(formatHolding({ asset: "hSOL", heldRaw: "2000000000", putInCents: 400, valueUsd: 336, earnedUsd: 2.8, earnedUnderlyingRaw: "20000000" }))
      .toBe("2.0000 hSOL ($336.00), earned $2.80, in your Seeker wallet, not locked. Sprouts cannot sell it for you.");
    expect(formatHolding({ asset: "cbBTC", heldRaw: "2389", putInCents: 200, valueUsd: 1.997, earnedUsd: null, earnedUnderlyingRaw: null }))
      .toBe("0.000024 cbBTC ($2.00), in your Seeker wallet, not locked. Sprouts cannot sell it for you.");
    // Review Focus 4: no price yet (no snapshot row), no earned: the amount alone.
    expect(formatHolding({ asset: "cbBTC", heldRaw: "2389", putInCents: 200, valueUsd: null, earnedUsd: null, earnedUnderlyingRaw: null }))
      .toBe("0.000024 cbBTC, in your Seeker wallet, not locked. Sprouts cannot sell it for you.");
  });

  it("dayLabel renders a UTC YYYY-MM-DD as given (Review Focus 5: no timezone shift)", () => {
    expect(dayLabel("2026-10-02")).toBe("Oct 2");
    expect(dayLabel("2026-12-31")).toBe("Dec 31");
    expect(dayLabel("2027-01-01")).toBe("Jan 1");
  });
});
