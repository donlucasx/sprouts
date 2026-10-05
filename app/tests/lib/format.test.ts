import { describe, it, expect } from "vitest";
import { formatUsd, formatSkr, positionAmount, underlyingAmount, formatAsOf, roundUpTo, formatWallet, formatStore, formatAmount, DECIMALS, HOLDINGS_NOTE, shareLine, dayLabel, COIN_NAME, feeClause, plantedLine, potHeadline, holdingAmount, arrivalLine, dayTime } from "@/lib/format";

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
    expect(formatWallet({ pubkey: "887dEPR85vfSZ45zFrxttJ6cLomwvnYbh5HnyGbTAXVu", status: "active", dailyCapCents: 500 })).toBe("887d...AXVu, active, up to $5.00 a day");
    expect(formatWallet({ pubkey: "9ZKiQdmEvTKxt9e5yWRT1XbZW1b1D7n2AySLU5HyUZtZ", status: "paused", dailyCapCents: 250 })).toBe("9ZKi...UZtZ, paused, up to $2.50 a day");
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

// Spec 3.3, 3.5: six coins format with their own decimals; the SOL coins and stORE show 4 places, cbBTC 8 (spec 5.1), SKR keeps 2.
describe("six coins", () => {
  it("names and decimals in the registry's order", () => {
    expect(Object.keys(DECIMALS)).toEqual(["SKR", "stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC"]);
    expect(DECIMALS).toEqual({ SKR: 6, stORE: 11, USDC_LEND: 6, SOL_LEND: 9, hSOL: 9, cbBTC: 8 });
    expect(COIN_NAME.USDC_LEND).toBe("USDC");
  });

  it("formatAmount keeps SKR and stORE as before and formats the four new coins with a dollar beside", () => {
    expect(formatAmount("hSOL", 14_181_944n, 168)).toBe("0.0142 hSOL ($2.38)");
    expect(formatAmount("SOL_LEND", 12_939_970n, null)).toBe("0.0129 SOL");
    expect(formatAmount("cbBTC", 2_352n, 83_600)).toBe("0.00002352 cbBTC ($1.97)");
    expect(formatAmount("SKR", 5_256_186n, null)).toBe(formatSkr(5_256_186n, null));
    expect(formatAmount("stORE", 122_495_137n, null)).toBe(formatStore(122_495_137n, null));
  });

  it("shareLine says what a pin grows, SKR when nothing is pinned", () => {
    expect(shareLine("stORE", 0)).toBe("Every planting grows SKR.");
    expect(shareLine("stORE", 20)).toBe("About 20 cents of every dollar grows stORE.");
    expect(shareLine("cbBTC", 10)).toBe("About 10 cents of every dollar grows cbBTC.");
  });

  it("HOLDINGS_NOTE says where the wallet coins sit, once", () => {
    expect(HOLDINGS_NOTE).toBe("These sit in your Seeker wallet, not locked. Sprouts cannot sell them for you.");
  });

  it("plantedLine: what the change became, dollars first, the fee clause as ruled (R139); never the word pulled (manual 6)", () => {
    expect(plantedLine({ usdcInCents: 203, asset: "hSOL", amountOutRaw: "12300000", usdPrice: 168, feeCents: 0, feeAmountRaw: "0" })).toBe("$2.03 became 0.0123 hSOL ($2.07), fee under 1 cent");
    expect(plantedLine({ usdcInCents: 23, asset: "SKR", amountOutRaw: "12480000", usdPrice: 0.01833, feeCents: 1, feeAmountRaw: "0" })).toBe("$0.23 became 12.48 SKR ($0.23), fee $0.01");
    expect(plantedLine({ usdcInCents: 200, asset: "cbBTC", amountOutRaw: "2352", usdPrice: null, feeCents: 0, feeAmountRaw: undefined })).toBe("$2.00 became 0.00002352 cbBTC");
  });

  it("potHeadline: the big number is the dollar value, the SKR under it; without a price the SKR is the big number", () => {
    expect(potHeadline(1_284_500_000n, 0.01833)).toEqual({ big: "$23.54", small: "1,284.50 SKR" });
    expect(potHeadline(1_284_500_000n, null)).toEqual({ big: "1,284.50 SKR", small: null });
  });

  it("feeClause: no clause for a legacy row with no recorded fee (audit fix F4), else the fee in dollars", () => {
    expect(feeClause(0)).toBe("");
    expect(feeClause(1)).toBe(", fee $0.01");
    expect(feeClause(1, "0")).toBe(", fee $0.01");
    expect(feeClause(0, "0")).toBe(", fee under 1 cent");
    expect(feeClause(0, "12345")).toBe("");
    expect(feeClause(0, undefined)).toBe("");
  });

  it("dayLabel renders a UTC YYYY-MM-DD as given (Review Focus 5: no timezone shift)", () => {
    expect(dayLabel("2026-10-02")).toBe("Oct 2");
    expect(dayLabel("2026-12-31")).toBe("Dec 31");
    expect(dayLabel("2027-01-01")).toBe("Jan 1");
  });
});

describe('holdingAmount (R150: the row is the amount and its value, nothing else)', () => {
  it('shows the amount with its value and no earned clause', () => {
    expect(holdingAmount({ asset: 'hSOL', heldRaw: '12300000', putInCents: 203, valueUsd: 2.07, earnedUsd: 0.04, earnedUnderlyingRaw: '1' })).toBe('0.0123 hSOL ($2.07)')
  })
  it('stORE at its eleven decimals, four places shown', () => {
    expect(holdingAmount({ asset: 'stORE', heldRaw: '2000000000', putInCents: 200, valueUsd: 2.01, earnedUsd: null, earnedUnderlyingRaw: null })).toBe('0.0200 stORE ($2.01)')
  })
  it('leaves the value out when none is known', () => {
    expect(holdingAmount({ asset: 'cbBTC', heldRaw: '2389', putInCents: 200, valueUsd: null, earnedUsd: null, earnedUnderlyingRaw: null })).toBe('0.00002389 cbBTC')
  })
})

describe("arrivalLine (R165)", () => {
  const ready = "2026-10-04T12:00:00Z";
  it("a future readyAt says when it arrives", () => {
    expect(arrivalLine(ready, new Date("2026-10-03T12:00:00Z"))).toMatch(/^arrives Oct [34], \d{1,2} [AP]M$/);
    expect(arrivalLine(new Date(ready), new Date("2026-10-03T12:00:00Z"), true)).toMatch(/^Arrives Oct [34], \d{1,2} [AP]M$/);
  });
  it("readyAt equal to now has arrived", () => {
    expect(arrivalLine(ready, new Date(ready))).toBe("arriving today");
  });
  it("a past readyAt says arriving today, capitalised on request", () => {
    expect(arrivalLine(ready, new Date("2026-10-06T00:00:00Z"))).toBe("arriving today");
    expect(arrivalLine(ready, new Date("2026-10-06T00:00:00Z"), true)).toBe("Arriving today");
  });
});

describe("dayTime (R350)", () => {
  it("reads the date and the time in the phone's zone", () => {
    expect(dayTime("2026-10-05T14:11:34.294Z")).toBe("Oct 5, 7:11 AM");
    expect(dayTime("2026-10-05T07:24:00Z")).toBe("Oct 5, 12:24 AM");
    expect(dayTime("2026-10-06T00:05:00Z")).toBe("Oct 5, 5:05 PM");
  });
});

// R355 (10-05): coin amounts carry thousands separators, "12,980.46 SKR", wherever an amount is formatted.
describe("thousands separators on coin amounts", () => {
  it("formatSkr groups the whole part, with and without a price", () => {
    expect(formatSkr(12_980_460_000n, null)).toBe("12,980.46 SKR");
    expect(formatSkr(1_234_567_890_000n, null)).toBe("1,234,567.89 SKR");
    expect(formatSkr(999_990_000n, null)).toBe("999.99 SKR");
    expect(formatSkr(1_000_000_000n, null)).toBe("1,000.00 SKR");
    expect(formatSkr(12_980_460_000n, 0.01)).toBe("12,980.46 SKR ($129.80)");
  });
  it("formatStore and formatAmount group too", () => {
    expect(formatStore(1_234_567_890_000_000n, null)).toBe("12,345.6789 stORE");
    expect(formatAmount("SKR", 12_980_460_000n, null)).toBe("12,980.46 SKR");
    expect(formatAmount("USDC_LEND", 1_234_500_000n, null)).toBe("1,234.50 USDC");
    expect(formatAmount("hSOL", 1_234_500_000_000n, null)).toBe("1,234.5000 hSOL");
  });
  it("holdingAmount, positionAmount and underlyingAmount group too", () => {
    expect(holdingAmount({ asset: "USDC_LEND", heldRaw: "1234500000", valueUsd: null } as never)).toBe("1,234.50 USDC");
    expect(positionAmount({ asset: "USDC_LEND", underlyingRaw: "1234500000", valueUsd: null } as never)).toBe("1,234.50 USDC");
    expect(underlyingAmount("SOL_LEND", "1234500000000")).toBe("1,234.5000 SOL");
  });
  it("potHeadline's SKR line groups", () => {
    expect(potHeadline(12_980_460_000n, null)).toEqual({ big: "12,980.46 SKR", small: null });
  });
});

describe("formatUsd thousands (10-05: the widget showed $11407.00)", () => {
  it("groups thousands", () => {
    expect(formatUsd(1140700)).toBe("$11,407.00");
    expect(formatUsd(42069)).toBe("$420.69");
    expect(formatUsd(-123456789)).toBe("-$1,234,567.89");
  });
});
