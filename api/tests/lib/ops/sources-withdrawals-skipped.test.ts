import { describe, it, expect, vi } from "vitest";

// 11-14 (ops #6): the crank closes superseded rows by skipped_at (never cancel_signature). The Money-ops light must read such a row
// as closed: its withdraw_failed resolves, and it is no longer the oldest pending withdrawal. Table-aware fake of the Supabase
// client (eq/is/gte/in, order by one column, limit); PostgREST itself is not run.
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
        is: (c: string, v: null) => { rs = rs.filter((r) => (r[c] ?? null) === v); return q; },
        gte: (c: string, v: string) => { rs = rs.filter((r) => String(cell(r, c)) >= v); return q; },
        lt: (c: string, v: string) => { rs = rs.filter((r) => String(cell(r, c)) < v); return q; },
        in: (c: string, v: unknown[]) => { rs = rs.filter((r) => v.includes(cell(r, c))); return q; },
        not: () => q,
        order: (c: string, o?: { ascending?: boolean }) => { rs.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (o?.ascending === false ? -1 : 1)); return q; },
        limit: (n: number) => { rs = rs.slice(0, n); return q; },
        range: (a: number, b: number) => { range = [a, b]; return q; },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: range ? rs.slice(range[0], range[1] + 1) : rs, error: null }).then(ok),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<R>()), config: () => ({ supabaseUrl: "http://x", supabaseServiceKey: "k", opsExcludeWallets: "" }) }));

import { realOpsSources } from "@/lib/ops/sources";

const SINCE = "2026-11-12T00:00:00.000Z";

describe("ops sources read a row closed as skipped (superseded) as resolved", () => {
  it("withdraw_failed on a skipped row is resolved; on an open row it is not", async () => {
    tables.events = [
      { id: 1, ts: "2026-11-13T14:12:00Z", kind: "withdraw_failed", user_pubkey: "U", wallet_pubkey: null, withdrawal: "skipped-row" },
      { id: 2, ts: "2026-11-13T14:12:01Z", kind: "withdraw_failed", user_pubkey: "U", wallet_pubkey: null, withdrawal: "open-row" },
    ];
    tables.withdrawals = [
      { id: "skipped-row", withdraw_signature: null, cancel_signature: null, skipped_at: "2026-11-14T14:12:00Z", unstake_ts: "2026-10-29T14:12:00Z" },
      { id: "open-row", withdraw_signature: null, cancel_signature: null, skipped_at: null, unstake_ts: "2026-11-13T14:12:00Z" },
    ];
    const out = await realOpsSources().failures(SINCE);
    expect(out.map((f) => f.resolved)).toEqual([true, false]);
  });

  it("the oldest pending withdrawal skips rows closed as skipped", async () => {
    tables.withdrawals = [
      { id: "skipped-row", user_pubkey: "U", withdraw_signature: null, cancel_signature: null, skipped_at: "2026-11-14T14:12:00Z", unstake_ts: "2026-10-29T14:12:00Z" },
      { id: "open-row", user_pubkey: "U", withdraw_signature: null, cancel_signature: null, skipped_at: null, unstake_ts: "2026-11-13T14:12:00Z" },
    ];
    expect((await realOpsSources().oldestPendingWithdrawalAt())?.toISOString()).toBe("2026-11-13T14:12:00.000Z");
  });
});
