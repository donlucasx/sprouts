import { describe, it, expect } from "vitest";
import { pickVenue, moveQualifies, eligibleVenue, avg7, VENUE_PROTOCOL, type VenueCandidate } from "@/domain/venues";

const k = (avg7Pct: number | null, over: Partial<VenueCandidate> = {}): VenueCandidate => ({ venue: "kamino_klend", avg7Pct, eligible: true, verdict: null, ...over });
const j = (avg7Pct: number | null, over: Partial<VenueCandidate> = {}): VenueCandidate => ({ venue: "jupiter_lend", avg7Pct, eligible: true, verdict: null, ...over });

describe("eligibility (spec 3)", () => {
  it("rate inside 0-15%, utilization at most 95%, TVL at least $10M", () => {
    expect(eligibleVenue({ supplyPct: 4.43, utilizationPct: 91.1, tvlUsd: 120_900_000 })).toBe(true);
    expect(eligibleVenue({ supplyPct: 15.01, utilizationPct: 50, tvlUsd: 2e8 })).toBe(false);
    expect(eligibleVenue({ supplyPct: -0.1, utilizationPct: 50, tvlUsd: 2e8 })).toBe(false);
    expect(eligibleVenue({ supplyPct: 4, utilizationPct: 95.01, tvlUsd: 2e8 })).toBe(false);
    expect(eligibleVenue({ supplyPct: 8.62, utilizationPct: 10, tvlUsd: 104 })).toBe(false);   // the AWnKJ9 dust reserve
    expect(eligibleVenue({ supplyPct: null, utilizationPct: 50, tvlUsd: 2e8 })).toBe(false);
  });
});

describe("pickVenue: best 7-day average among eligible, not vetoed, under the 60% cap from $20 (R293)", () => {
  it("below $20 of lending the best rate wins", () => {
    expect(pickVenue({ candidates: [k(4.43), j(4.19)], lendingUsdByProtocol: {}, addUsd: 2 })).toBe("kamino_klend");
  });
  it("a veto or an ineligible venue loses; none left answers null", () => {
    expect(pickVenue({ candidates: [k(4.43, { verdict: "avoid" }), j(4.19)], lendingUsdByProtocol: {}, addUsd: 2 })).toBe("jupiter_lend");
    expect(pickVenue({ candidates: [k(4.43, { eligible: false }), j(4.19, { verdict: "avoid" })], lendingUsdByProtocol: {}, addUsd: 2 })).toBeNull();
    expect(pickVenue({ candidates: [k(null), j(null)], lendingUsdByProtocol: {}, addUsd: 2 })).toBeNull();
  });
  it("from $20 no protocol may pass 60% after the new money", () => {
    expect(pickVenue({ candidates: [k(4.43), j(4.19)], lendingUsdByProtocol: { kamino: 20 }, addUsd: 2 })).toBe("jupiter_lend");   // 22/22 > 0.6; jupiter 2/22
    expect(pickVenue({ candidates: [k(4.43), j(4.19)], lendingUsdByProtocol: { kamino: 10, jupiter: 10 }, addUsd: 2 })).toBe("kamino_klend");   // 12/22 = 0.545
    expect(pickVenue({ candidates: [k(4.43), j(4.19, { verdict: "avoid" })], lendingUsdByProtocol: { kamino: 20 }, addUsd: 2 })).toBeNull();   // cap + veto: the share goes to the next leg
    expect(pickVenue({ candidates: [k(4.43), j(4.19)], lendingUsdByProtocol: { kamino: 19.99 }, addUsd: 2 })).toBe("kamino_klend");   // under $20, no cap
  });
  it("a leashed user is limited to the venues whose leash leg is enabled", () => {
    expect(pickVenue({ candidates: [k(4.43), j(4.19)], lendingUsdByProtocol: {}, addUsd: 2, allowed: ["jupiter_lend"] })).toBe("jupiter_lend");
    expect(pickVenue({ candidates: [k(4.43), j(4.19)], lendingUsdByProtocol: {}, addUsd: 2, allowed: [] })).toBeNull();
  });
  it("ties go to Kamino (AUTO_VENUES order)", () => {
    expect(pickVenue({ candidates: [j(4.2), k(4.2)], lendingUsdByProtocol: {}, addUsd: 2 })).toBe("kamino_klend");
  });
  it("the SM vault counts toward Kamino's 60%", () => {
    expect(VENUE_PROTOCOL.kamino_sm_vault).toBe("kamino");
  });
});

describe("moveQualifies (spec 7, R280)", () => {
  it("30-day dollar gain on 7-day averages must beat 3x the network cost", () => {
    const big = moveQualifies({ valueUsd: 1000, fromAvg7Pct: 4.19, toAvg7Pct: 4.43, costUsd: 0.01 });
    expect(big.gain30dUsd).toBeCloseTo(0.19726, 5);   // 1000 x 0.24% x 30 / 365
    expect(big.qualifies).toBe(true);
    const small = moveQualifies({ valueUsd: 5, fromAvg7Pct: 4.19, toAvg7Pct: 4.43, costUsd: 0.01 });
    expect(small.gain30dUsd).toBeCloseTo(0.000986, 6);
    expect(small.qualifies).toBe(false);
    expect(moveQualifies({ valueUsd: 1000, fromAvg7Pct: 4.43, toAvg7Pct: 4.19, costUsd: 0 }).qualifies).toBe(false);
  });
});

describe("avg7 (bootstrap: spot while fewer than 2 rows, Kimi round 2 #10)", () => {
  it("means the ok rows' supply rates and counts them", () => {
    expect(avg7([{ supplyPct: 4.4, ok: true }, { supplyPct: 4.5, ok: true }])).toEqual({ avg7Pct: 4.45, daysMeasured: 2 });
    expect(avg7([{ supplyPct: 4.4, ok: true }])).toEqual({ avg7Pct: 4.4, daysMeasured: 1 });
    expect(avg7([{ supplyPct: null, ok: false }])).toEqual({ avg7Pct: null, daysMeasured: 0 });
  });
});

import { venueCandidates } from "@/domain/venues";
describe("venueCandidates (spec 3: an out-of-band rate is no data, yesterday's row stands)", () => {
  const row = (venue: "kamino_klend" | "jupiter_lend", supplyPct: number | null, avg7Pct: number, verdict: "ok" | "avoid" | null = null) => ({ venue, asset: "USDC_LEND" as const, supplyPct, avg7Pct, eligible: supplyPct !== null && supplyPct <= 15, verdict });
  it("uses today's row, falls back to yesterday's when today's rate is out of band, and keeps today's veto", () => {
    const c = venueCandidates("USDC_LEND", [row("kamino_klend", 40, 40, "avoid"), row("jupiter_lend", 4.19, 4.19)], [row("kamino_klend", 4.43, 4.43)]);
    expect(c).toEqual([{ venue: "kamino_klend", avg7Pct: 4.43, eligible: true, verdict: "avoid" }, { venue: "jupiter_lend", avg7Pct: 4.19, eligible: true, verdict: null }]);
    expect(venueCandidates("USDC_LEND", [], [])).toEqual([{ venue: "kamino_klend", avg7Pct: null, eligible: false, verdict: null }, { venue: "jupiter_lend", avg7Pct: null, eligible: false, verdict: null }]);
  });
});
