import { describe, it, expect } from "vitest";
import { pickMeState, noPlantingLine } from "@/lib/me-state";
import type { MeResponse } from "@/lib/api";
const cached = { pot: { asOf: "2026-09-28T16:00:00Z" } } as never;
const live = { pot: { asOf: "2026-09-28T17:00:00Z" } } as never;
describe("pickMeState", () => {
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
