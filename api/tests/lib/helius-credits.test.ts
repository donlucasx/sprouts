import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createSolanaRpcFromTransport } from "@solana/kit";
import { MemoryRepo } from "@/db/memory";
import {
  creditCycleStart, rpcCreditCost, countHelius, flushHeliusCredits, checkHeliusCredits, pendingHeliusCredits, _resetHeliusCredits,
  heliusCreditAlertCard, countingFetch, HELIUS_REST_COST,
} from "@/lib/helius-credits";

// No real Helius, no real Discord: every network call here is a stub.
const FAKE = "https://rpc.example.test/?api-key=FAKEKEY-0000-1111";

describe("creditCycleStart: the billing cycle starts on the 14th (UTC)", () => {
  it("names the latest 14th at or before now", () => {
    expect(creditCycleStart(new Date("2026-11-19T10:00Z"))).toBe("2026-11-14");
    expect(creditCycleStart(new Date("2026-11-14T00:00Z"))).toBe("2026-11-14");
    expect(creditCycleStart(new Date("2026-11-13T23:59Z"))).toBe("2026-10-14");
    expect(creditCycleStart(new Date("2026-01-05T00:00Z"))).toBe("2025-12-14");
  });
});

describe("rpcCreditCost", () => {
  it("1 for a plain call, 10 for getProgramAccounts and DAS", () => {
    expect(rpcCreditCost("getBalance")).toBe(1);
    expect(rpcCreditCost("getProgramAccounts")).toBe(10);
    expect(rpcCreditCost("getAssetsByOwner")).toBe(10);
    expect(rpcCreditCost("searchAssets")).toBe(10);
    expect(rpcCreditCost("getAssetBatch")).toBe(10);
  });
  it("REST costs: webhook edits 100, a webhook read 1, parsed events 10 a page", () => {
    expect(HELIUS_REST_COST.webhookWrite).toBe(100);
    expect(HELIUS_REST_COST.webhookRead).toBe(1);
    expect(HELIUS_REST_COST.parsedEvents).toBe(10);
  });
});

describe("flushHeliusCredits", () => {
  beforeEach(() => _resetHeliusCredits());
  const now = new Date("2026-11-19T10:00Z");

  it("two counts make one event with their sum and the cycle", async () => {
    const repo = new MemoryRepo();
    countHelius(3_000, now);
    countHelius(3_000, now);
    expect(await flushHeliusCredits(repo, now)).toBe(6_000);
    expect(repo.events).toHaveLength(1);
    expect(repo.events[0]).toMatchObject({ kind: "helius_credits", userPubkey: null, walletPubkey: null, detail: { cycle: "2026-11-14", credits: 6_000 } });
    expect(pendingHeliusCredits()).toBe(0);
    expect(await flushHeliusCredits(repo, now)).toBe(0);   // nothing pending: no event
    expect(repo.events).toHaveLength(1);
  });

  it("a failed write keeps the count pending and the next flush writes it", async () => {
    const repo = new MemoryRepo();
    countHelius(3_000, now);
    countHelius(3_000, now);
    const real = repo.addEvent.bind(repo);
    repo.addEvent = async () => { throw new Error("db down"); };
    await expect(flushHeliusCredits(repo, now)).rejects.toThrow("db down");
    expect(pendingHeliusCredits()).toBe(6_000);
    repo.addEvent = real;
    expect(await flushHeliusCredits(repo, now)).toBe(6_000);
    expect(repo.events.map((e) => (e.detail as { credits: number }).credits)).toEqual([6_000]);
  });

  it("counting outside a request only accumulates (no throw), even past the flush threshold", () => {
    countHelius(4_000, now);
    countHelius(4_000, now);
    expect(pendingHeliusCredits()).toBe(8_000);
  });
});

describe("checkHeliusCredits", () => {
  const now = new Date("2026-11-19T10:00Z");
  async function repoWith(credits: number[], cycle = "2026-11-14") {
    const repo = new MemoryRepo();
    for (const c of credits) await repo.addEvent({ userPubkey: null, walletPubkey: null, kind: "helius_credits", detail: { cycle, credits: c } });
    return repo;
  }
  const alerts = () => {
    const calls: [number, number][] = [];
    return { calls, alert: async (level: number, credits: number) => { calls.push([level, credits]); return true; } };
  };

  it("699,999: nothing posted", async () => {
    const repo = await repoWith([600_000, 99_999]);
    const a = alerts();
    expect(await checkHeliusCredits({ repo, now, alert: a.alert })).toEqual({ cycle: "2026-11-14", credits: 699_999, alerted: null });
    expect(a.calls).toEqual([]);
  });

  it("700,000: posts 70 once; a second check posts nothing", async () => {
    const repo = await repoWith([700_000]);
    const a = alerts();
    expect((await checkHeliusCredits({ repo, now, alert: a.alert })).alerted).toBe(70);
    expect((await checkHeliusCredits({ repo, now, alert: a.alert })).alerted).toBeNull();
    expect(a.calls).toEqual([[70, 700_000]]);
    expect(repo.events.filter((e) => e.kind === "helius_credit_alert").map((e) => e.detail)).toEqual([{ cycle: "2026-11-14", level: 70 }]);
  });

  it("905,000 after 70 was posted: posts 90 once", async () => {
    const repo = await repoWith([700_000]);
    const a = alerts();
    await checkHeliusCredits({ repo, now, alert: a.alert });
    await repo.addEvent({ userPubkey: null, walletPubkey: null, kind: "helius_credits", detail: { cycle: "2026-11-14", credits: 205_000 } });
    expect((await checkHeliusCredits({ repo, now, alert: a.alert })).alerted).toBe(90);
    expect((await checkHeliusCredits({ repo, now, alert: a.alert })).alerted).toBeNull();
    expect(a.calls).toEqual([[70, 700_000], [90, 905_000]]);
  });

  it("905,000 with nothing posted: posts 90 only, and 70 is never posted after it", async () => {
    const repo = await repoWith([905_000]);
    const a = alerts();
    expect((await checkHeliusCredits({ repo, now, alert: a.alert })).alerted).toBe(90);
    expect((await checkHeliusCredits({ repo, now, alert: a.alert })).alerted).toBeNull();
    expect(a.calls).toEqual([[90, 905_000]]);
  });

  it("rows from the previous cycle are not counted, nor its alerts", async () => {
    const repo = await repoWith([900_000], "2026-10-14");
    await repo.addEvent({ userPubkey: null, walletPubkey: null, kind: "helius_credit_alert", detail: { cycle: "2026-10-14", level: 70 } });
    await repo.addEvent({ userPubkey: null, walletPubkey: null, kind: "helius_credits", detail: { cycle: "2026-11-14", credits: 700_000 } });
    const a = alerts();
    expect(await checkHeliusCredits({ repo, now, alert: a.alert })).toEqual({ cycle: "2026-11-14", credits: 700_000, alerted: 70 });
    expect(a.calls).toEqual([[70, 700_000]]);
  });

  it("a failed post leaves no marker, and the next check posts again", async () => {
    const repo = await repoWith([700_000]);
    const calls: number[] = [];
    let ok = false;
    const alert = async (level: number) => { calls.push(level); return ok; };
    expect((await checkHeliusCredits({ repo, now, alert })).alerted).toBeNull();
    expect(repo.events.filter((e) => e.kind === "helius_credit_alert")).toEqual([]);
    ok = true;
    expect((await checkHeliusCredits({ repo, now, alert })).alerted).toBe(70);
    expect((await checkHeliusCredits({ repo, now, alert })).alerted).toBeNull();
    expect(calls).toEqual([70, 70]);
  });

  it("with no ops webhook set the default post fails, so no marker is written", async () => {
    vi.stubEnv("ALERT_WEBHOOK_OPS", "");
    vi.stubEnv("ALERT_WEBHOOK_URL", "");
    try {
      const repo = await repoWith([700_000]);
      expect((await checkHeliusCredits({ repo, now })).alerted).toBeNull();
      expect(repo.events.filter((e) => e.kind === "helius_credit_alert")).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("sums every row of the cycle, however many (no row cap)", async () => {
    const repo = new MemoryRepo();
    for (let i = 0; i < 60_000; i++) repo.events.push({ id: i + 1, ts: new Date("2026-11-15T00:00Z"), userPubkey: null, walletPubkey: null, kind: "helius_credits", detail: { cycle: "2026-11-14", credits: 15 } });
    const a = alerts();
    expect(await checkHeliusCredits({ repo, now, alert: a.alert })).toEqual({ cycle: "2026-11-14", credits: 900_000, alerted: 90 });
  });

  it("the default alert posts to the ops channel with the brief's words", () => {
    expect(heliusCreditAlertCard(70, 712_345, "2026-11-14")).toEqual({
      channel: "ops",
      title: "Helius credits at 70%",
      text: "About 712,345 of 1,000,000 Helius credits used this cycle (since 2026-11-14), counted by Sprouts itself. Other apps on the same key are not counted.",
      todo: "Check the Helius dashboard. Cut previews and the swap check, or move the other app off this key",
    });
  });

  it("without an alert stub it posts through alertFounder to the ops webhook, pinging the founder (fetch stubbed)", async () => {
    vi.stubEnv("ALERT_WEBHOOK_OPS", "https://discord.com/api/webhooks/0/FAKE-TEST-ONLY");
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);
    try {
      const repo = await repoWith([700_000]);
      expect((await checkHeliusCredits({ repo, now })).alerted).toBe(70);
      expect(f).toHaveBeenCalledTimes(1);
      const calls = f.mock.calls as unknown as [string, RequestInit][];
      expect(calls[0][0]).toBe("https://discord.com/api/webhooks/0/FAKE-TEST-ONLY");
      const body = JSON.parse(String(calls[0][1].body)) as { content: string; embeds: { title: string; description: string }[] };
      expect(body.content).toMatch(/^<@\d+>$/);
      expect(body.embeds[0].title).toContain("Helius credits at 70%");
      expect(body.embeds[0].description).toContain("About 700,000 of 1,000,000 Helius credits");
    } finally {
      vi.unstubAllEnvs(); vi.unstubAllGlobals();
    }
  });
});

describe("transport counting: each billed request is counted, 429 retries too", () => {
  beforeEach(() => _resetHeliusCredits());
  afterEach(() => { vi.unstubAllGlobals(); });

  const ok = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 0, result: 4242 }), { status: 200, headers: { "content-type": "application/json" } });
  const tooMany = () => new Response("", { status: 429 });
  function stubFetch(...answers: (() => Response)[]) {
    let i = 0;
    const f = vi.fn(async () => answers[Math.min(i++, answers.length - 1)]());
    vi.stubGlobal("fetch", f);
    return f;
  }
  async function kit() {
    const { rpcTransport } = await import("@/lib/rpc");
    return createSolanaRpcFromTransport(rpcTransport(FAKE, { sleep: async () => {}, random: () => 0.5 }));
  }

  it("one request counts 1", async () => {
    stubFetch(ok);
    await (await kit()).getSlot().send();
    expect(pendingHeliusCredits()).toBe(1);
  });

  it("getProgramAccounts counts 10", async () => {
    const f = stubFetch(() => new Response(JSON.stringify({ jsonrpc: "2.0", id: 0, result: [] }), { status: 200 }));
    const { rpcTransport } = await import("@/lib/rpc");
    await rpcTransport(FAKE)({ payload: { jsonrpc: "2.0", id: 0, method: "getProgramAccounts", params: [] } });
    expect(f).toHaveBeenCalledTimes(1);
    expect(pendingHeliusCredits()).toBe(10);
  });

  it("a 429 retried twice counts 3 (each attempt is billed)", async () => {
    const f = stubFetch(tooMany, tooMany, ok);
    await (await kit()).getSlot().send();
    expect(f).toHaveBeenCalledTimes(3);
    expect(pendingHeliusCredits()).toBe(3);
  });

  it("countingFetch (web3.js Connection, raw DAS posts) counts each method in a body, batches too", async () => {
    const inner = vi.fn(async () => ok());
    const f = countingFetch(inner as unknown as typeof fetch);
    await f(FAKE, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "searchAssets", params: {} }) });
    await f(FAKE, { method: "POST", body: JSON.stringify([{ method: "getBalance" }, { method: "getProgramAccounts" }]) });
    await f(FAKE, { method: "POST", body: "not json" });
    expect(inner).toHaveBeenCalledTimes(3);
    expect(pendingHeliusCredits()).toBe(10 + 11 + 1);
  });
});
