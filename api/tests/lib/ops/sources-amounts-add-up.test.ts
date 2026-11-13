import { describe, it, expect } from "vitest";
import { addUpRows } from "@/lib/ops/sources";

const P = (id: string, pulled: number, fee = 15, user = "U" + id, wallet = "W" + id) => ({ id, user_pubkey: user, wallet_pubkey: wallet, usdc_pulled_cents: pulled, network_fee_cents: fee });
const none = { swaps: [], parts: [], legs: [] };

describe("addUpRows", () => {
  it("claimed = round-ups of the swaps it claimed; pulled = pulled minus the network fee; legs summed", () => {
    const rows = addUpRows({
      plantings: [P("p1aaaaaaaa1", 515)],
      swaps: [{ planting_id: "p1aaaaaaaa1", signature: "s1", roundup_cents: 300 }, { planting_id: "p1aaaaaaaa1", signature: "s2", roundup_cents: 200 }],
      parts: [], legs: [{ planting_id: "p1aaaaaaaa1", usdc_in_cents: 500 }],
    }, new Set());
    expect(rows).toEqual([{ id: "p1aa…aa1", claimedCents: 500, pulledCents: 500, legsCents: 500, legCount: 1 }]);
  });
  it("a part is a claim too (the swap stays unclaimed)", () => {
    const [r] = addUpRows({ plantings: [P("p2aaaaaaaa2", 515)], swaps: [], parts: [{ planting_id: "p2aaaaaaaa2", signature: "big", cents: 500 }], legs: [{ planting_id: "p2aaaaaaaa2", usdc_in_cents: 500 }] }, new Set());
    expect(r).toMatchObject({ claimedCents: 500, pulledCents: 500 });
  });
  it("the planting that claims the rest of a swap owes only the rest: parts of other plantings come off", () => {
    const [r] = addUpRows({
      plantings: [P("p3aaaaaaaa3", 515)],
      swaps: [{ planting_id: "p3aaaaaaaa3", signature: "big", roundup_cents: 1500 }],
      parts: [{ planting_id: "earlier", signature: "big", cents: 1000 }],   // pulled by an earlier planting
      legs: [{ planting_id: "p3aaaaaaaa3", usdc_in_cents: 500 }],
    }, new Set());
    expect(r).toMatchObject({ claimedCents: 500, pulledCents: 500 });
  });
  it("its own part on a swap it also claims is not counted twice", () => {
    const [r] = addUpRows({
      plantings: [P("p4aaaaaaaa4", 515)],
      swaps: [{ planting_id: "p4aaaaaaaa4", signature: "big", roundup_cents: 500 }],
      parts: [{ planting_id: "p4aaaaaaaa4", signature: "big", cents: 500 }], legs: [{ planting_id: "p4aaaaaaaa4", usdc_in_cents: 500 }],
    }, new Set());
    expect(r.claimedCents).toBe(500);
  });
  it("a planting with no swaps, parts or legs reads 0 claimed and 0 legs", () => {
    expect(addUpRows({ plantings: [P("p5aaaaaaaa5", 515)], ...none }, new Set())[0]).toMatchObject({ claimedCents: 0, legsCents: 0, legCount: 0, pulledCents: 500 });
  });
  it("leaves out test wallets by user or wallet key", () => {
    const ps = [P("p6aaaaaaaa6", 515, 15, "TESTUSER"), P("p7aaaaaaaa7", 515, 15, "u", "TESTWALLET"), P("p8aaaaaaaa8", 515)];
    expect(addUpRows({ plantings: ps, ...none }, new Set(["TESTUSER", "TESTWALLET"])).map((r) => r.id)).toEqual(["p8aa…aa8"]);
  });
  it("the id is the short form only", () => {
    expect(addUpRows({ plantings: [P("11111111-2222-3333-4444-555555555555", 515)], ...none }, new Set())[0].id).toBe("1111…555");
  });
  it("a part arriving in both reads (own and other) is counted once: part by A, whole claim of the rest by B", () => {
    const partA = { planting_id: "AAAAAAAAAA1", signature: "big", cents: 1000 };
    const rows = addUpRows({
      plantings: [P("AAAAAAAAAA1", 1015), P("BBBBBBBBBB2", 515)],
      swaps: [{ planting_id: "BBBBBBBBBB2", signature: "big", roundup_cents: 1500 }],
      parts: [partA, { ...partA }],
      legs: [{ planting_id: "AAAAAAAAAA1", usdc_in_cents: 1000 }, { planting_id: "BBBBBBBBBB2", usdc_in_cents: 500 }],
    }, new Set());
    expect(rows.map((r) => [r.claimedCents, r.pulledCents])).toEqual([[1000, 1000], [500, 500]]);
  });
});
