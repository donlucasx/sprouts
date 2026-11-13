import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "@/db/supabase";

/**
 * Cap carry round 3 (review): the swap_parts read, at the level the other Supabase reads are tested (a recorded query chain, as in
 * supabase-moves.test.ts): every filter of each query is recorded, and each query answers the rows given for its table. PostgREST
 * itself is not run: that `plantings!inner(status)` plus `.in("plantings.status", ...)` drops a part of a failed planting is
 * PostgREST's embed semantics, asserted here only as the query sent.
 */
function fakeDb(rows: Record<string, unknown[]>) {
  const calls: string[] = [];
  const query = (table: string) => {
    const q: Record<string, unknown> = {
      select: (c?: string) => { calls.push(`${table} select ${c ?? "*"}`); return q; },
      eq: (c: string, v: unknown) => { calls.push(`${table} eq ${c}=${String(v)}`); return q; },
      is: (c: string, v: unknown) => { calls.push(`${table} is ${c}=${String(v)}`); return q; },
      in: (c: string, v: unknown[]) => { calls.push(`${table} in ${c}=${v.join(",")}`); return q; },
      order: (c: string) => { calls.push(`${table} order ${c}`); return q; },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(ok),
    };
    return q;
  };
  return { repo: new SupabaseRepo({ from: query } as unknown as SupabaseClient), calls };
}
const swap = (signature: string, roundup: number) => ({ signature, wallet_pubkey: "W", ts: "2026-11-13T10:00:00Z", in_mint: "a", in_amount: 1, out_mint: "b", out_amount: 1, usd_size_cents: 1, class: "major", roundup_cents: roundup, planting_id: null, created_at: "2026-11-13T10:00:00Z" });

describe("SupabaseRepo swap parts read (0013)", () => {
  it("unplantedSwaps reads the parts of sent or confirmed plantings and answers owedCents and partInFlight", async () => {
    const { repo, calls } = fakeDb({
      swaps: [swap("S", 1000), swap("T", 300), swap("Z", 0), swap("P", 500)],
      swap_parts: [
        { planting_id: "p1", signature: "S", cents: 300, plantings: { status: "confirmed" } },
        { planting_id: "p2", signature: "S", cents: 200, plantings: { status: "sent" } },
        { planting_id: "p3", signature: "P", cents: 500, plantings: { status: "confirmed" } },
      ],
    });
    const got = await repo.unplantedSwaps("W");
    expect(got.map((s) => [s.signature, s.owedCents, s.partInFlight])).toEqual([["S", 500, true], ["T", 300, false], ["Z", 0, false]]);   // P paid off
    expect(calls).toEqual([
      "swaps select *", "swaps eq wallet_pubkey=W", "swaps is planting_id=null", "swaps order ts",
      "swap_parts select planting_id, signature, cents, plantings!inner(status)", "swap_parts in signature=S,T,Z,P", "swap_parts in plantings.status=sent,confirmed",
    ]);
  });

  it("partsBySwap leaves out the caller's own planting and makes no query for no signatures", async () => {
    const { repo, calls } = fakeDb({ swap_parts: [{ planting_id: "mine", signature: "S", cents: 500, plantings: { status: "sent" } }, { planting_id: "other", signature: "S", cents: 100, plantings: { status: "confirmed" } }] });
    expect(await repo.partsBySwap(["S"], "mine")).toEqual(new Map([["S", { cents: 100, inFlight: false }]]));
    const none = fakeDb({});
    expect(await none.repo.partsBySwap([])).toEqual(new Map());
    expect(none.calls).toEqual([]);
    expect(calls.length).toBe(3);
  });
});
