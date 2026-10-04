import { describe, it, expect } from "vitest";
import { plantLabel } from "@/lib/plant-label";
import type { MeResponse } from "@/lib/api";

const me = {
  pot: { skrStakedRaw: "62630000", skrEarnedRaw: "0", skrUsd: 0.018, nextFruitProgress: 0 },
  holdings: [{ asset: "hSOL", heldRaw: "7300000", putInCents: 103, valueUsd: 1.04, earnedUsd: 0.003, earnedUnderlyingRaw: "1" }],
  nextPlanting: { pendingCents: 100, thresholdCents: 200, capLeftCents: 0, asset: "SKR" },
} as unknown as Pick<MeResponse, "pot" | "holdings" | "nextPlanting">;

describe("R250: a tapped plant's label", () => {
  it("SKR: its value, the change waiting toward the next planting; no earned line at nothing earned", () => {
    expect(plantLabel(me, "skr", false)).toEqual(["SKR · $1.13", "Your change: $1.00 of $2.00 for the next planting"]);
  });
  it("hSOL: its value, what it earned (under a cent) and the next token's growth", () => {
    const l = plantLabel(me, "hsol", false);
    expect(l[0]).toBe("hSOL · $1.04"); expect(l[1]).toMatch(/^Earned under 1¢, next token \d+% grown$/);
  });
  it("a plant with a bud says to water it; a coin with no holding shows its name alone", () => {
    expect(plantLabel(me, "cbbtc", true)).toEqual(["cbBTC", "A new sprout: water it to open"]);
  });
});
