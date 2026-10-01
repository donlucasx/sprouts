import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import type { CoinDayRow } from "@/db/types";
import { SKR_ONLY, ASSETS, zeroSplit, type Split } from "@/domain/coins";
import { STOP_DEFAULTS, STOPS, MOVE_LIMIT } from "@/domain/split";
import { decideSplits, applyToUsers, readFacts, factsTable } from "@/lib/split-run";
import type { ModelCall } from "@/lib/anthropic";

const NOW = new Date("2026-10-02T14:00:00Z");
const DAY = "2026-10-02";
const split = (p: Partial<Split>): Split => ({ ...zeroSplit(), ...p });
const sum = (s: Split) => ASSETS.reduce((t, a) => t + s[a], 0);

function day(asset: CoinDayRow["asset"], d: string, rate: number | null, over: Partial<CoinDayRow> = {}): CoinDayRow {
  return { day: d, asset, rate, ratePrev: null, ratePrevDays: null, priceUsd: 100, liquidityUsd: 1e8, priceChange24h: 0, tradeable: true, lastUpdateEpoch: 1046, ok: true, ...over };
}
/** Two days of snapshots so every coin has a measured number: hSOL grows fastest. */
async function seededRepo() {
  const repo = new MemoryRepo();
  for (const [asset, r1, r2] of [["SKR", 1.1470, 1.1473], ["stORE", 1.0496, 1.0498], ["hSOL", 1.1889, 1.1894], ["JitoSOL", 1.3039, 1.3042], ["JupSOL", 1.2119, 1.2122], ["cbBTC", null, null]] as const) {
    await repo.putCoinDay(day(asset, "2026-10-01", r1));
    await repo.putCoinDay(day(asset, DAY, r2));
  }
  return repo;
}
const answers = (input: unknown): ModelCall => async () => ({ input, usage: { inputTokens: 600, outputTokens: 80 } });
const good = { SKR: 40, stORE: 5, hSOL: 25, JitoSOL: 15, JupSOL: 10, cbBTC: 5, why: "hSOL grew the most of your SOL coins over the past week." };

describe("readFacts and factsTable", () => {
  it("measures every coin and renders numbers only", async () => {
    const facts = await readFacts(await seededRepo(), DAY);
    const h = facts.find((f) => f.asset === "hSOL")!;
    expect(h.days).toBe(1);
    expect(h.growthPct).toBeGreaterThan(0);
    expect(facts.find((f) => f.asset === "cbBTC")!.growthPct).toBe(0);
    const table = factsTable(facts, "balanced", null);
    expect(table).toMatch(/hSOL/);
    expect(table).not.toMatch(/he1ius|http/);
    expect(table).toMatch(/floor 35/);
  });
});

describe("decideSplits (spec 6.2 to 6.5)", () => {
  it("one call per stop, the clamped split and the model's why persisted beside the raw answer", async () => {
    const repo = await seededRepo();
    let calls = 0;
    const model: ModelCall = async (req) => { calls++; expect(req.tool.name).toBe("set_split"); return { input: good, usage: { inputTokens: 600, outputTokens: 80 } }; };
    const rows = await decideSplits({ repo, now: NOW, model });
    expect(calls).toBe(3);
    expect(rows.map((r) => r.stop)).toEqual(["careful", "balanced", "bold"]);
    const bal = rows[1];
    expect(bal.fallback).toBeNull();
    expect(bal.why).toBe(good.why);
    expect(bal.modelAnswer).toEqual(good);
    expect(bal.split).toEqual(split({ SKR: 40, stORE: 5, hSOL: 25, JitoSOL: 15, JupSOL: 10, cbBTC: 5 }));
    expect(bal.callId).toBe(2);
    const careful = rows[0];
    expect(careful.split.SKR).toBeGreaterThanOrEqual(50);          // clamped to Careful's floor
    expect(careful.split.hSOL).toBeLessThanOrEqual(15);
    expect(sum(careful.split)).toBe(100);
    expect((await repo.listWatcherCalls()).every((c) => c.kind === "split" && c.userPubkey === null)).toBe(true);
  });

  it("a second run on the same day reuses the day's rows and calls no model", async () => {
    const repo = await seededRepo();
    await decideSplits({ repo, now: NOW, model: answers(good) });
    let calls = 0;
    const again = await decideSplits({ repo, now: new Date(NOW.getTime() + 3_600_000), model: async () => { calls++; return { input: good, usage: { inputTokens: 1, outputTokens: 1 } }; } });
    expect(calls).toBe(0);
    expect(again[1].why).toBe(good.why);
  });

  it("a bad sum falls back by rule and says so; a thrown call falls back as model; no key falls back as model", async () => {
    const repo = await seededRepo();
    const [a] = await decideSplits({ repo, now: NOW, model: answers({ ...good, SKR: 43 }) });
    expect(a.fallback).toBe("schema");
    expect(a.split.SKR).toBeGreaterThanOrEqual(STOPS.careful.floor);
    expect(a.split.hSOL).toBeGreaterThan(0);                        // the highest measured growth filled first
    expect(sum(a.split)).toBe(100);
    const repo2 = await seededRepo();
    const [b] = await decideSplits({ repo: repo2, now: NOW, model: async () => { throw new Error("502"); } });
    expect(b.fallback).toBe("model");
    const repo3 = await seededRepo();
    const [c] = await decideSplits({ repo: repo3, now: NOW, model: null });
    expect(c.fallback).toBe("model");
    expect(c.why).toMatch(/grew at .* a year over the past week/);
  });

  it("a why with a number not in the facts is replaced by the template; the split still stands", async () => {
    const repo = await seededRepo();
    const rows = await decideSplits({ repo, now: NOW, model: answers({ ...good, why: "hSOL grew at 99.9% a year, so it leads." }) });
    expect(rows[1].fallback).toBeNull();
    expect(rows[1].why).toMatch(/hSOL grew at .* the most of your coins\./);
  });

  it("an answer is held to the move limit against yesterday's row for the stop", async () => {
    const repo = await seededRepo();
    await repo.putSplitDay({ day: "2026-10-01", stop: "bold", split: STOP_DEFAULTS.bold, modelAnswer: null, why: null, fallback: null, callId: null });
    const rows = await decideSplits({ repo, now: NOW, model: answers({ SKR: 25, stORE: 0, hSOL: 35, JitoSOL: 35, JupSOL: 5, cbBTC: 0, why: "hSOL and JitoSOL lead." }) });
    const bold = rows[2];
    expect(bold.split.hSOL).toBe(STOP_DEFAULTS.bold.hSOL + MOVE_LIMIT);
    expect(bold.split.JitoSOL).toBe(STOP_DEFAULTS.bold.JitoSOL + MOVE_LIMIT);
    expect(sum(bold.split)).toBe(100);
  });

  it("a coin with no data today is excluded and told to the model", async () => {
    const repo = await seededRepo();
    await repo.putCoinDay(day("JupSOL", DAY, null, { ok: false, tradeable: false }));
    let table = "";
    const rows = await decideSplits({ repo, now: NOW, model: async (req) => { table = req.user; return { input: good, usage: { inputTokens: 1, outputTokens: 1 } }; } });
    expect(table).toMatch(/JupSOL.*no data/);
    expect(rows.every((r) => r.split.JupSOL === 0)).toBe(true);
  });

  it("an every-coin-no-data day holds yesterday's split as no data and calls no model (spec 5.5)", async () => {
    const repo = await seededRepo();
    const prior = split({ SKR: 50, hSOL: 20, JitoSOL: 10, JupSOL: 10, cbBTC: 10 });
    await repo.putSplitDay({ day: "2026-10-01", stop: "balanced", split: prior, modelAnswer: null, why: null, fallback: null, callId: null });
    for (const a of ["stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const) await repo.putCoinDay(day(a, DAY, null, { ok: false, tradeable: false }));
    let calls = 0;
    const rows = await decideSplits({ repo, now: NOW, model: async () => { calls++; return { input: good, usage: { inputTokens: 1, outputTokens: 1 } }; } });
    expect(calls).toBe(0);
    expect(rows.every((r) => r.fallback === "no data")).toBe(true);
    expect(rows[1].split).toEqual(prior);                          // yesterday stands
    expect(rows[0].split).toEqual(STOP_DEFAULTS.careful);          // no yesterday: the stop default
    const repo2 = await seededRepo();                                // no model key: the same day still holds, as no data
    await repo2.putSplitDay({ day: "2026-10-01", stop: "balanced", split: prior, modelAnswer: null, why: null, fallback: null, callId: null });
    for (const a of ["stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const) await repo2.putCoinDay(day(a, DAY, null, { ok: false, tradeable: false }));
    const keyless = await decideSplits({ repo: repo2, now: NOW, model: null });
    expect(keyless.every((r) => r.fallback === "no data")).toBe(true);
    expect(keyless[1].split).toEqual(prior);
  });

  it("a fallback day skips coins with no measured span: cbBTC's 0 is not a measured growth (spec 6.5)", async () => {
    const repo = await seededRepo();
    for (const a of ["hSOL", "JitoSOL", "JupSOL"] as const) await repo.putCoinDay(day(a, DAY, null, { ok: false, tradeable: false }));
    const [careful] = await decideSplits({ repo, now: NOW, model: null });
    expect(careful.fallback).toBe("model");
    expect(careful.split.cbBTC).toBe(0);
    expect(careful.split.stORE).toBe(5);
    expect(sum(careful.split)).toBe(100);
  });

  it("the month's budget gone means every stop falls back as budget", async () => {
    const repo = await seededRepo();
    await repo.addWatcherCall({ userPubkey: "U", kind: "compile", inputTokens: 0, outputTokens: 0, costMicrocents: 1_000_000_000, ts: NOW });
    const rows = await decideSplits({ repo, now: NOW, model: answers(good) });
    expect(rows.every((r) => r.fallback === "budget")).toBe(true);
  });
});

describe("applyToUsers (spec 6.6)", () => {
  async function users() {
    const repo = await seededRepo();
    for (const u of ["ON", "PINNED", "OFF"]) await repo.upsertUser({ seedVaultPubkey: u, sgtMint: `M-${u}`, skrName: null });
    await repo.saveRules("ON", { managed: true, stop: "balanced" });
    await repo.saveRules("PINNED", { managed: true, stop: "balanced", pins: { cbBTC: 20 } });
    await repo.saveRules("OFF", { managed: false, pins: { stORE: 20 }, allocation: split({ SKR: 80, stORE: 20 }) });
    await decideSplits({ repo, now: NOW, model: answers(good) });
    return repo;
  }

  it("moves every managed user to today's split around their pins, keeps the previous for undo, and records the event", async () => {
    const repo = await users();
    const r = await applyToUsers({ repo, now: NOW });
    expect(r.changed.sort()).toEqual(["ON", "PINNED"]);
    const on = await repo.getRules("ON");
    expect(on.allocation).toEqual(split({ SKR: 40, stORE: 5, hSOL: 25, JitoSOL: 15, JupSOL: 10, cbBTC: 5 }));
    expect(on.prevAllocation).toEqual(SKR_ONLY);
    expect(on.allocationDay).toBe(DAY);
    const pinned = await repo.getRules("PINNED");
    expect(pinned.allocation.cbBTC).toBe(20);
    expect(sum(pinned.allocation)).toBe(100);
    const off = await repo.getRules("OFF");
    expect(off.allocation).toEqual(split({ SKR: 80, stORE: 20 }));
    expect(off.prevAllocation).toBeNull();
    const ev = repo.events.filter((e) => e.kind === "split_changed");
    expect(ev.length).toBe(2);
    expect((ev[0].detail as { by: string; why: string }).by).toBe("manager");
    expect((ev[0].detail as { why: string }).why).toBe(good.why);
  });

  it("running apply again the same day changes nothing and adds no event", async () => {
    const repo = await users();
    await applyToUsers({ repo, now: NOW });
    const before = repo.events.length;
    const r = await applyToUsers({ repo, now: new Date(NOW.getTime() + 60_000) });
    expect(r.changed).toEqual([]);
    expect(repo.events.length).toBe(before);
  });

  it("before any split row exists, a managed user gets the stop default", async () => {
    const repo = new MemoryRepo();
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.saveRules("U", { managed: true, stop: "careful" });
    await applyToUsers({ repo, now: NOW });
    expect((await repo.getRules("U")).allocation).toEqual(STOP_DEFAULTS.careful);
  });
});
