import { describe, it, expect } from "vitest";
import { usableMe, pickMeState, noPlantingLine, withdrawMode, applyRulesTo } from "@/lib/me-state";
import type { MeResponse } from "@/lib/api";
const cached = { pot: { asOf: "2026-09-28T16:00:00Z" }, holdings: [], manager: { why: null } } as never;
const live = { pot: { asOf: "2026-09-28T17:00:00Z" } } as never;
const full = { pot: { asOf: "2026-09-28T16:00:00Z" }, holdings: [], manager: { why: null } } as unknown as MeResponse;
describe("pickMeState", () => {
  it("a cached me from before the Yield Manager build (no holdings or manager) counts as no cache (whole-branch review I2)", () => {
    const old = { ...full } as Record<string, unknown>;
    delete old.holdings; delete old.manager;
    expect(usableMe(old as unknown as MeResponse)).toBeNull();
    expect(usableMe(full)).toBe(full);
    expect(pickMeState(undefined, old as unknown as MeResponse, false)).toEqual({ data: undefined, stale: false });
    expect(pickMeState(undefined, old as unknown as MeResponse, true)).toEqual({ data: undefined, stale: true });
    expect(pickMeState(undefined, full, false)).toEqual({ data: full, stale: false });
  });
  it("keeps the last verified read on failure and says it is stale", () => { expect(pickMeState(undefined, cached, true)).toEqual({ data: cached, stale: true }); });
  it("prefers the live read", () => { expect(pickMeState(live, cached, false)).toEqual({ data: live, stale: false }); });
  it("never invents a garden", () => { expect(pickMeState(undefined, null, true)).toEqual({ data: undefined, stale: true }); });
});

// The 09-29 Saga check: with a wallet linked and 62 cents waiting, Home still said "Link a wallet and swap."
describe("noPlantingLine", () => {
  const me = (pendingCents: number, statuses: ("active" | "paused" | "revoked")[]) =>
    ({ nextPlanting: { pendingCents, thresholdCents: 200 }, wallets: statuses.map((status) => ({ pubkey: "W", status, dailyCapCents: 500 })) }) as unknown as MeResponse;
  it("asks for a wallet when none is active", () => {
    expect(noPlantingLine(me(0, []))).toBe("No planting yet. Link a wallet and swap.");
    expect(noPlantingLine(me(0, ["revoked"]))).toBe("No planting yet. Link a wallet and swap.");
  });
  it("asks for a swap when a wallet is linked and nothing is waiting", () => {
    expect(noPlantingLine(me(0, ["active"]))).toBe("No planting yet. Your next swap starts it.");
  });
  it("names the threshold when change is waiting", () => {
    expect(noPlantingLine(me(62, ["active"]))).toBe("No planting yet. It plants when the change reaches $2.00.");
  });
});

// The 09-29 Saga check: Withdraw opened on "Earned, 0.00 SKR", the one choice that could not be used.
describe("withdrawMode", () => {
  it("opens on an amount while earned is under 1 SKR", () => {
    expect(withdrawMode(0n, null)).toBe("amount");
    expect(withdrawMode(999_999n, null)).toBe("amount");
  });
  it("opens on earned once there is 1 SKR of it", () => {
    expect(withdrawMode(1_000_000n, null)).toBe("earned");
  });
  it("keeps the user's own choice", () => {
    expect(withdrawMode(0n, "earned")).toBe("earned");
    expect(withdrawMode(5_000_000n, "amount")).toBe("amount");
  });
});

// The 10-01 device check: Save and Undo moved the screen twice (the draft cleared, then the fresh read landed); the answer is applied at once.
describe("applyRulesTo", () => {
  const oldRules = { roundupOn: true, roundupToCents: 100, pctOn: false, pctBps: 100, pctThresholdCents: 5000, plantThresholdCents: 200, plantMaxDays: 7, dailyCapCents: 300, managed: false, stop: "balanced", pins: {}, allocation: { SKR: 100 } };
  const me = {
    user: { pubkey: "U" }, pot: { asOf: "2026-10-01T16:00:00Z" }, holdings: [], history: { plantings: [], picks: [] },
    nextPlanting: { pendingCents: 0, thresholdCents: 200, capLeftCents: 300, asset: "SKR" }, lastReceipt: null, basket: null, wallets: [],
    rules: oldRules,
    manager: { managed: false, stop: "balanced", pins: {}, changedDay: "2026-10-01", undoAvailable: true, why: "Kept steady.", fallback: null, stopSplit: { SKR: 100 } },
  } as unknown as MeResponse;
  const rules = { ...oldRules, managed: true, stop: "bold", pins: { hSOL: 10 } } as unknown as MeResponse["rules"];
  it("replaces the rules, merges the manager's fields from them and the extras, and leaves everything else untouched", () => {
    const out = applyRulesTo(me, rules, { undoAvailable: false, changedDay: null })!;
    expect(out.rules).toBe(rules);
    expect(out.manager.managed).toBe(true);
    expect(out.manager.stop).toBe("bold");
    expect(out.manager.pins).toBe(rules.pins);
    expect(out.manager.undoAvailable).toBe(false);
    expect(out.manager.changedDay).toBeNull();
    expect(out.manager.why).toBe("Kept steady.");
    expect(out.manager.stopSplit).toBe(me.manager.stopSplit);
    for (const k of ["user", "pot", "holdings", "history", "nextPlanting", "lastReceipt", "basket", "wallets"] as const) expect(out[k]).toBe(me[k]);
    expect(me.rules).toBe(oldRules);
    expect(me.manager.managed).toBe(false);
  });
  it("an extra wins over the field derived from the rules", () => {
    expect(applyRulesTo(me, rules, { managed: false })!.manager.managed).toBe(false);
  });
  it("leaves an empty cache empty", () => { expect(applyRulesTo(undefined, rules, {})).toBeUndefined(); });
});
