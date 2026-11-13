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
