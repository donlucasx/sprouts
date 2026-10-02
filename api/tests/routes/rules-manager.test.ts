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
    expect((ev.detail as { managed: boolean; managedWas: boolean }).managedWas).toBe(false); // the switch moved off to on by this save
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

  it("a pin fixes the coin and the rest is recomputed; off, SKR is the rest and an SKR pin is dropped", async () => {
    await put({ managed: true, stop: "balanced" });
    const res = await put({ pins: { cbBTC: 20 } });
    const a = ((await res.json()) as { allocation: Split }).allocation;
    expect(a.cbBTC).toBe(20);
    expect(sum(a)).toBe(100);
    const off = await put({ managed: false, pins: { stORE: 20 } });
    expect(((await off.json()) as { allocation: Split }).allocation).toEqual(split({ SKR: 80, stORE: 20 }));
    const skrOff = await put({ managed: false, pins: { SKR: 50 } });
    expect(skrOff.status).toBe(200);
    const b = (await skrOff.json()) as { pins: Record<string, number>; allocation: Split };
    expect(b.allocation).toEqual(SKR_ONLY);
    expect("SKR" in b.pins).toBe(false);
    expect("SKR" in (await repo.getRules(U)).pins).toBe(false);
  });

  it("switching off with an SKR pin saved while on drops the SKR pin and keeps the rest (spec 4.2)", async () => {
    await put({ managed: true, stop: "balanced" });
    expect((await put({ pins: { SKR: 40, cbBTC: 20 } })).status).toBe(200);
    const res = await put({ managed: false });
    expect(res.status).toBe(200);
    const b = (await res.json()) as { managed: boolean; pins: Record<string, number>; allocation: Split };
    expect(b.managed).toBe(false);
    expect(b.pins).toEqual({ cbBTC: 20 });
    expect(b.allocation).toEqual(split({ SKR: 80, cbBTC: 20 }));
  });

  it("allocation can no longer be set directly; the daily limit stops at the on-chain $5", async () => {
    expect((await put({ allocation: { SKR: 50, stORE: 50 } })).status).toBe(400);
    expect((await put({ dailyCapCents: 2000 })).status).toBe(400);
  });

  it("after an undo, turning the manager back on drops the pins the undo made (R137)", async () => {
    const prior = split({ SKR: 60, hSOL: 20, cbBTC: 20 });
    await repo.saveRules(U, { managed: true, stop: "balanced", allocation: split({ SKR: 45, hSOL: 25, JitoSOL: 15, JupSOL: 10, cbBTC: 5 }), prevAllocation: prior, allocationDay: "2026-10-02" });
    const undone = (await (await undoNow()).json()) as { pins: Record<string, number>; managed: boolean };
    expect(undone.pins).toEqual({ hSOL: 20, cbBTC: 20 });
    expect((await repo.getRules(U)).pinsByUndo).toBe(true);
    const on = (await (await put({ managed: true })).json()) as { pins: Record<string, number>; managed: boolean; allocation: Split };
    expect(on.managed).toBe(true);
    expect(on.pins).toEqual({});
    expect(on.allocation).toEqual(STOP_DEFAULTS.balanced);          // no split row yet: the stop default, free of the undo's pins
    expect((await repo.getRules(U)).pinsByUndo).toBe(false);
  });

  it("a pin set by hand after the undo survives the flip back on (R137)", async () => {
    await repo.saveRules(U, { managed: true, stop: "balanced", allocation: split({ SKR: 45, hSOL: 25, JitoSOL: 15, JupSOL: 10, cbBTC: 5 }), prevAllocation: split({ SKR: 60, hSOL: 20, cbBTC: 20 }), allocationDay: "2026-10-02" });
    await undoNow();
    const mine = (await (await put({ pins: { cbBTC: 10 } })).json()) as { pins: Record<string, number> };
    expect(mine.pins).toEqual({ cbBTC: 10 });
    expect((await repo.getRules(U)).pinsByUndo).toBe(false);
    const on = (await (await put({ managed: true })).json()) as { pins: Record<string, number>; allocation: Split };
    expect(on.pins).toEqual({ cbBTC: 10 });
    expect(on.allocation.cbBTC).toBe(10);
  });

  it("a 0 pin from a bare PUT is dropped, as the app drops zeros on its side", async () => {
    await put({ managed: true, stop: "balanced" });
    const res = (await (await put({ pins: { hSOL: 0, cbBTC: 10 } })).json()) as { pins: Record<string, number> };
    expect(res.pins).toEqual({ cbBTC: 10 });
  });

  it("a bad body names the field it failed on, in the API's own sentence (R44 holds)", async () => {
    const field = await put({ pctBps: 9999 });
    expect(field.status).toBe(400);
    expect(((await field.json()) as { error: string }).error).toBe("Bad request: pctBps.");
    const unknown = await put({ nope: 1 });
    expect(((await unknown.json()) as { error: string }).error).toBe("Bad request: nope.");
    const coin = await put({ pins: { DOGE: 10 } });
    expect(((await coin.json()) as { error: string }).error).toBe("Bad request: pins.");
    const empty = await putRules(new Request("http://x/api/rules", { method: "PUT", headers: auth, body: "not json" }));
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toBe("Bad request.");
    // Review M5: an unknown key is echoed capped at 32 characters with control characters stripped, never a line of its own making.
    const long = await put({ ["x".repeat(80) + "\nSet-Cookie: a=b"]: 1 });
    expect(((await long.json()) as { error: string }).error).toBe(`Bad request: ${"x".repeat(32)}.`);
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
