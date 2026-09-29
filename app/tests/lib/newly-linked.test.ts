import { describe, it, expect } from "vitest";
import { newlyLinked } from "@/lib/newly-linked";

// The Connect screen waits for the web page to finish (the Saga, 2026-09-29: the app stayed on "Link a wallet" after Phantom linked).
const w = (pubkey: string, status = "active") => ({ pubkey, status, dailyCapCents: 500 });
describe("newlyLinked", () => {
  it("finds the wallet that was not there when the code was made", () => {
    expect(newlyLinked(["A"], [w("A"), w("B")])?.pubkey).toBe("B");
  });
  it("nothing new yet", () => {
    expect(newlyLinked(["A"], [w("A")])).toBeNull();
  });
  it("a revoked wallet coming back counts, a revoked one does not", () => {
    expect(newlyLinked([], [w("A", "revoked")])).toBeNull();
    expect(newlyLinked([], [w("A", "active")])?.pubkey).toBe("A");
  });
});
