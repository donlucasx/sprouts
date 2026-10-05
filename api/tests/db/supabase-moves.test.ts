import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "@/db/supabase";

/** Records each filter of one UPDATE and answers `rows` from its select (what PostgREST returns for the rows the WHERE matched). */
function fakeDb(rows: unknown[]) {
  const calls: string[] = [];
  const chain = (): Record<string, unknown> => ({
    eq: (c: string, v: unknown) => { calls.push(`eq ${c}=${String(v)}`); return chain(); },
    is: (c: string, v: unknown) => { calls.push(`is ${c}=${String(v)}`); return chain(); },
    select: async (c: string) => { calls.push(`select ${c}`); return { data: rows, error: null }; },
  });
  const db = { from: (t: string) => ({ update: (v: Record<string, unknown>) => { calls.push(`update ${t} ${JSON.stringify(Object.keys(v).sort())} ${String(v.status ?? "")}`); return chain(); } }) };
  return { repo: new SupabaseRepo(db as unknown as SupabaseClient), calls };
}

describe("SupabaseRepo move cards: conditional UPDATEs (C-I2)", () => {
  it("a transition is `where id and status = from`; with notInFlight also `redeem_signature is null`; zero rows is false", async () => {
    const won = fakeDb([{ id: "m" }]);
    expect(await won.repo.transitionMoveProposal("m", "open", "dismissed", { notInFlight: true })).toBe(true);
    expect(won.calls).toEqual(['update move_proposals ["closed_at","status"] dismissed', "eq id=m", "eq status=open", "is redeem_signature=null", "select id"]);
    const lost = fakeDb([]);
    expect(await lost.repo.transitionMoveProposal("m", "open", "done")).toBe(false);
    expect(lost.calls).not.toContain("is redeem_signature=null");
  });
  it("signatures are written only onto an open card with none, and cleared only when the stored redeem matches", async () => {
    const store = fakeDb([]);
    expect(await store.repo.storeMoveSignatures("m", { redeem: "R", deposit: "D" })).toBe(false);
    expect(store.calls).toEqual(['update move_proposals ["deposit_signature","redeem_signature"] ', "eq id=m", "eq status=open", "is redeem_signature=null", "select id"]);
    const clear = fakeDb([{ id: "m" }]);
    expect(await clear.repo.clearMoveSignatures("m", "R")).toBe(true);
    expect(clear.calls).toEqual(['update move_proposals ["deposit_signature","redeem_signature"] ', "eq id=m", "eq status=open", "eq redeem_signature=R", "select id"]);
  });
});
