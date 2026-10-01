import { describe, it, expect } from "vitest";
import { compileRule, costMicrocents, watcherBudget, WatcherError, type ModelCall } from "@/lib/watcher";
import { MemoryRepo } from "@/db/memory";
import type { Rules } from "@/domain/roundup";

// Spec 6, the watcher's first feature: a rule typed in plain English is compiled to the rules' numbers and shown back for
// confirmation; nothing changes until the user saves. The model is injected: these tests never call the network.
const current: Rules = {
  roundupOn: true, roundupToCents: 100, pctOn: true, pctBps: 100, pctThresholdCents: 10_000,
  plantThresholdCents: 200, plantMaxDays: 7, dailyCapCents: 500, managed: false, stop: "balanced", pins: {},
  allocation: { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 },
};
const answers = (input: unknown, usage = { inputTokens: 400, outputTokens: 60 }): ModelCall => async () => ({ input, usage });

describe("compileRule", () => {
  it("returns only the fields the text changes, as a patch the Rules draft can take", async () => {
    const r = await compileRule({ text: "start the 1% at $50", current, model: answers({ pctOn: true, pctThresholdCents: 5_000, understood: "The 1% starts at $50." }) });
    expect(r.patch).toEqual({ pctThresholdCents: 5_000 });   // pctOn was already on: not a change
    expect(r.understood).toBe("The 1% starts at $50.");
    expect(r.notes).toEqual([]);
  });

  it("clamps to the controls' ranges and says so", async () => {
    const r = await compileRule({ text: "limit $50 a day", current: { ...current, dailyCapCents: 300 }, model: answers({ dailyCapCents: 5_000, understood: "Your daily limit is $50." }) });
    expect(r.patch).toEqual({ dailyCapCents: 500 });
    expect(r.notes).toEqual(["The daily limit tops out at $5.00."]);
  });

  it("snaps to the controls' steps", async () => {
    const r = await compileRule({ text: "plant at $1.23", current, model: answers({ plantThresholdCents: 123, understood: "Plant at $1.23." }) });
    expect(r.patch).toEqual({ plantThresholdCents: 100 });
  });

  it("an ORE share becomes the stORE pin, capped at 50", async () => {
    const r = await compileRule({ text: "put 70% into ORE", current, model: answers({ oreShare: 70, understood: "70% grows ORE." }) });
    expect(r.patch).toEqual({ pins: { stORE: 50 } });
    expect(r.notes).toEqual(["ORE's share tops out at 50."]);
  });

  it("nothing to change is an empty patch, not an error", async () => {
    const r = await compileRule({ text: "round up every swap", current, model: answers({ roundupOn: true, understood: "Every swap rounds up, as now." }) });
    expect(r.patch).toEqual({});
  });

  it("what Sprouts cannot do is said, never done", async () => {
    const r = await compileRule({ text: "sell everything on Fridays", current, model: answers({ understood: "Nothing changed.", cannot: "Sprouts never sells; only your Seeker can withdraw." }) });
    expect(r.patch).toEqual({});
    expect(r.notes).toEqual(["Sprouts never sells; only your Seeker can withdraw."]);
  });

  it("garbage from the model, or no model, is a plain failure and never a change", async () => {
    await expect(compileRule({ text: "x", current, model: answers({ dailyCapCents: "lots", understood: "?" }) })).rejects.toBeInstanceOf(WatcherError);
    await expect(compileRule({ text: "x", current, model: answers("not an object") })).rejects.toBeInstanceOf(WatcherError);
    await expect(compileRule({ text: "x", current, model: async () => { throw new Error("boom"); } })).rejects.toBeInstanceOf(WatcherError);
  });

  it("the model sees the current rules and the text, and nothing else", async () => {
    let seen: { system: string; user: string } | null = null;
    const model: ModelCall = async (req) => {
      seen = req;
      return { input: { understood: "ok" }, usage: { inputTokens: 1, outputTokens: 1 } };
    };
    await compileRule({ text: "double my daily limit", current, model });
    expect(seen!.user).toContain('"dailyCapCents":500');
    expect(seen!.user).toContain("double my daily limit");
    expect(JSON.stringify(seen)).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{32,44}/);   // no base58 key of any kind rides along
  });

  it("reports what the call cost", async () => {
    const r = await compileRule({ text: "x", current, model: answers({ understood: "ok" }, { inputTokens: 400, outputTokens: 60 }) });
    expect(r.usage).toEqual({ inputTokens: 400, outputTokens: 60 });
  });
});

describe("costMicrocents (Haiku 4.5: $1 per million tokens in, $5 per million out)", () => {
  it("prices a call in microcents", () => {
    expect(costMicrocents({ inputTokens: 1_000_000, outputTokens: 0 })).toBe(100_000_000);   // $1 = 100 cents = 1e8 microcents
    expect(costMicrocents({ inputTokens: 0, outputTokens: 1_000_000 })).toBe(500_000_000);
    expect(costMicrocents({ inputTokens: 400, outputTokens: 60 })).toBe(40_000 + 30_000);
  });
});

// Design notes section 5: a budget counter caps spend at $10 a month in total and a few calls per user per day; every surface
// has a template behind it, so hitting the cap changes nothing but the watcher's silence.
describe("watcherBudget", () => {
  const now = new Date("2026-10-02T17:00:00Z");
  const call = (userPubkey: string, costMicrocents: number, ts = now) => ({ userPubkey, kind: "compile" as const, inputTokens: 1, outputTokens: 1, costMicrocents, ts });

  it("is open with nothing spent", async () => {
    const repo = new MemoryRepo();
    expect(await watcherBudget(repo, "U", now)).toBeNull();
  });

  it("rests for the month once $10 has gone, whoever spent it", async () => {
    const repo = new MemoryRepo();
    await repo.addWatcherCall(call("someone-else", 1_000_000_000));
    expect(await watcherBudget(repo, "U", now)).toBe("month");
  });

  it("last month's spend does not count", async () => {
    const repo = new MemoryRepo();
    await repo.addWatcherCall(call("U", 1_000_000_000, new Date("2026-09-30T23:00:00Z")));
    expect(await watcherBudget(repo, "U", now)).toBeNull();
  });

  it("stops one user after 30 calls in a day, and only that user", async () => {
    const repo = new MemoryRepo();
    for (let i = 0; i < 30; i++) await repo.addWatcherCall(call("U", 70_000));
    expect(await watcherBudget(repo, "U", now)).toBe("day");
    expect(await watcherBudget(repo, "V", now)).toBeNull();
  });
});
