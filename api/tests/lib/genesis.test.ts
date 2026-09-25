import { describe, it, expect } from "vitest";
import { checkGenesisAccounts, GENESIS } from "@/lib/genesis";

const G = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";

describe("checkGenesisAccounts", () => {
  it("uses Solana Mobile's group address", () => expect(GENESIS).toBe(G));

  it("frozen account is kept", () => {
    expect(checkGenesisAccounts([{ mint: "M1", amount: 1n, frozen: true, metadataPointer: G, group: G }])).toEqual({ mint: "M1" });
  });

  it("empty account is dropped", () => {
    expect(checkGenesisAccounts([{ mint: "M1", amount: 0n, frozen: true, metadataPointer: G, group: G }])).toBeNull();
  });

  it("one field only is rejected", () => {
    expect(checkGenesisAccounts([{ mint: "M1", amount: 1n, frozen: false, metadataPointer: G, group: "Other" }])).toBeNull();
    expect(checkGenesisAccounts([{ mint: "M1", amount: 1n, frozen: false, metadataPointer: null, group: G }])).toBeNull();
  });

  it("returns the first matching mint among many accounts", () => {
    expect(checkGenesisAccounts([
      { mint: "X", amount: 5n, frozen: false, metadataPointer: null, group: null },
      { mint: "M2", amount: 1n, frozen: true, metadataPointer: G, group: G },
    ])).toEqual({ mint: "M2" });
  });
});
