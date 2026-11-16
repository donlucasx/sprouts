import { describe, it, expect } from "vitest";
import type { Pins, Split } from "@/lib/coins";
import { pinsForOff, pinsForOn, draftShares, splitTotal, splitRows, pinsToSave, offCoins } from "@/model/manager";

const split = (p: Partial<Split>): Split => ({ SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0, ...p });
const offView = (pins: Pins) => ({ managed: false, stop: "balanced" as const, pins, allocation: split({}) });

// Device bug 11-16: turning the manager off showed USDC 100 / SOL 0 (manualSplit of the 0 pins) instead of the planted USDC 75 / SOL 25.
describe("pinsForOff: the manager off starts from the split being planted", () => {
  const ownerAlloc = split({ USDC_LEND: 75, SOL_LEND: 25 });
  const ownerPins: Pins = { SKR: 0, stORE: 0, hSOL: 0, cbBTC: 0 };

  it("the owner's case: USDC 75 / SOL 25, total 100, the switched-off coins stay off", () => {
    const pins = pinsForOff(ownerAlloc, ownerPins);
    expect(pins).toEqual({ SKR: 0, stORE: 0, USDC_LEND: 75, SOL_LEND: 25, hSOL: 0, cbBTC: 0 });
    expect(draftShares(pins)).toEqual(ownerAlloc);
    expect(splitTotal(draftShares(pins)).ok).toBe(true);
    const rows = splitRows(offView(pins), draftShares(pins));
    expect(rows.find((r) => r.asset === "USDC_LEND")).toMatchObject({ mode: "pinned", pct: 75 });
    expect(rows.find((r) => r.asset === "SOL_LEND")).toMatchObject({ mode: "pinned", pct: 25 });
    for (const c of ["SKR", "stORE", "hSOL", "cbBTC"] as const) expect(rows.find((r) => r.asset === c)!.mode).toBe("off");
  });

  it("no coin off: every coin at exactly its allocation, total 100", () => {
    const alloc = split({ SKR: 38, hSOL: 12, cbBTC: 8, stORE: 20, SOL_LEND: 2, USDC_LEND: 20 });
    const pins = pinsForOff(alloc, {});
    expect(draftShares(pins)).toEqual(alloc);
    expect(splitTotal(draftShares(pins))).toMatchObject({ total: 100, ok: true });
    expect(offCoins(pins)).toEqual([]);
  });

  it("a coin on at 0 stays on (no pin) in the draft, and goes off at save", () => {
    const pins = pinsForOff(split({ SKR: 60, USDC_LEND: 40 }), { cbBTC: 0 });
    expect(pins).toEqual({ SKR: 60, USDC_LEND: 40, cbBTC: 0 });
    expect(splitRows(offView(pins), draftShares(pins)).find((r) => r.asset === "hSOL")).toMatchObject({ mode: "pinned", pct: 0 });
    expect(pinsToSave(pins)).toEqual({ SKR: 60, stORE: 0, USDC_LEND: 40, SOL_LEND: 0, hSOL: 0, cbBTC: 0 });
  });

  it("a coin switched off keeps its 0 even if the allocation still gave it a share", () => {
    expect(pinsForOff(split({ SKR: 50, hSOL: 50 }), { hSOL: 0 })).toEqual({ SKR: 50, hSOL: 0 });
  });

  it("on then off again in the same draft returns to the same numbers", () => {
    const first = pinsForOff(ownerAlloc, ownerPins);
    const back = pinsForOff(ownerAlloc, pinsForOn(first));
    expect(back).toEqual(first);
    // Back on: the manual shares go, the 0 pins stay (unchanged R346 behaviour).
    expect(pinsForOn(first)).toEqual(ownerPins);
  });
});
