import { describe, it, expect } from "vitest";
import { shortWallet, excludedWallets } from "@/lib/ops/sources";

describe("shortWallet", () => {
  it("keeps the first 4 and last 3 characters", () => expect(shortWallet("7YsvAbCdEfGhJkMnPqRsTuVwXyZ12345")).toBe("7Ysv…345"));
  it("never returns the full key", () => {
    const k = "Fake1Wallet111111111111111111111111111111111";
    expect(shortWallet(k)).not.toContain(k.slice(0, 10));
    expect(shortWallet(k)).toHaveLength(8);
  });
});

describe("excludedWallets", () => {
  it("undefined is an empty set", () => expect(excludedWallets(undefined).size).toBe(0));
  it("empty string is an empty set", () => expect(excludedWallets("").size).toBe(0));
  it("splits on commas, trims, drops blanks", () => expect([...excludedWallets("a, b,,c")].sort()).toEqual(["a", "b", "c"]));
});

import { remainderResolved } from "@/lib/ops/sources";

describe("remainderResolved (audit F1)", () => {
  const legs = new Map<string, string[]>([["p1", ["SKR"]], ["p2", ["SOL_LEND"]], ["p3", ["hSOL"]]]);
  const seen = (skr: string[], carry: string[]) => ({ skrRecorded: new Set(skr), carryRecorded: new Set(carry), legsOf: legs });
  it("SKR: resolved once that planting's surplus is no longer NULL", () => {
    expect(remainderResolved({ plantingId: "p1", kind: "SKR" }, seen([], []))).toBe(false);
    expect(remainderResolved({ plantingId: "p1", kind: "SKR" }, seen(["p1"], []))).toBe(true);
  });
  it("WSOL/USDC: resolved once the carry row's surplus is set", () => {
    expect(remainderResolved({ plantingId: "p2", kind: "WSOL" }, seen([], ["p2:USDC"]))).toBe(false);
    expect(remainderResolved({ plantingId: "p2", kind: "WSOL" }, seen([], ["p2:WSOL"]))).toBe(true);
  });
  it("legs: resolved when every remainder the planting's legs owe is recorded, or it owes none", () => {
    expect(remainderResolved({ plantingId: "p2", kind: "legs" }, seen([], []))).toBe(false);
    expect(remainderResolved({ plantingId: "p2", kind: "legs" }, seen([], ["p2:WSOL"]))).toBe(true);
    expect(remainderResolved({ plantingId: "p3", kind: "legs" }, seen([], []))).toBe(true);
  });
  it("an unknown kind or a missing planting id stays open", () => {
    expect(remainderResolved({ plantingId: null, kind: "SKR" }, seen(["p1"], []))).toBe(false);
    expect(remainderResolved({ plantingId: "p1", kind: "nope" }, seen(["p1"], []))).toBe(false);
  });
});

describe("remainderResolved: a legs event for a planting the read did not return stays open", () => {
  it("is not resolved", () => expect(remainderResolved({ plantingId: "gone", kind: "legs" }, { skrRecorded: new Set(), carryRecorded: new Set(), legsOf: new Map() })).toBe(false));
});
