import { describe, it, expect, vi } from "vitest";

// 11-07: a swap Jupiter sends as a v1 transaction must be readable by the swap check (asked for at most v0, the RPC refuses it).
const calls: unknown[] = [];
vi.mock("@/lib/rpc", () => ({
  rpc: () => ({ getTransaction: (sig: unknown, opts: unknown) => { calls.push(opts); return { send: async () => null }; } }),
}));

import { fetchTransaction, MAX_TX_VERSION } from "@/lib/verify-swap";

describe("fetchTransaction", () => {
  it("asks the RPC for transactions up to v1 (Jupiter's v1 swaps were refused at v0 and never booked)", async () => {
    await fetchTransaction("5NUn44dCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(MAX_TX_VERSION).toBe(1);
    expect(calls[0]).toMatchObject({ maxSupportedTransactionVersion: 1, encoding: "jsonParsed", commitment: "confirmed" });
  });
});
