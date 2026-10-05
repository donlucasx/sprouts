import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "@/db/supabase";

const ROW = { id: "w1", user_pubkey: "U", asset: "SKR", source: "sprouts", unstake_ts: "2026-10-06T14:00:00Z", unstake_signature: "S", shares_unstaked: "5", amount_raw: "7", principal_raw: "0",
  withdraw_signature: null, cancel_signature: null, amount_out_raw: null, reward_delta_raw: null, skipped_at: null };

function fakeDb(insertError: { code: string; message: string } | null) {
  const calls: string[] = [];
  const db = {
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => { calls.push("insert"); return insertError ? { data: null, error: insertError } : { data: ROW, error: null }; } }) }),
      select: () => ({ eq: (c: string, v: string) => ({ maybeSingle: async () => { calls.push(`select ${c}=${v}`); return { data: ROW, error: null }; } }) }),
    }),
  };
  return { repo: new SupabaseRepo(db as unknown as SupabaseClient), calls };
}
const W = { userPubkey: "U", asset: "SKR" as const, source: "sprouts" as const, unstakeSignature: "S", sharesUnstaked: 5n, amountRaw: 7n, principalRaw: 0n };

describe("SupabaseRepo.insertWithdrawal (K-I4, unique index 0009)", () => {
  it("a unique violation on the signature answers the row already recorded", async () => {
    const { repo, calls } = fakeDb({ code: "23505", message: "duplicate key value violates unique constraint" });
    expect((await repo.insertWithdrawal(W)).id).toBe("w1");
    expect(calls).toEqual(["insert", "select unstake_signature=S"]);
  });
  it("any other error still throws; a wallet-source row (no signature) is never looked up", async () => {
    await expect(fakeDb({ code: "23514", message: "check violated" }).repo.insertWithdrawal(W)).rejects.toThrow(/check violated/);
    const nosig = fakeDb({ code: "23505", message: "dup" });
    await expect(nosig.repo.insertWithdrawal({ ...W, source: "wallet", unstakeSignature: null })).rejects.toThrow(/dup/);
    expect(nosig.calls).toEqual(["insert"]);
  });
});
