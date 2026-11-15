import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { zeroSplit, type Split } from "@/domain/coins";
import { PUT as putRules } from "@/app/api/rules/route";
import { POST as undo } from "@/app/api/rules/undo/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });
let repo: MemoryRepo;
let auth: Record<string, string>;
const put = (body: unknown) => putRules(new Request("http://x/api/rules", { method: "PUT", headers: auth, body: JSON.stringify(body) }));
const json = async (r: Response) => (await r.json()) as { allocation: Split; pins: Record<string, number>; managed: boolean; error?: string };

beforeAll(() => { process.env.APP_ORIGIN ??= "https://sprouts.money"; });
beforeEach(async () => {
  repo = new MemoryRepo();
  setRepoForTests(repo);
  await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  auth = { authorization: `Bearer ${await issueSession(U, "M")}` };
});

// His ruling 10-23: with the manager off, every coin but SKR can be switched off. Only builds after 0.1.3 send `off`.
describe("PUT /api/rules `off` (manual switches, 10-23)", () => {
  it("switches stORE off with the manager off: saved as a 0 pin, no floor in the split", async () => {
    const res = await put({ managed: false, pins: { hSOL: 20 }, off: ["stORE"] });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.pins).toEqual({ hSOL: 20, stORE: 0 });
    expect(b.allocation).toEqual(split({ SKR: 80, hSOL: 20 }));
  });

  it("old builds (no `off`): a 0 pin sent with the manager off still means nothing, so stORE keeps its floor", async () => {
    const b = await json(await put({ managed: false, pins: { stORE: 0, hSOL: 20 } }));
    expect(b.pins).toEqual({ hSOL: 20 });
    expect(b.allocation).toEqual(split({ SKR: 70, stORE: 10, hSOL: 20 }));
  });

  it("a later save without pins keeps the switches (a stop change, the limit)", async () => {
    await put({ managed: false, off: ["stORE", "cbBTC"] });
    const b = await json(await put({ dailyCapCents: 300, stop: "bold" }));
    expect((await repo.getRules(U)).pins).toEqual({ stORE: 0, cbBTC: 0 });
    expect(b.allocation).toEqual(split({ SKR: 100 }));
  });

  it("an empty `off` switches every coin back on (stORE back at its floor)", async () => {
    await put({ managed: false, off: ["stORE"] });
    const b = await json(await put({ managed: false, pins: {}, off: [] }));
    expect(b.pins).toEqual({});
    expect(b.allocation).toEqual(split({ SKR: 90, stORE: 10 }));
  });

  it("SKR can be switched off with the manager off: a 0 pin, and the allocation gives it nothing", async () => {
    const res = await put({ managed: false, off: ["SKR"] });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect(b.pins.SKR).toBe(0);
    expect(b.allocation.SKR).toBe(0);
    expect(Object.values(b.allocation).reduce((a, c) => a + c, 0)).toBe(100);
    expect((await put({ managed: false, off: ["DOGE"] })).status).toBe(400);
  });

  it("SKR off with the manager on, sent the way the app does: pins { SKR: 0 }", async () => {
    const b = await json(await put({ managed: true, pins: { SKR: 0 } }));
    expect(b.pins.SKR).toBe(0);
    expect(b.allocation.SKR).toBe(0);
  });

  it("switching all six coins off is refused: keep at least one on", async () => {
    const res = await put({ managed: false, off: ["SKR", "stORE", "hSOL", "USDC_LEND", "SOL_LEND", "cbBTC"] });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("Keep at least one coin on.");
  });

  it("an SKR pin of 5 is saved with the manager on (no minimum)", async () => {
    const b = await json(await put({ managed: true, pins: { SKR: 5 } }));
    expect(b.allocation.SKR).toBe(5);
  });

  it("0.1.10 shape: off without SKR and pins without SKR leaves an SKR that is on alone", async () => {
    const res = await put({ off: ["stORE"], pins: { cbBTC: 30 } });
    expect(res.status).toBe(200);
    const b = await json(res);
    expect("SKR" in b.pins).toBe(false);
    expect(b.pins).toEqual({ cbBTC: 30, stORE: 0 });
  });

  it("0.1.10 managed save (pins only, no off) keeps SKR off for a user whose SKR is off", async () => {
    await put({ managed: false, off: ["SKR"] });
    const b = await json(await put({ managed: true, pins: { stORE: 0 } }));
    expect(b.pins.SKR).toBe(0);
    expect(b.allocation.SKR).toBe(0);
  });

  it("manager off, a non-zero SKR pin is still dropped; a 0 pin is kept", async () => {
    await put({ managed: true, pins: { SKR: 40 } });
    const b = await json(await put({ managed: false }));
    expect("SKR" in b.pins).toBe(false);
  });

  it("the undo carries SKR off through and the allocation honours it", async () => {
    await put({ managed: true, pins: { SKR: 0 } });
    await repo.saveRules(U, { prevAllocation: split({ SKR: 60, hSOL: 40 }), allocationDay: "2026-10-23" });
    const res = await undo(new Request("http://x/api/rules/undo", { method: "POST", headers: auth }));
    expect(res.status).toBe(200);
    const r = await repo.getRules(U);
    expect(r.pins.SKR).toBe(0);
    expect(r.allocation.SKR).toBe(0);
  });

  it("the undo for a user with SKR on saves yesterday's split as before", async () => {
    await repo.saveRules(U, { prevAllocation: split({ SKR: 50, stORE: 10, hSOL: 40 }), allocationDay: "2026-10-23" });
    await undo(new Request("http://x/api/rules/undo", { method: "POST", headers: auth }));
    expect((await repo.getRules(U)).allocation).toEqual(split({ SKR: 50, stORE: 10, hSOL: 40 }));
  });


  it("switches carry over both ways between manual and the manager", async () => {
    await put({ managed: false, off: ["stORE"] });
    const on = await json(await put({ managed: true, stop: "balanced" }));
    expect(on.pins).toEqual({ stORE: 0 });
    expect(on.allocation.stORE).toBe(0);
    const offAgain = await json(await put({ managed: false, pins: {}, off: ["stORE"] }));
    expect(offAgain.allocation).toEqual(split({ SKR: 100 }));
  });

  it("an old build turning the manager off drops the manager's switches, as before", async () => {
    await put({ managed: true, stop: "balanced", pins: { stORE: 0 } });
    const b = await json(await put({ managed: false }));
    expect(b.pins).toEqual({});
    expect(b.allocation.stORE).toBe(10);
  });

  it("the undo keeps a coin switched off", async () => {
    await put({ managed: true, stop: "balanced", pins: { stORE: 0 } });
    const before = await repo.getRules(U);
    await repo.saveRules(U, { prevAllocation: split({ SKR: 60, hSOL: 40 }), allocationDay: "2026-10-23", pins: before.pins });
    const res = await undo(new Request("http://x/api/rules/undo", { method: "POST", headers: auth }));
    expect(res.status).toBe(200);
    expect((await repo.getRules(U)).pins).toEqual({ hSOL: 40, stORE: 0 });
  });
});
