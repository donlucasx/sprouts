import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "@/db/supabase";

/** listEventsByKind with no limit pages past PostgREST's 1000-row cap until a short page (a recorded query chain, no PostgREST). */
function fakeDb(total: number) {
  const calls: string[] = [];
  const all = Array.from({ length: total }, (_, i) => ({ id: i + 1, user_pubkey: null, wallet_pubkey: null, ts: "2026-11-15T00:00:00Z", kind: "helius_credits", detail: { cycle: "2026-11-14", credits: 1 } }));
  const query = (table: string) => {
    let range: [number, number] = [0, total];
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { calls.push(`${table} eq ${c}=${String(v)}`); return q; },
      gte: (c: string, v: unknown) => { calls.push(`${table} gte ${c}=${String(v)}`); return q; },
      order: (c: string) => { calls.push(`${table} order ${c}`); return q; },
      range: (a: number, b: number) => { calls.push(`${table} range ${a}-${b}`); range = [a, b]; return q; },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: all.slice(range[0], range[1] + 1), error: null }).then(ok),
    };
    return q;
  };
  return { repo: new SupabaseRepo({ from: query } as unknown as SupabaseClient), calls };
}

describe("SupabaseRepo.listEventsByKind", () => {
  it("with no limit reads every row, 1000 at a time, filtered by kind and since, ordered by id", async () => {
    const { repo, calls } = fakeDb(2_500);
    const rows = await repo.listEventsByKind("helius_credits", new Date("2026-11-14T00:00:00Z"));
    expect(rows).toHaveLength(2_500);
    expect(rows[2_499].id).toBe(2_500);
    expect(calls.filter((c) => c.includes("range"))).toEqual(["events range 0-999", "events range 1000-1999", "events range 2000-2999"]);
    expect(calls).toContain("events eq kind=helius_credits");
    expect(calls).toContain("events gte ts=2026-11-14T00:00:00.000Z");
    expect(calls).toContain("events order id");
  });

  it("a limit stops early", async () => {
    const { repo } = fakeDb(2_500);
    expect(await repo.listEventsByKind("helius_credits", new Date(0), 1_200)).toHaveLength(1_200);
  });
});
