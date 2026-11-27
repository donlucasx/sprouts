import { describe, it, expect, vi, beforeEach } from "vitest";

// A table-aware fake of the Supabase client for the swapCheck source: eq/gte/not-is-null/or(signature.like.X*)/order/range/limit.
type R = Record<string, unknown>;
const tables: Record<string, R[]> = {};
const selects: string[] = [];

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => {
      let rs = [...(tables[table] ?? [])];
      let range: [number, number] | null = null;
      const q: R = {
        select: (c: string) => { selects.push(`${table}: ${c}`); return q; },
        eq: (c: string, v: unknown) => { rs = rs.filter((r) => r[c] === v); return q; },
        gte: (c: string, v: string) => { rs = rs.filter((r) => String(r[c]) >= v); return q; },
        not: (c: string, op: string, v: unknown) => { if (op === "is" && v === null) rs = rs.filter((r) => r[c] != null); return q; },
        or: (f: string) => {
          const prefixes = f.split(",").map((p) => { const m = /^signature\.like\.([1-9A-HJ-NP-Za-km-z]+)\*$/.exec(p); if (!m) throw new Error(`bad filter ${p}`); return m[1]; });
          rs = rs.filter((r) => prefixes.some((p) => String(r.signature).startsWith(p)));
          return q;
        },
        order: (c: string, o?: { ascending?: boolean }) => { rs.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (o?.ascending === false ? -1 : 1)); return q; },
        range: (a: number, b: number) => { range = [a, b]; return q; },
        limit: (n: number) => { range = [0, n - 1]; return q; },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: range ? rs.slice(range[0], range[1] + 1) : rs, error: null }).then(ok),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/config", async (orig) => ({ ...(await orig<R>()), config: () => ({ supabaseUrl: "http://x", supabaseServiceKey: "k", opsExcludeWallets: "TESTW" }) }));

import { realOpsSources } from "@/lib/ops/sources";

const SINCE = "2026-11-07T12:00:00.000Z";
const run = (finished: string, check: unknown) => ({ day: finished.slice(0, 10), finished_at: finished, check });
const miss = (sig: string, ts: string, roundupCents: number) => ({ wallet: "5t9Y…J9t", sig, ts, roundupCents });

beforeEach(() => { for (const k of Object.keys(tables)) delete tables[k]; selects.length = 0; });

describe("swapCheck source (mocked client)", () => {
  it("the newest finished run gives the last check; misses across the week are deduped, and ones booked since are dropped", async () => {
    tables.cron_runs = [
      run("2026-11-14T08:00:00Z", { checked: 14, unchecked: [{ wallet: "A5Tq…8Wa", why: "page_cap" }], deferred: 0, missed: [miss("44gdAAAA", "2026-11-13T09:14Z", 66)] }),
      run("2026-11-13T08:00:00Z", { checked: 15, unchecked: [], deferred: 0, missed: [miss("44gdAAAA", "2026-11-13T09:14Z", 66), miss("2dKkBBBB", "2026-11-12T19:47Z", 98), miss("CREDITED", "2026-11-12T10:00Z", 50)] }),
      run("2026-11-05T08:00:00Z", { checked: 15, unchecked: [], deferred: 0, missed: [miss("OLDDDDDD", "2026-11-04T10:00Z", 70)] }),
      { day: "2026-11-15", finished_at: null, check: null },   // running now
    ];
    tables.swaps = [{ signature: "CREDITEDxxxxxxxxxxxx" }];
    tables.events = [
      { id: 1, kind: "swap_refused", ts: "2026-11-10T00:00:00Z", wallet_pubkey: "W1" },
      { id: 2, kind: "swap_refused", ts: "2026-11-11T00:00:00Z", wallet_pubkey: "TESTW" },
      { id: 3, kind: "swap_refused", ts: "2026-11-01T00:00:00Z", wallet_pubkey: "W1" },
      { id: 4, kind: "app_error", ts: "2026-11-11T00:00:00Z", wallet_pubkey: "W1" },
    ];
    const s = await realOpsSources().swapCheck(SINCE);
    expect(s.lastCheckAt?.toISOString()).toBe("2026-11-14T08:00:00.000Z");
    expect(s.last).toEqual({ checked: 14, unchecked: 1, deferred: 0 });
    expect(s.missed.map((m) => m.cents).sort()).toEqual([66, 98]);
    expect(s.refused7d).toBe(1);
    // Only the swapCheck part of the summary is read, never the whole run record; events never their detail.
    expect(selects.some((x) => x.startsWith("cron_runs") && x.includes("summary->swapCheck"))).toBe(true);
    expect(selects.filter((x) => x.startsWith("events")).every((x) => !x.includes("detail"))).toBe(true);
  });

  it("no run in the window: nothing recorded", async () => {
    tables.cron_runs = [];
    tables.events = [];
    expect(await realOpsSources().swapCheck(SINCE)).toEqual({ lastCheckAt: null, last: null, missed: [], refused7d: 0 });
  });

  it("a failed check (null in swap_check_runs) has last null; odd entries are ignored", async () => {
    tables.swap_check_runs = [run("2026-11-14T08:00:00Z", null)];
    tables.cron_runs = [run("2026-11-13T08:00:00Z", { checked: "x", missed: [{ sig: "bad sig!", ts: "2026-11-13T00:00Z", roundupCents: 5 }, miss("GooDGooD", "2026-11-13T00:00Z", 7)] })];
    tables.events = [];
    tables.swaps = [];
    const s = await realOpsSources().swapCheck(SINCE);
    expect(s.last).toBeNull();
    expect(s.missed).toEqual([{ cents: 7 }]);
  });

  it("11-27: the check's own table is read; a newer plant run without swapCheck never hides it (the old reader would go grey)", async () => {
    tables.swap_check_runs = [run("2026-11-27T13:05:00Z", { checked: 140, unchecked: [], deferred: 0, missed: [miss("NewMxss1", "2026-11-26T09:00Z", 40)] })];
    tables.cron_runs = [
      run("2026-11-27T14:10:00Z", null),   // today's plant run, after the move: no swapCheck in its summary
      run("2026-11-26T14:12:00Z", { checked: 30, unchecked: [], deferred: 110, missed: [miss("PrevMss1", "2026-11-25T09:00Z", 60)] }),   // the last in-plant check
    ];
    tables.swaps = [];
    tables.events = [];
    const s = await realOpsSources().swapCheck(SINCE);
    expect(s.lastCheckAt?.toISOString()).toBe("2026-11-27T13:05:00.000Z");
    expect(s.last).toEqual({ checked: 140, unchecked: 0, deferred: 0 });
    expect(s.missed.map((m) => m.cents).sort()).toEqual([40, 60]);   // the week's misses from both tables
    expect(selects.some((x) => x.startsWith("swap_check_runs") && x.includes("summary->swapCheck"))).toBe(true);
  });

  it("11-27: right after the deploy (no swap_check_runs row yet) the last in-plant check still counts", async () => {
    tables.swap_check_runs = [];
    tables.cron_runs = [run("2026-11-27T14:10:00Z", null), run("2026-11-26T14:12:00Z", { checked: 30, unchecked: [], deferred: 110, missed: [] })];
    tables.swaps = [];
    tables.events = [];
    const s = await realOpsSources().swapCheck(SINCE);
    expect(s.lastCheckAt?.toISOString()).toBe("2026-11-26T14:12:00.000Z");
    expect(s.last).toEqual({ checked: 30, unchecked: 0, deferred: 110 });
  });
});
