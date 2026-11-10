import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { heliusEnsureAddresses, heliusAddAddress } from "@/lib/helius";

// A fake Helius webhook endpoint: GET returns the stored webhook, PUT replaces the whole list (as Helius does).
// `onPut` runs after each PUT is stored, so a test can play a racing writer that overwrites the list.
type Hook = { webhookID: string; webhookURL: string; transactionTypes: string[]; accountAddresses: string[]; webhookType: string; authHeader?: string };
function fakeHelius(start: string[], onPut?: (h: Hook, n: number) => void) {
  const hook: Hook = { webhookID: "WH", webhookURL: "https://example.test/api/webhooks/helius", transactionTypes: ["ANY"], accountAddresses: [...start], webhookType: "enhanced", authHeader: "Bearer s" };
  const puts: Hook[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body!) as Hook;
      puts.push(body);
      hook.accountAddresses = [...body.accountAddresses];
      onPut?.(hook, puts.length);
      return new Response("{}");
    }
    return new Response(JSON.stringify(hook));
  }));
  return { hook, puts };
}
const FAST = { settleMs: 0 };

beforeEach(() => vi.stubEnv("HELIUS_API_KEY", "test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("heliusEnsureAddresses", () => {
  it("writes nothing when every address is already watched", async () => {
    const { puts } = fakeHelius(["A", "B"]);
    expect(await heliusEnsureAddresses("WH", ["A", "B"], FAST)).toEqual([]);
    expect(puts).toHaveLength(0);
  });

  it("adds only the missing ones, keeps the list and the webhook's other fields", async () => {
    const { hook, puts } = fakeHelius(["A"]);
    expect(await heliusEnsureAddresses("WH", ["A", "B", "C", "B"], FAST)).toEqual([]);
    expect(puts).toHaveLength(1);
    expect(puts[0].accountAddresses).toEqual(["A", "B", "C"]);
    expect(puts[0]).toMatchObject({ webhookURL: hook.webhookURL, transactionTypes: ["ANY"], webhookType: "enhanced", authHeader: "Bearer s" });
  });

  it("re-adds an address a racing write dropped right after ours (the 11-10 lost update)", async () => {
    // The other link read the list before our write and writes after it: ["A", "X"] wipes our "B".
    const { hook, puts } = fakeHelius(["A"], (h, n) => { if (n === 1) h.accountAddresses = ["A", "X"]; });
    expect(await heliusEnsureAddresses("WH", ["B"], FAST)).toEqual([]);
    expect(puts).toHaveLength(2);
    expect(hook.accountAddresses.sort()).toEqual(["A", "B", "X"]);   // the racer's X survives our second write
  });

  it("returns what is still missing after the last try", async () => {
    const { puts } = fakeHelius(["A"], (h) => { h.accountAddresses = ["A"]; });   // every write gets wiped
    expect(await heliusEnsureAddresses("WH", ["B", "C"], { tries: 3, settleMs: 0 })).toEqual(["B", "C"]);
    expect(puts).toHaveLength(3);
  });

  it("two links at once both end up watched", async () => {
    const { hook } = fakeHelius(["A"]);
    const [x, y] = await Promise.all([heliusEnsureAddresses("WH", ["B"], { settleMs: 5 }), heliusEnsureAddresses("WH", ["C"], { settleMs: 5 })]);
    expect([x, y]).toEqual([[], []]);
    expect(hook.accountAddresses.sort()).toEqual(["A", "B", "C"]);
  });

  it("throws on a failed write", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: { method?: string }) =>
      init?.method === "PUT" ? new Response("nope", { status: 500 }) : new Response(JSON.stringify({ webhookID: "WH", webhookURL: "u", transactionTypes: ["ANY"], accountAddresses: [], webhookType: "enhanced" }))));
    await expect(heliusEnsureAddresses("WH", ["B"], FAST)).rejects.toThrow("Helius update webhook failed: 500");
  });
});

describe("heliusAddAddress", () => {
  it("throws when the new wallet is still not watched", async () => {
    fakeHelius(["A"], (h) => { h.accountAddresses = ["A"]; });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const p = heliusAddAddress("WH", "B");
      const check = expect(p).rejects.toThrow("still missing the wallet");
      await vi.runAllTimersAsync();
      await check;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not throw when the new wallet is watched but another known one is still off (logs instead)", async () => {
    fakeHelius(["A"], (h) => { h.accountAddresses = h.accountAddresses.filter((k) => k !== "K"); });   // K keeps getting dropped
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const p = heliusAddAddress("WH", "B", ["K"]);
      await vi.runAllTimersAsync();
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
    expect(err).toHaveBeenCalledWith(expect.stringContaining("1 known wallet(s) still off"));
  });

  it("puts back a known wallet a racing write dropped, alongside the new one", async () => {
    const { hook } = fakeHelius(["A"]);   // "K" is linked in the database but was dropped from the list
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const p = heliusAddAddress("WH", "B", ["A", "K"]);
      await vi.runAllTimersAsync();
      await p;
    } finally {
      vi.useRealTimers();
    }
    expect(hook.accountAddresses.sort()).toEqual(["A", "B", "K"]);
  });
});
