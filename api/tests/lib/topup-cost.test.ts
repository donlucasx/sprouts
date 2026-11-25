import { describe, expect, it } from "vitest";
import { topUpCost, splitShareOf, TOPUP_COST_BPS, PLANTING_FEE_BPS } from "@/lib/topup-cost";
import { SKR_MINT, WSOL_MINT } from "@/lib/constants";
import { zeroSplit, type Split } from "@/domain/coins";

const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

describe("top-up cost ranking (0.1.13, his rulings 11-24/25)", () => {
  it("no split read: no fields, so the phone keeps today's order", () => {
    expect(topUpCost(SKR_MINT, null)).toEqual({});
  });
  it("SKR in a 90% SKR split: sell + 0.9 x (buy + fee), no fee double count (Kimi step 3 #13)", () => {
    expect(TOPUP_COST_BPS[SKR_MINT]).toEqual({ sell: 35, buy: 21 });
    expect(PLANTING_FEE_BPS).toBe(50);
    expect(topUpCost(SKR_MINT, split({ SKR: 90, stORE: 10 }))).toEqual({ splitPct: 90, costBps: Math.round(35 + 0.9 * 71) });
  });
  it("SOL counts SOL lending and hSOL as buying SOL back", () => {
    expect(splitShareOf(WSOL_MINT, split({ SKR: 50, SOL_LEND: 20, hSOL: 10, stORE: 20 }))).toBe(30);
    expect(topUpCost(WSOL_MINT, split({ SKR: 90, stORE: 10 }))).toEqual({ splitPct: 0, costBps: 5 });
  });
  it("a coin outside the split pays only its sell cost (default 50 until measured)", () => {
    expect(topUpCost(BONK, split({ SKR: 100 }))).toEqual({ splitPct: 0, costBps: 50 });
  });
  it("SOL ranks below SKR for an SKR-heavy split, and below a coin outside the split", () => {
    const s = split({ SKR: 60, USDC_LEND: 40 });
    const sol = topUpCost(WSOL_MINT, s) as { costBps: number }, skr = topUpCost(SKR_MINT, s) as { costBps: number }, bonk = topUpCost(BONK, s) as { costBps: number };
    expect(sol.costBps).toBeLessThan(bonk.costBps);
    expect(bonk.costBps).toBeLessThan(skr.costBps);
  });
});
