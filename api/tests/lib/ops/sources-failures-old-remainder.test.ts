import { describe, it, expect, vi } from "vitest";

// Table-aware fake of the Supabase client (eq/gte/lt/in, order, range). PostgREST itself is not run.
type R = Record<string, unknown>;
const tables: Record<string, R[]> = {};
const cell = (r: R, col: string): unknown => r[col.split(":")[0]];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      let rs = [...(tables[table] ?? [])];
      let range: [number, number] | null = null;
      const q: R = {
        select: () => q,
        eq: (c: string, v: unknown) => { rs = rs.filter((r) => cell(r, c) === v); return q; },
        gte: (c: string, v: string) => { rs = rs.filter((r) => String(cell(r, c)) >= v); return q; },
        lt: (c: string, v: string) => { rs = rs.filter((r) => String(cell(r, c)) < v); return q; },
        in: (c: string, v: unknown[]) => { rs = rs.filter((r) => v.includes(cell(r, c))); return q; },
        not: () => q,
        order: () => q,
        limit: () => q,
        range: (a: number, b: number) => { range = [a, b]; return q; },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: range ? rs.slice(range[0], range[1] + 1) : rs, error: null }).then(ok),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<R>()), config: () => ({ supabaseUrl: "http://x", supabaseServiceKey: "k", opsExcludeWallets: "" }) }));

import { realOpsSources } from "@/lib/ops/sources";

const P1 = "aaaaaaaa-0000-0000-0000-000000000001", P2 = "bbbbbbbb-0000-0000-0000-000000000002";
const SINCE = "2026-10-30T00:00:00.000Z";

describe("kimi M3: an unresolved remainder event older than the window is still returned", () => {
  it("old unresolved is kept (resolved false); old resolved is dropped; other old kinds are not read", async () => {
    tables.events = [
      { id: 1, ts: "2026-09-01T00:00:00Z", kind: "remainder_unrecorded", user_pubkey: "U", wallet_pubkey: "W", planting: P1, rkind: "SKR" },
      { id: 2, ts: "2026-09-02T00:00:00Z", kind: "remainder_unrecorded", user_pubkey: "U", wallet_pubkey: "W", planting: P2, rkind: "SKR" },
      { id: 4, ts: "2026-09-04T00:00:00Z", kind: "remainder_unrecorded", user_pubkey: "U", wallet_pubkey: "W", planting: null, rkind: "SKR" },
      { id: 3, ts: "2026-09-03T00:00:00Z", kind: "pull_failed", user_pubkey: "U", wallet_pubkey: "W" },
    ];
    tables.plantings = [{ id: P1, skr_surplus_raw: null, planting_legs: [], carry: [] }, { id: P2, skr_surplus_raw: 5, planting_legs: [], carry: [] }];
    const out = await realOpsSources().failures(SINCE);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "remainder_unrecorded", resolved: false });
  });
});
