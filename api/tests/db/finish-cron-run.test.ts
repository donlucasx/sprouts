import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryRepo } from "@/db/memory";
import { SupabaseRepo } from "@/db/supabase";

const T1 = new Date("2026-11-13T05:00:00Z");
const T2 = new Date("2026-11-13T05:10:00Z");
const T3 = new Date("2026-11-13T05:12:00Z");
const STALE = new Date("2026-11-13T05:04:00Z");

describe("kimi L4: finishCronRun only finishes the row this invocation started", () => {
  it("memory: an old run that finishes after its day was re-claimed leaves the new run's row alone", async () => {
    const repo = new MemoryRepo();
    expect(await repo.claimCronRun("2026-11-13", T1, STALE)).toBe(true);
    expect(await repo.claimCronRun("2026-11-13", T2, STALE)).toBe(true);   // T1's row is stale by now: claimed again
    await repo.finishCronRun("2026-11-13", true, { from: "old" }, T3, T1);
    expect(repo.cronRuns.get("2026-11-13")).toMatchObject({ finishedAt: null, ok: null, summary: null });
    await repo.finishCronRun("2026-11-13", true, { from: "new" }, T3, T2);
    expect(repo.cronRuns.get("2026-11-13")).toMatchObject({ finishedAt: T3, ok: true, summary: { from: "new" } });
  });

  it("supabase: the update is filtered on day AND started_at", async () => {
    const eqs: [string, unknown][] = [];
    const q = { eq: (c: string, v: unknown) => { eqs.push([c, v]); return q; }, then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) };
    const db = { from: () => ({ update: () => q }) };
    await new SupabaseRepo(db as unknown as SupabaseClient).finishCronRun("2026-11-13", true, {}, T3, T1);
    expect(eqs).toEqual([["day", "2026-11-13"], ["started_at", T1.toISOString()]]);
  });
});
