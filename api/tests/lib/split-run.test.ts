import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import type { CoinDayRow } from "@/db/types";
import { SKR_ONLY, ASSETS, zeroSplit, type Split } from "@/domain/coins";
import { STOP_DEFAULTS, STOPS, MOVE_LIMIT } from "@/domain/split";
import { decideSplits, applyToUsers, readFacts, factsTable } from "@/lib/split-run";
import type { ConversationCall } from "@/lib/anthropic";

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
  for (const [asset, r1, r2] of [["SKR", 1.1470, 1.1473], ["stORE", 1.0496, 1.0498], ["hSOL", 1.1889, 1.1894], ["USDC_LEND", 1.3039, 1.3042], ["SOL_LEND", 1.2119, 1.2122], ["cbBTC", null, null]] as const) {
    await repo.putCoinDay(day(asset, "2026-10-01", r1));
    await repo.putCoinDay(day(asset, DAY, r2));
  }
  return repo;
}
const answers = (input: unknown): ConversationCall => async () => ({ toolUses: [{ id: "t1", name: "set_split", input }], usage: { inputTokens: 600, outputTokens: 80 } });
const good = { SKR: 50, stORE: 10, USDC_LEND: 0, SOL_LEND: 0, hSOL: 25, cbBTC: 15, why: "hSOL grew the most of your SOL coins over the past week." };

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
    const model: ConversationCall = async (req) => { calls++; expect(req.tools.map((t) => t.name)).toContain("set_split"); return { toolUses: [{ id: "t", name: "set_split", input: good }], usage: { inputTokens: 600, outputTokens: 80 } }; };
    const rows = await decideSplits({ repo, now: NOW, model });
    expect(calls).toBe(3);
    expect(rows.map((r) => r.stop)).toEqual(["careful", "balanced", "bold"]);
    const bal = rows[1];
    expect(bal.fallback).toBeNull();
    expect(bal.why).toBe(good.why);
    expect(bal.modelAnswer).toEqual(good);
    expect(bal.split).toEqual(split({ SKR: 50, stORE: 10, hSOL: 25, cbBTC: 15 }));
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
    const again = await decideSplits({ repo, now: new Date(NOW.getTime() + 3_600_000), model: async () => { calls++; return { toolUses: [{ id: "t", name: "set_split", input: good }], usage: { inputTokens: 1, outputTokens: 1 } }; } });
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

  it("a bad sum gets one retry with the same prompt; the second answer is applied and both calls are counted (R133)", async () => {
    const repo = await seededRepo();
    const prompts: string[] = [];
    let n = 0;
    const rows = await decideSplits({ repo, now: NOW, model: async (req) => { prompts.push(req.system + String(req.messages[0].content)); return { toolUses: [{ id: "t", name: "set_split", input: n++ % 2 === 0 ? { ...good, SKR: 30 } : good }], usage: { inputTokens: 1, outputTokens: 1 } }; } });
    expect(n).toBe(6);                                                   // two calls per stop
    expect(prompts[0]).toBe(prompts[1]);                                 // the same prompt, nothing added
    expect(rows[1].fallback).toBeNull();
    expect(rows[1].modelAnswer).toEqual(good);                            // the answer applied is the retry's
    expect(rows[1].split).toEqual(split({ SKR: 50, stORE: 10, hSOL: 25, cbBTC: 15 }));
    expect((await repo.listWatcherCalls()).length).toBe(6);              // the retry counts against the budget
  });

  it("two bad sums fall back as schema after exactly two calls; a schema failure that is not the sum gets no retry (R133)", async () => {
    const repo = await seededRepo();
    let n = 0;
    const rows = await decideSplits({ repo, now: NOW, model: async () => { n++; return { toolUses: [{ id: "t", name: "set_split", input: { ...good, SKR: 30 } }], usage: { inputTokens: 1, outputTokens: 1 } }; } });
    expect(n).toBe(6);
    expect(rows.every((r) => r.fallback === "schema")).toBe(true);
    const repo2 = await seededRepo();
    let m = 0;
    const rows2 = await decideSplits({ repo: repo2, now: NOW, model: async () => { m++; return { toolUses: [{ id: "t", name: "set_split", input: { ...good, why: "" } }], usage: { inputTokens: 1, outputTokens: 1 } }; } });
    expect(m).toBe(3);
    expect(rows2.every((r) => r.fallback === "schema")).toBe(true);
  });

  it("a why with a number not in the facts is replaced by the template; the split still stands", async () => {
    const repo = await seededRepo();
    const rows = await decideSplits({ repo, now: NOW, model: answers({ ...good, why: "hSOL grew at 99.9% a year, so it leads." }) });
    expect(rows[1].fallback).toBeNull();
    expect(rows[1].why).toMatch(/hSOL grew at .* the most of your coins\./);
  });

  it("an answer is held to the move limit against yesterday's row for the stop", async () => {
    const repo = await seededRepo();
    await repo.putSplitDay({ day: "2026-10-01", stop: "bold", split: STOP_DEFAULTS.bold, modelAnswer: null, why: null, fallback: null, callId: null, venuePick: null });
    const rows = await decideSplits({ repo, now: NOW, model: answers({ SKR: 25, stORE: 0, hSOL: 35, USDC_LEND: 5, SOL_LEND: 35, cbBTC: 0, why: "hSOL and SOL_LEND lead." }) });
    const bold = rows[2];
    expect(bold.split.hSOL).toBe(STOP_DEFAULTS.bold.hSOL + MOVE_LIMIT);
    expect(bold.split.SOL_LEND).toBe(STOP_DEFAULTS.bold.SOL_LEND);   // no venue rows today: a no-data leg is held at yesterday's share (R132)
    expect(sum(bold.split)).toBe(100);
  });

  it("a coin with no data today is excluded and told to the model", async () => {
    const repo = await seededRepo();
    await repo.putCoinDay(day("SOL_LEND", DAY, null, { ok: false, tradeable: false }));
    let table = "";
    let system = "";
    const rows = await decideSplits({ repo, now: NOW, model: async (req) => { table = String(req.messages[0].content); system = req.system; return { toolUses: [{ id: "t", name: "set_split", input: good }], usage: { inputTokens: 1, outputTokens: 1 } }; } });
    expect(table).toMatch(/SOL_LEND.*no data/);
    expect(system).toMatch(/no data or not tradeable keeps yesterday's share/); // R132: the model is told what the clamp enforces
    expect(system).toMatch(/"your coins"/);                                     // R133: the second-person nudge
    expect(rows.every((r) => r.split.SOL_LEND === 0)).toBe(true);
  });

  it("an every-coin-no-data day holds yesterday's split as no data and calls no model (spec 5.5)", async () => {
    const repo = await seededRepo();
    const prior = split({ SKR: 50, hSOL: 20, USDC_LEND: 10, SOL_LEND: 10, cbBTC: 10 });
    await repo.putSplitDay({ day: "2026-10-01", stop: "balanced", split: prior, modelAnswer: null, why: null, fallback: null, callId: null, venuePick: null });
    for (const a of ["stORE", "hSOL", "USDC_LEND", "SOL_LEND", "cbBTC"] as const) await repo.putCoinDay(day(a, DAY, null, { ok: false, tradeable: false }));
    let calls = 0;
    const rows = await decideSplits({ repo, now: NOW, model: async () => { calls++; return { toolUses: [{ id: "t", name: "set_split", input: good }], usage: { inputTokens: 1, outputTokens: 1 } }; } });
    expect(calls).toBe(0);
    expect(rows.every((r) => r.fallback === "no data")).toBe(true);
    expect(rows[1].split).toEqual(prior);                          // yesterday stands
    expect(rows[0].split).toEqual(STOP_DEFAULTS.careful);          // no yesterday: the stop default
    const repo2 = await seededRepo();                                // no model key: the same day still holds, as no data
    await repo2.putSplitDay({ day: "2026-10-01", stop: "balanced", split: prior, modelAnswer: null, why: null, fallback: null, callId: null, venuePick: null });
    for (const a of ["stORE", "hSOL", "USDC_LEND", "SOL_LEND", "cbBTC"] as const) await repo2.putCoinDay(day(a, DAY, null, { ok: false, tradeable: false }));
    const keyless = await decideSplits({ repo: repo2, now: NOW, model: null });
    expect(keyless.every((r) => r.fallback === "no data")).toBe(true);
    expect(keyless[1].split).toEqual(prior);
  });

  it("a fallback day skips coins with no measured span: cbBTC's 0 is not a measured growth (spec 6.5)", async () => {
    const repo = await seededRepo();
    for (const a of ["hSOL", "USDC_LEND", "SOL_LEND"] as const) await repo.putCoinDay(day(a, DAY, null, { ok: false, tradeable: false }));
    const [careful] = await decideSplits({ repo, now: NOW, model: null });
    expect(careful.fallback).toBe("model");
    expect(careful.split.cbBTC).toBe(0);
    expect(careful.split.stORE).toBe(10);   // R251: careful's stORE cap
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
    expect(on.allocation).toEqual(split({ SKR: 50, stORE: 10, hSOL: 25, cbBTC: 15 }));
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

import { snapshotVenues, type VenueReads, type FoundPool } from "@/lib/venues/rates";
import type { ToolUse } from "@/lib/anthropic";

describe("the AI's tools, verdicts and found venues (spec 4, R275-R278)", () => {
  const reads: VenueReads = {
    kaminoReserves: async () => [{ reserve: "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59", supplyApy: "0.0443", totalSupplyUsd: "120898638", totalBorrowUsd: "110200000" }, { reserve: "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q", supplyApy: "0.0562", totalSupplyUsd: "280000000", totalBorrowUsd: "255000000" }],
    jupiterEarn: async () => [{ address: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D", asset: { decimals: 6, price: "1" }, supplyRate: "419", rewardsRate: "36", totalAssets: "505029240765044", liquiditySupplyData: { withdrawable: "69558178691773" } }, { address: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", asset: { decimals: 9, price: "121.47" }, supplyRate: "387", rewardsRate: "0", totalAssets: "900000000000000", liquiditySupplyData: { withdrawable: "300000000000000" } }],
    kaminoVault: async () => ({ apyActual: "0.0299", tokensAvailableUsd: "446839", tokensInvestedUsd: "1214507" }),
    luloRates: async () => ({ protected: { CURRENT: 3.86 } }),
    exchangeRate: async (v) => (v === "kamino_klend" ? 1.2038 : 1.0629),
    llamaPools: async () => ({ data: [] }),
  };
  const POOL: FoundPool = { poolId: "525b2dab-ea6a-4cbc-a07f-84ce561d1f83", project: "kamino-lend", symbol: "SOL", asset: "SOL", apyBasePct: 5.6418, tvlUsd: 25_399_214 };
  const finalWith = (over: Record<string, unknown> = {}) => ({ ...good, SKR: 40, stORE: 5, USDC_LEND: 15, SOL_LEND: 10, hSOL: 25, cbBTC: 5,
    verdicts: [{ venue: "jupiter_lend", asset: "USDC_LEND", verdict: "avoid", reason: "incentive_spike" }], found: [{ poolId: POOL.poolId, note: "Kamino SOL pool at 5.6% a year." }],
    why: "Your USDC goes to Kamino, 4.4% vs Jupiter 4.2%.", ...over });
  /** Three turns per stop: read Kamino; read Jupiter and scout together; answer. Decided by the conversation's length. */
  const scripted = (final: Record<string, unknown>): ConversationCall => async (req) => {
    const u = (id: string, name: string, input: unknown): ToolUse => ({ id, name, input });
    const usage = { inputTokens: 300, outputTokens: 60 };
    if (req.messages.length === 1) return { toolUses: [u("a", "get_venue_rates", { venue: "kamino_klend" })], usage };
    if (req.messages.length === 3) return { toolUses: [u("b", "get_venue_rates", { venue: "jupiter_lend" }), u("c", "scout_yields", {})], usage };
    return { toolUses: [u("d", "set_split", final)], usage };
  };
  async function venueRepo() {
    const repo = await seededRepo();
    await snapshotVenues({ repo, now: NOW, reads });
    return repo;
  }

  it("served numbers are stored exactly; a veto holds for the day; code picks the venue; found venues are kept with their note", async () => {
    const repo = await venueRepo();
    const rows = await decideSplits({ repo, now: NOW, model: scripted(finalWith()), scout: async () => [POOL] });
    const venues = await repo.listVenueDays(DAY);
    const jup = venues.find((r) => r.venue === "jupiter_lend" && r.asset === "USDC_LEND")!;
    expect(jup).toMatchObject({ verdict: "avoid", reason: "incentive_spike" });
    const kam = venues.find((r) => r.venue === "kamino_klend" && r.asset === "USDC_LEND")!;
    expect(JSON.stringify(kam.served)).toBe(JSON.stringify([
      { asset: "USDC_LEND", supplyPct: kam.supplyPct, rewardsPct: 0, utilizationPct: kam.utilizationPct, withdrawableUsd: kam.withdrawableUsd, tvlUsd: kam.tvlUsd, avg7Pct: kam.avg7Pct, daysMeasured: 1 },
      { asset: "SOL_LEND", ...(({ day: _d, venue: _v, asset: _a, exchangeRate: _e, eligible: _el, verdict: _ve, reason: _r, served: _s, ok: _o, ...x }) => x)(venues.find((r) => r.venue === "kamino_klend" && r.asset === "SOL_LEND")!) },
    ]));
    expect(rows[1].venuePick).toEqual({ USDC_LEND: "kamino_klend", SOL_LEND: "kamino_klend" });
    expect(rows[1].why).toBe("Your USDC goes to Kamino, 4.4% vs Jupiter 4.2%.");
    expect(await repo.listFoundVenues(DAY, 5)).toEqual([{ day: DAY, poolId: POOL.poolId, project: "kamino-lend", symbol: "SOL", asset: "SOL", apyBasePct: 5.6418, tvlUsd: 25_399_214, note: "Kamino SOL pool at 5.6% a year." }]);
  });

  it("a second run the same day calls no model and keeps the day's avoid, its reason and what was served", async () => {
    const repo = await venueRepo();
    await decideSplits({ repo, now: NOW, model: scripted(finalWith()), scout: async () => [POOL] });
    const before = await repo.listVenueDays(DAY);
    let calls = 0;
    await decideSplits({ repo, now: NOW, model: async () => { calls++; return { toolUses: [], usage: { inputTokens: 1, outputTokens: 1 } }; }, scout: async () => [POOL] });
    expect(calls).toBe(0);
    expect(await repo.listVenueDays(DAY)).toEqual(before);
  });

  it("a why quoting a number nobody served is replaced by the routing line (Review Focus 5)", async () => {
    const repo = await venueRepo();
    const rows = await decideSplits({ repo, now: NOW, model: scripted(finalWith({ why: "Your USDC goes to Kamino at 9.9%." })), scout: async () => [POOL] });
    expect(rows[1].why).toBe("Your USDC goes to Kamino, 4.4% vs Jupiter 4.2%.");
  });

  it("a why that does not name where the USDC goes is replaced by the routing line", async () => {
    const repo = await venueRepo();
    const rows = await decideSplits({ repo, now: NOW, model: scripted(finalWith({ why: "Your split leans to hSOL this week." })), scout: async () => [POOL] });
    expect(rows[1].why).toBe("Your USDC goes to Kamino, 4.4% vs Jupiter 4.2%.");
  });

  it("an avoid without a reason fails the schema: the stop falls back and no veto is applied", async () => {
    const repo = await venueRepo();
    const rows = await decideSplits({ repo, now: NOW, model: scripted(finalWith({ verdicts: [{ venue: "kamino_klend", asset: "USDC_LEND", verdict: "avoid" }] })), scout: async () => [POOL] });
    expect(rows.every((r) => r.fallback === "schema")).toBe(true);
    expect((await repo.listVenueDays(DAY)).find((r) => r.venue === "kamino_klend" && r.asset === "USDC_LEND")!.verdict).toBeNull();
  });

  it("a found pool the scout never served is dropped; a model that never answers falls back after the turn limit", async () => {
    const repo = await venueRepo();
    await decideSplits({ repo, now: NOW, model: scripted(finalWith({ found: [{ poolId: "invented", note: "x" }] })), scout: async () => [POOL] });
    expect(await repo.listFoundVenues(DAY, 5)).toEqual([]);
    const repo2 = await venueRepo();
    const loop: ConversationCall = async () => ({ toolUses: [{ id: "x", name: "get_venue_rates", input: { venue: "kamino_klend" } }], usage: { inputTokens: 1, outputTokens: 1 } });
    const rows = await decideSplits({ repo: repo2, now: NOW, model: loop, scout: async () => [] });
    expect(rows[0].fallback).toBe("model");
  });

  // Task 4 review, decided here: a null verdict is fail-OPEN (code's eligibility alone); only an explicit avoid removes a venue.
  it("silence is not a veto: with no model the pick stands on code's eligibility and every verdict stays null", async () => {
    const repo = await venueRepo();
    const rows = await decideSplits({ repo, now: NOW, model: null });
    expect(rows.every((r) => r.fallback === "model")).toBe(true);
    expect(rows[1].venuePick).toEqual({ USDC_LEND: "kamino_klend", SOL_LEND: "kamino_klend" });
    expect((await repo.listVenueDays(DAY)).every((r) => r.verdict === null && r.served === null)).toBe(true);
  });

  it("one stop's avoid beats another stop's ok for the day, and the pick moves to the other venue", async () => {
    const repo = await venueRepo();
    let n = 0;
    const model: ConversationCall = async () => {
      const verdict = n++ === 1 ? { venue: "kamino_klend", asset: "USDC_LEND", verdict: "avoid", reason: "near_full" } : { venue: "kamino_klend", asset: "USDC_LEND", verdict: "ok" };
      return { toolUses: [{ id: "t", name: "set_split", input: finalWith({ verdicts: [verdict], found: [] }) }], usage: { inputTokens: 1, outputTokens: 1 } };
    };
    const rows = await decideSplits({ repo, now: NOW, model });
    expect((await repo.listVenueDays(DAY)).find((r) => r.venue === "kamino_klend" && r.asset === "USDC_LEND")).toMatchObject({ verdict: "avoid", reason: "near_full" });
    expect(rows[1].venuePick).toEqual({ USDC_LEND: "jupiter_lend", SOL_LEND: "kamino_klend" });
    expect(rows[1].why).toBe("Your USDC goes to Jupiter, 4.2% vs Kamino 4.4%.");   // the routing line still compares against the avoided venue (as the brief pins)
  });
});
