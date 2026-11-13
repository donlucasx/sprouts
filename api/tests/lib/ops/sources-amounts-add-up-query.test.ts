import { describe, it, expect, vi } from "vitest";

// A table-aware fake of the Supabase client: honors eq/gte/in (an embedded `plantings.status` reads the row's `plantings.status`),
// order and range, and records each query. PostgREST itself is not run.
type R = Record<string, unknown>;
const tables: Record<string, R[]> = {};
const calls: string[] = [];
const cell = (r: R, col: string): unknown => (col.includes(".") ? col.split(".").reduce<unknown>((o, k) => (o as R | undefined)?.[k], r) : r[col]);

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      let rs = [...(tables[table] ?? [])];
      let range: [number, number] | null = null;
      const q: R = {
        select: (c: string) => { calls.push(`${table} select ${c}`); return q; },
        eq: (c: string, v: unknown) => { rs = rs.filter((r) => cell(r, c) === v); return q; },
        gte: (c: string, v: string) => { rs = rs.filter((r) => String(cell(r, c)) >= v); return q; },
        in: (c: string, v: unknown[]) => { calls.push(`${table} in ${c}`); rs = rs.filter((r) => v.includes(cell(r, c))); return q; },
        order: () => q,
        range: (a: number, b: number) => { range = [a, b]; return q; },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: range ? rs.slice(range[0], range[1] + 1) : rs, error: null }).then(ok),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<R>()), config: () => ({ supabaseUrl: "http://x", supabaseServiceKey: "k", opsExcludeWallets: "TESTW" }) }));

import { realOpsSources } from "@/lib/ops/sources";
import { amountsAddUpLight } from "@/lib/ops/lights";

const plant = (id: string, pulled: number, over: R = {}) => ({ id, user_pubkey: "U", wallet_pubkey: "W", ts: "2026-11-10T00:00:00Z", status: "confirmed", usdc_pulled_cents: pulled, network_fee_cents: 15, ...over });
const reset = () => { for (const k of Object.keys(tables)) delete tables[k]; calls.length = 0; };

describe("amountsAddUp source (mocked client)", () => {
  it("a part by A then the whole claim of the rest by B, both in the window: both green", async () => {
    reset();
    const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002";
    tables.plantings = [plant(A, 1015), plant(B, 515)];
    tables.swaps = [{ planting_id: B, signature: "big", roundup_cents: 1500 }];
    tables.swap_parts = [{ planting_id: A, signature: "big", cents: 1000, plantings: { status: "confirmed" } }];
    tables.planting_legs = [{ planting_id: A, asset: "SKR", usdc_in_cents: 1000 }, { planting_id: B, asset: "SKR", usdc_in_cents: 500 }];
    const rows = await realOpsSources().amountsAddUp("2026-10-13T00:00:00.000Z");
    expect(rows.map((r) => [r.claimedCents, r.pulledCents, r.legsCents])).toEqual([[1000, 1000, 1000], [500, 500, 500]]);
    expect(amountsAddUpLight({ rows }).state).toBe("green");
    expect(calls).toContain("swap_parts in signature");   // the other-plantings read, by signature
  });
  it("a failed planting's part is not read, and plantings outside the window or not confirmed or on a test wallet are left out", async () => {
    reset();
    tables.plantings = [plant("p1", 515), plant("old", 515, { ts: "2026-09-01T00:00:00Z" }), plant("sent", 515, { status: "sent" }), plant("test", 515, { wallet_pubkey: "TESTW" })];
    tables.swaps = [{ planting_id: "p1", signature: "s", roundup_cents: 500 }];
    tables.swap_parts = [{ planting_id: "failed", signature: "s", cents: 300, plantings: { status: "failed" } }];
    tables.planting_legs = [{ planting_id: "p1", asset: "SKR", usdc_in_cents: 500 }];
    const rows = await realOpsSources().amountsAddUp("2026-10-13T00:00:00.000Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ claimedCents: 500, pulledCents: 500, legsCents: 500 });
  });
  it("pages the plantings read past the 1000-row limit (1200 plantings, all counted)", async () => {
    reset();
    const ids = Array.from({ length: 1200 }, (_, i) => `p${String(i).padStart(4, "0")}`);
    tables.plantings = ids.map((id) => plant(id, 215));
    tables.planting_legs = ids.map((id) => ({ planting_id: id, asset: "SKR", usdc_in_cents: 200 }));
    const rows = await realOpsSources().amountsAddUp("2026-10-13T00:00:00.000Z");
    expect(rows).toHaveLength(1200);
    expect(rows.every((r) => r.legsCents === 200)).toBe(true);
  });
});
