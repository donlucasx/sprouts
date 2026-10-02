import { describe, it, expect } from "vitest";
import { rulesRow, walletRow, legRow, coinDayRow, splitDayRow } from "@/db/supabase";

// Rows migrated from production (0005 backfills) and rows the new code writes must both read correctly.
describe("supabase row mappers", () => {
  const base = { user_pubkey: "U", roundup_on: true, roundup_to_cents: 100, pct_on: true, pct_bps: 100, pct_threshold_cents: 10000, plant_threshold_cents: 200, plant_max_days: 7, daily_cap_cents: 500, updated_at: "2026-10-01T00:00:00Z" };

  it("rulesRow reads a two-key allocation from before 0005 as six keys, and the manager's fields from their defaults", () => {
    const r = rulesRow({ ...base, allocation: { SKR: 80, stORE: 20 }, managed: false, stop: "balanced", pins: { stORE: 20 }, prev_allocation: null, allocation_day: null });
    expect(r.allocation).toEqual({ SKR: 80, stORE: 20, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 });
    expect(r.pins).toEqual({ stORE: 20 });
    expect(r.managed).toBe(false);
    expect(r.allocationDay).toBeNull();
    expect(r.pinsByUndo).toBe(false);                                 // a row from before 0006 reads as the default
  });

  it("rulesRow reads a six-key allocation, a previous one and the day", () => {
    const r = rulesRow({ ...base, allocation: { SKR: 45, stORE: 0, hSOL: 20, JitoSOL: 15, JupSOL: 10, cbBTC: 10 }, managed: true, stop: "bold", pins: {}, prev_allocation: { SKR: 100 }, allocation_day: "2026-10-02", pins_by_undo: true });
    expect(r.allocation.hSOL).toBe(20);
    expect(r.pinsByUndo).toBe(true);
    expect(r.prevAllocation).toEqual({ SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 });
    expect(r.allocationDay).toBe("2026-10-02");
  });

  it("walletRow reads the jsonb ledger", () => {
    const w = walletRow({ pubkey: "W", user_pubkey: "U", delegation_pda: "D", daily_cap_cents: 500, status: "active", webhook_added: true, ledger_cents: { SKR: 215, JupSOL: 10 }, created_at: "2026-10-01T00:00:00Z" });
    expect(w.ledgerCents).toEqual({ SKR: 215, JupSOL: 10 });
  });

  it("legRow reads the fee in cents and the rate, null when absent", () => {
    expect(legRow({ planting_id: "p", asset: "cbBTC", usdc_in_cents: 200, amount_out_raw: "2389", staked: false, fee_amount_raw: "0", fee_cents: 1, rate_at_planting: null }).rateAtPlanting).toBeNull();
    expect(legRow({ planting_id: "p", asset: "hSOL", usdc_in_cents: 200, amount_out_raw: "14000000", staked: false, fee_amount_raw: "0", fee_cents: 1, rate_at_planting: "1.188931192" }).rateAtPlanting).toBeCloseTo(1.188931, 6);
  });

  it("coinDayRow and splitDayRow round-trip numerics and json", () => {
    const c = coinDayRow({ day: "2026-10-01", asset: "hSOL", rate: "1.1889", rate_prev: "1.1887", rate_prev_days: "2", price_usd: "140.8", liquidity_usd: "112434335.3", price_change_24h: "-0.71", tradeable: true, last_update_epoch: "1046", ok: true });
    expect(c.rate).toBeCloseTo(1.1889, 4);
    expect(c.lastUpdateEpoch).toBe(1046);
    const s = splitDayRow({ day: "2026-10-01", stop: "careful", split: { SKR: 60, cbBTC: 20, hSOL: 10, JitoSOL: 10 }, model_answer: null, why: null, fallback: "model", call_id: null });
    expect(s.split).toEqual({ SKR: 60, stORE: 0, hSOL: 10, JitoSOL: 10, JupSOL: 0, cbBTC: 20 });
    expect(s.fallback).toBe("model");
  });
});
