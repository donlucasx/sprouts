import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { heliusEnsureAddresses, heliusRemoveAddresses, heliusAddAddress, heliusParsedPage } from "@/lib/helius";
import parsedFixture from "../fixtures/helius-parsed-events.json";

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

describe("heliusRemoveAddresses", () => {
  it("removes only the given addresses, keeps the others and the webhook's fields", async () => {
    const { hook, puts } = fakeHelius(["A", "B", "C"]);
    expect(await heliusRemoveAddresses("WH", ["B", "Z"], FAST)).toEqual([]);
    expect(puts).toHaveLength(1);
    expect(puts[0].accountAddresses).toEqual(["A", "C"]);
    expect(puts[0]).toMatchObject({ webhookURL: hook.webhookURL, transactionTypes: ["ANY"], webhookType: "enhanced", authHeader: "Bearer s" });
  });

  it("writes nothing when none of them is on the webhook", async () => {
    const { puts } = fakeHelius(["A"]);
    expect(await heliusRemoveAddresses("WH", ["B"], FAST)).toEqual([]);
    expect(puts).toHaveLength(0);
  });

  it("a racing link write re-added the revoked wallet after our PUT: the second PUT removes it", async () => {
    const { hook, puts } = fakeHelius(["A", "B"], (h, n) => { if (n === 1) h.accountAddresses = ["A", "B", "X"]; });
    expect(await heliusRemoveAddresses("WH", ["B"], FAST)).toEqual([]);
    expect(puts).toHaveLength(2);
    expect(hook.accountAddresses.sort()).toEqual(["A", "X"]);
  });

  it("returns what is still on the webhook after the last try", async () => {
    fakeHelius(["A", "B"], (h) => { h.accountAddresses = ["A", "B"]; });
    expect(await heliusRemoveAddresses("WH", ["B"], { tries: 2, settleMs: 0 })).toEqual(["B"]);
  });

  it("keeps an address whose stillRevoked answers false", async () => {
    const { puts } = fakeHelius(["A", "B", "C"]);
    const stillRevoked = vi.fn(async (k: string) => k !== "B");
    expect(await heliusRemoveAddresses("WH", ["B", "C"], { ...FAST, stillRevoked })).toEqual([]);
    expect(puts[0].accountAddresses).toEqual(["A", "B"]);
  });

  it("never writes an empty list: removing the last address writes nothing and returns it", async () => {
    const { puts } = fakeHelius(["B"]);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await heliusRemoveAddresses("WH", ["B"], FAST)).toEqual(["B"]);
    expect(puts).toHaveLength(0);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("a failed write throws with no URL (the key) in the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: { method?: string }) =>
      init?.method === "PUT" ? new Response("nope", { status: 500 }) : new Response(JSON.stringify({ webhookID: "WH", webhookURL: "u", transactionTypes: ["ANY"], accountAddresses: ["A", "B"], webhookType: "enhanced" }))));
    const e = (await heliusRemoveAddresses("WH", ["B"], FAST).catch((x: unknown) => x)) as Error;
    expect(e.message).toContain("Helius update webhook failed: 500");
    expect(e.message).not.toContain("test-key");
    expect(e.message).not.toContain("api.helius.xyz");
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

describe("heliusParsedPage (Home preview, Parsed Events)", () => {
  const W = "WALLET1111111111111111111111111111111111111";

  it("POSTs every type, 100 a page, passes the cursor as paginationToken and maps the items", async () => {
    const f = vi.fn(async (_url: string, _init?: { body?: string }) => new Response(JSON.stringify(parsedFixture)));
    vi.stubGlobal("fetch", f);
    const first = await heliusParsedPage(W, undefined);
    expect(first.next).toBe(parsedFixture.paginationToken);
    expect(first.txs).toHaveLength(parsedFixture.data.length);
    expect(first.txs[0]).toMatchObject({ signature: parsedFixture.data[0].signature, type: "SWAP", feePayer: W });
    expect(f.mock.calls[0][0]).toContain("/v1/parsed-events/transaction-history");
    expect(JSON.parse(f.mock.calls[0][1]!.body!)).toEqual({ address: W, limit: 100 });
    await heliusParsedPage(W, "400000004:1");
    expect(JSON.parse(f.mock.calls[1][1]!.body!)).toEqual({ address: W, limit: 100, paginationToken: "400000004:1" });
  });

  it("no paginationToken is the end of the history", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
    expect(await heliusParsedPage(W, "c")).toEqual({ txs: [], next: null });
  });

  it("tries once more after a 429, then fails with the status and no URL (the URL carries the key)", async () => {
    const f = vi.fn(async () => new Response("slow down https://api.helius.xyz/?api-key=test-key", { status: 429 }));
    vi.stubGlobal("fetch", f);
    const err = await heliusParsedPage(W, undefined).then(() => null, (e: Error) => e);
    expect(f).toHaveBeenCalledTimes(2);
    expect(err?.message).toBe("history 429");
  });

  it("a network failure names no URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed https://api.helius.xyz/?api-key=test-key"); }));
    await expect(heliusParsedPage(W, undefined)).rejects.toThrow(/^history TypeError$/);
  });
});
