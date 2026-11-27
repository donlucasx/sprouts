import { describe, it, expect } from "vitest";
import { swapsCountedLight, type SwapCheckInput } from "@/lib/ops/lights";

const NOW = new Date("2026-11-14T12:00:00Z");
const HOUR = 3_600_000;
const input = (over: Partial<SwapCheckInput> = {}): SwapCheckInput => ({
  lastCheckAt: new Date(NOW.getTime() - 3 * HOUR),
  last: { checked: 15, unchecked: 0, deferred: 0 },
  missed: [],
  refused7d: 0,
  ...over,
});

describe("swapsCountedLight", () => {
  it("green when the last check found nothing missing and checked every wallet", () => {
    const l = swapsCountedLight({ now: NOW, input: input() });
    expect(l).toMatchObject({ key: "swapsCounted", label: "Every swap counted", state: "green", fact: "No missed swaps; all 15 wallets checked 3 hours ago" });
    expect(l.action).toBeUndefined();
  });

  it("amber with the count and the round-ups when swaps were missed this week", () => {
    const l = swapsCountedLight({ now: NOW, input: input({ missed: [{ cents: 66 }, { cents: 41 }, { cents: 23 }] }) });
    expect(l).toMatchObject({ state: "amber", fact: "3 swaps missed this week, $1.30 in round-ups", action: "Ask Claude to credit them." });
  });

  it("singular wording", () => {
    expect(swapsCountedLight({ now: NOW, input: input({ missed: [{ cents: 98 }] }) }).fact).toBe("1 swap missed this week, $0.98 in round-ups");
  });

  it("amber when wallets could not be checked (unchecked or out of time), even with nothing missed", () => {
    const l = swapsCountedLight({ now: NOW, input: input({ last: { checked: 12, unchecked: 2, deferred: 1 } }) });
    expect(l).toMatchObject({ state: "amber", fact: "3 wallets could not be checked in the last run", action: "Ask Claude if it repeats." });
  });

  it("missed and unchecked together: both facts, the credit action wins", () => {
    const l = swapsCountedLight({ now: NOW, input: input({ missed: [{ cents: 100 }], last: { checked: 14, unchecked: 1, deferred: 0 } }) });
    expect(l).toMatchObject({ state: "amber", fact: "1 swap missed this week, $1.00 in round-ups; 1 wallet could not be checked in the last run", action: "Ask Claude to credit them." });
  });

  it("refusals in the last 7 days ride on the fact, green or amber", () => {
    expect(swapsCountedLight({ now: NOW, input: input({ refused7d: 4 }) }).fact).toBe("No missed swaps; all 15 wallets checked 3 hours ago; 4 swaps refused by the swap watcher this week");
    expect(swapsCountedLight({ now: NOW, input: input({ refused7d: 1, missed: [{ cents: 10 }] }) }).fact).toBe("1 swap missed this week, $0.10 in round-ups; 1 swap refused by the swap watcher this week");
  });

  it("unknown when no check is recorded, the last run did not check, or the check is old", () => {
    expect(swapsCountedLight({ now: NOW, input: input({ lastCheckAt: null, last: null }) })).toMatchObject({ state: "unknown", fact: "No swap check recorded yet" });
    expect(swapsCountedLight({ now: NOW, input: input({ last: null }) })).toMatchObject({ state: "unknown", fact: "The last daily swap check did not finish" });
    const old = swapsCountedLight({ now: NOW, input: input({ lastCheckAt: new Date(NOW.getTime() - 30 * HOUR) }) });
    expect(old).toMatchObject({ state: "unknown", fact: "The last swap check was 30 hours ago" });
    expect(old.action).toBeTruthy();
  });

  it("still amber for this week's misses when the check itself is old (a miss is never hidden by staleness)", () => {
    const l = swapsCountedLight({ now: NOW, input: input({ lastCheckAt: new Date(NOW.getTime() - 30 * HOUR), missed: [{ cents: 5 }] }) });
    expect(l.state).toBe("amber");
  });

  it("zero wallets checked is plain", () => {
    expect(swapsCountedLight({ now: NOW, input: input({ last: { checked: 0, unchecked: 0, deferred: 0 } }) })).toMatchObject({ state: "green", fact: "No missed swaps; no wallets to check (checked 3 hours ago)" });
  });
});
