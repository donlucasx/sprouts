import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepo } from "@/db/supabase";

function fakeDb(legsError: string | null, partsError: string | null = null) {
  const calls: string[] = [];
  const planting = { id: "P1", user_pubkey: "U", wallet_pubkey: "W", ts: "2026-10-05T14:00:00Z", signature: "s", usdc_pulled_cents: 203, network_fee_cents: 3, status: "sent", ai_line: null,
    shares_before: null, shares_after: null, shares_minted: null, skr_carry_in_raw: "0", skr_surplus_raw: null };
  const db = {
    from(table: string) {
      return {
        insert(_rows: unknown) {
          calls.push(`insert ${table}`);
          if (table === "plantings") return { select: () => ({ single: async () => ({ data: planting, error: null }) }) };
          if (table === "swap_parts") calls.push(`rows ${JSON.stringify(_rows)}`);
          return Promise.resolve({ error: table === "planting_legs" && legsError ? { message: legsError } : table === "swap_parts" && partsError ? { message: partsError } : null });
        },
        update(v: { status?: string }) {
          calls.push(`update ${table} ${v.status}`);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { repo: new SupabaseRepo(db as unknown as SupabaseClient), calls };
}
const base = { userPubkey: "U", walletPubkey: "W", signature: "s", usdcPulledCents: 203, networkFeeCents: 3, status: "sent" as const, aiLine: null };
const lendLeg = (venue: "kamino_klend" | null) => ({ asset: "USDC_LEND" as const, venue, usdcInCents: 200, amountOutRaw: 1n, staked: false, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: null });

describe("SupabaseRepo.insertPlanting (AMEND 10-04 s20, T3 review I3)", () => {
  it("refuses a lending leg without a venue before any write", async () => {
    const { repo, calls } = fakeDb(null);
    await expect(repo.insertPlanting(base, [lendLeg(null)])).rejects.toThrow(/venue/);
    expect(calls).toEqual([]);
  });
  it("marks the planting failed when the legs insert errors after the planting row exists, then rethrows", async () => {
    const { repo, calls } = fakeDb('new row violates check constraint "planting_legs_venue_iff_lend"');
    await expect(repo.insertPlanting(base, [lendLeg("kamino_klend")])).rejects.toThrow(/violates check constraint/);
    expect(calls).toEqual(["insert plantings", "insert planting_legs", "update plantings failed"]);
  });
  it("positive control: a good planting writes plantings then legs, and no update", async () => {
    const { repo, calls } = fakeDb(null);
    expect((await repo.insertPlanting(base, [lendLeg("kamino_klend")])).id).toBe("P1");
    expect(calls).toEqual(["insert plantings", "insert planting_legs"]);
  });
  // Cap carry round 2 (0013): a part is written with the planting; a planting without one never touches the table.
  it("writes swap_parts after the legs when the planting pulls a part, and marks the planting failed when that insert errors", async () => {
    const ok = fakeDb(null);
    await ok.repo.insertPlanting({ ...base, swapParts: [{ signature: "big", cents: 497 }] }, [lendLeg("kamino_klend")]);
    expect(ok.calls).toEqual(["insert plantings", "insert planting_legs", "insert swap_parts", 'rows [{"planting_id":"P1","signature":"big","cents":497}]']);
    const bad = fakeDb(null, 'relation "swap_parts" does not exist');
    await expect(bad.repo.insertPlanting({ ...base, swapParts: [{ signature: "big", cents: 497 }] }, [lendLeg("kamino_klend")])).rejects.toThrow(/swap_parts/);
    expect(bad.calls.at(-1)).toBe("update plantings failed");
  });
});
