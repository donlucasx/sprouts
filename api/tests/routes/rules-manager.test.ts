import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { SKR_ONLY, ASSETS, zeroSplit, type Split } from "@/domain/coins";
import { STOP_DEFAULTS } from "@/domain/split";
import { PUT as putRules } from "@/app/api/rules/route";
import { POST as undo } from "@/app/api/rules/undo/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });
const sum = (s: Split) => ASSETS.reduce((t, a) => t + s[a], 0);
let repo: MemoryRepo;
let auth: Record<string, string>;
const put = (body: unknown) => putRules(new Request("http://x/api/rules", { method: "PUT", headers: auth, body: JSON.stringify(body) }));
const undoNow = () => undo(new Request("http://x/api/rules/undo", { method: "POST", headers: auth }));

beforeAll(() => { process.env.APP_ORIGIN ??= "https://sprouts.money"; });
beforeEach(async () => {
  repo = new MemoryRepo();
  setRepoForTests(repo);
  await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  auth = { authorization: `Bearer ${await issueSession(U, "M")}` };
});

// Spec 3.1 and 4.2: the switch, the stop and the pins are saved with the rest, never a raise; the split is recomputed at once.
describe("PUT /api/rules with the Yield Manager", () => {
  it("turning it on takes the stop's latest split at once and records the change as yours", async () => {
    await repo.putSplitDay({ day: "2026-10-01", stop: "balanced", split: split({ SKR: 40, stORE: 5, hSOL: 25, JitoSOL: 15, JupSOL: 10, cbBTC: 5 }), modelAnswer: null, why: "w", fallback: null, callId: 1 });
    const res = await put({ managed: true, stop: "balanced" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { managed: boolean; stop: string; allocation: Split };
    expect(body.managed).toBe(true);
    expect(body.allocation).toEqual(split({ SKR: 40, stORE: 5, hSOL: 25, JitoSOL: 15, JupSOL: 10, cbBTC: 5 }));
    const ev = repo.events.find((e) => e.kind === "split_changed")!;
    expect((ev.detail as { by: string }).by).toBe("you");
    expect((await repo.getRules(U)).prevAllocation).toBeNull();
  });

  it("before any split row exists the stop default applies", async () => {
    const res = await put({ managed: true, stop: "careful" });
    expect(((await res.json()) as { allocation: Split }).allocation).toEqual(STOP_DEFAULTS.careful);
  });

  it("pins are checked against the floor at save time, with the copy a user reads", async () => {
    await put({ managed: true, stop: "balanced" });
    const over = await put({ pins: { cbBTC: 40, hSOL: 30 } });
    expect(over.status).toBe(400);
    expect(((await over.json()) as { error: string }).error).toBe("Pins add up to more than the split allows. SKR keeps at least 35%.");
    const low = await put({ pins: { SKR: 30 } });
    expect(((await low.json()) as { error: string }).error).toBe("SKR keeps at least 35% on Balanced.");
    const range = await put({ pins: { stORE: 55 } });
    expect(((await range.json()) as { error: string }).error).toBe("Pins go up to 50 for stORE and 75 for the other coins.");
    const bad = await put({ pins: { DOGE: 10 } });
    expect(bad.status).toBe(400);
  });

  it("a pin fixes the coin and the rest is recomputed; off, SKR is the rest and cannot be pinned", async () => {
    await put({ managed: true, stop: "balanced" });
    const res = await put({ pins: { cbBTC: 20 } });
    const a = ((await res.json()) as { allocation: Split }).allocation;
    expect(a.cbBTC).toBe(20);
    expect(sum(a)).toBe(100);
    const off = await put({ managed: false, pins: { stORE: 20 } });
    expect(((await off.json()) as { allocation: Split }).allocation).toEqual(split({ SKR: 80, stORE: 20 }));
    expect((await put({ managed: false, pins: { SKR: 50 } })).status).toBe(400);
  });

  it("allocation can no longer be set directly; the daily limit stops at the on-chain $5", async () => {
    expect((await put({ allocation: { SKR: 50, stORE: 50 } })).status).toBe(400);
    expect((await put({ dailyCapCents: 2000 })).status).toBe(400);
  });

  it("any save clears the undo", async () => {
    await repo.saveRules(U, { managed: true, stop: "balanced", allocation: STOP_DEFAULTS.balanced, prevAllocation: SKR_ONLY, allocationDay: "2026-10-02" });
    await put({ plantThresholdCents: 300 });
    expect((await repo.getRules(U)).prevAllocation).toBeNull();
  });
});

describe("POST /api/rules/undo (spec 4.5, R122)", () => {
  it("puts yesterday's split back as pins, turns the manager off, and records it", async () => {
    const yesterday = split({ SKR: 45, stORE: 5, hSOL: 18, JitoSOL: 14, JupSOL: 9, cbBTC: 9 });
    await repo.saveRules(U, { managed: true, stop: "balanced", allocation: split({ SKR: 40, stORE: 5, hSOL: 25, JitoSOL: 15, JupSOL: 10, cbBTC: 5 }), prevAllocation: yesterday, allocationDay: "2026-10-02" });
    const res = await undoNow();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { managed: boolean; pins: Record<string, number>; allocation: Split };
    expect(body.managed).toBe(false);
    expect(body.allocation).toEqual(yesterday);
    expect(body.pins).toEqual({ stORE: 5, hSOL: 18, JitoSOL: 14, JupSOL: 9, cbBTC: 9 });
    expect(repo.events.some((e) => e.kind === "split_undone")).toBe(true);
    expect((await repo.getRules(U)).prevAllocation).toBeNull();
    expect((await undoNow()).status).toBe(409);
  });
});
