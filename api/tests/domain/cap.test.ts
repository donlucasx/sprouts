import { describe, it, expect } from "vitest";
import { capCarryClaim, capLeftCents, plantAmountCents } from "@/domain/cap";

describe("cap", () => {
  it("cap left is cap minus pulled, never negative", () => {
    expect(capLeftCents(500, 120)).toBe(380);
    expect(capLeftCents(500, 900)).toBe(0);
  });

  it("plants pending plus fee when it fits", () => {
    expect(plantAmountCents({ pendingCents: 214, capLeftCents: 500, feeCents: 3, minCents: 200 })).toEqual({ pullCents: 217, changeCents: 214 });
  });

  it("cap left bounds the pull including fee", () => {
    expect(plantAmountCents({ pendingCents: 3000, capLeftCents: 500, feeCents: 3, minCents: 200 })).toEqual({ pullCents: 500, changeCents: 497 });
  });

  it("below the minimum plants nothing", () => {
    expect(plantAmountCents({ pendingCents: 140, capLeftCents: 500, feeCents: 3, minCents: 200 })).toEqual({ pullCents: 0, changeCents: 0 });
  });

  it("cap exhausted plants nothing", () => {
    expect(plantAmountCents({ pendingCents: 900, capLeftCents: 0, feeCents: 3, minCents: 200 })).toEqual({ pullCents: 0, changeCents: 0 });
  });

  it("forced (7-day rule) ignores the minimum but not the cap", () => {
    expect(plantAmountCents({ pendingCents: 140, capLeftCents: 500, feeCents: 3, minCents: 0 })).toEqual({ pullCents: 143, changeCents: 140 });
  });
});

// Cap carry (owner 11-13) with a nonzero network fee: plant-run's NETWORK_FEE_CENTS is a module constant (0 today) read inside the
// same module, so the run cannot be stubbed to a fee; the run's selection is this function, called with that constant. Selection reads
// the OWED amount (round 2: an oversized round-up is pulled in parts).
describe("capCarryClaim with a fee", () => {
  const sw = (...c: number[]) => c.map((owedCents, i) => ({ id: i, owedCents, roundupCents: owedCents + 1000 }));
  const ids = (r: { claim: { id: number }[] }) => r.claim.map((s) => s.id);

  it("fits owed amounts in the cap left minus the fee, oldest first, skipping one that does not fit", () => {
    const r = capCarryClaim(sw(200, 200, 97, 1), { capCents: 500, capLeftCents: 500, feeCents: 3 });
    expect(ids(r)).toEqual([0, 1, 2]);   // 497 of change: 200 + 200 + 97; the 1 would pass it
    expect(r.covered).toBe(497);
    expect(r.part).toBeNull();
    expect(plantAmountCents({ pendingCents: r.covered, capLeftCents: 500, feeCents: 3, minCents: 200 })).toEqual({ pullCents: 500, changeCents: 497 });
    expect(ids(capCarryClaim(sw(200, 200, 98, 1), { capCents: 500, capLeftCents: 500, feeCents: 3 }))).toEqual([0, 1, 3]);   // 98 passes 497
    expect(ids(capCarryClaim(sw(200, 200, 98), { capCents: 500, capLeftCents: 300, feeCents: 3 }))).toEqual([0]);   // 297 left after the fee
  });

  it("an oldest owed amount bigger than cap - fee becomes a part of cap - fee on a full day only, nothing claimed", () => {
    const full = capCarryClaim(sw(498, 10), { capCents: 500, capLeftCents: 500, feeCents: 3 });
    expect(ids(full)).toEqual([]);
    expect(full.part).toEqual({ swap: expect.objectContaining({ id: 0 }), cents: 497 });
    expect(full.covered).toBe(497);
    expect(plantAmountCents({ pendingCents: full.covered, capLeftCents: 500, feeCents: 3, minCents: 0 })).toEqual({ pullCents: 500, changeCents: 497 });
    expect(capCarryClaim(sw(498, 10), { capCents: 500, capLeftCents: 499, feeCents: 3 })).toEqual({ claim: [], covered: 0, part: null });
    const exact = capCarryClaim(sw(497, 10), { capCents: 500, capLeftCents: 500, feeCents: 3 });   // exactly a day: claimed whole, no part
    expect(ids(exact)).toEqual([0]);
    expect(exact.covered).toBe(497);
    expect(exact.part).toBeNull();
  });
});
