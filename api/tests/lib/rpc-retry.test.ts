import { describe, it, expect, afterEach, vi } from "vitest";
import { createSolanaRpcFromTransport, isSolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR } from "@solana/kit";
import { errorText } from "@/lib/redact";

// A fake URL with a fake key: no real key anywhere in this file.
const FAKE = "https://rpc.example.test/?api-key=FAKEKEY-0000-1111";

const ok = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 0, result: 4242 }), { status: 200, headers: { "content-type": "application/json" } });
// The status text carries the URL so the redaction is actually exercised (kit puts statusText in the error's message and context).
const tooMany = (headers: Record<string, string> = {}) => new Response("", { status: 429, statusText: `Too Many Requests ${FAKE}`, headers });

/** Stubs fetch with the given answers in order (the last repeats), and returns the mock. */
function stubFetch(...answers: (() => Response | Promise<Response>)[]) {
  let i = 0;
  const f = vi.fn(async () => answers[Math.min(i++, answers.length - 1)]());
  vi.stubGlobal("fetch", f);
  return f;
}

async function setup() {
  vi.stubEnv("HELIUS_RPC_URL", FAKE);
  const mod = await import("@/lib/rpc");
  const sleeps: number[] = [];
  const transport = mod.rpcTransport(FAKE, { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 });
  return { rpc: createSolanaRpcFromTransport(transport), sleeps, mod };
}

const leaks = (e: unknown) => JSON.stringify(e, Object.getOwnPropertyNames(e as object)).includes("FAKEKEY") || errorText(e).includes("FAKEKEY") || String((e as Error).stack).includes("FAKEKEY");

describe("rpc transport: HTTP 429 is retried (11-13: an SKR price post and a withdrawal crank failed on a Helius 429)", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

  it("429 twice then success: returns the result after 3 calls, waiting about 0.5 s then 1 s", async () => {
    const f = stubFetch(tooMany, tooMany, ok);
    const { rpc, sleeps } = await setup();
    await expect(rpc.getSlot().send()).resolves.toBe(4242n);
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1_000]);
  });

  it("429 four times: throws the 429 after 4 calls (3 retries), redacted", async () => {
    const f = stubFetch(tooMany);
    const { rpc, sleeps } = await setup();
    const err = await rpc.getSlot().send().then(() => null, (e: unknown) => e);
    expect(f).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([500, 1_000, 2_000]);
    expect(err).toBeInstanceOf(Error);
    expect(leaks(err)).toBe(false);
  });

  // 11-26 (Helius Developer plan): the user-facing builds (link approval GET, withdraw/build) get at least the daily run's budget, plus one.
  it("inside withUserRetryBudget: 4 retries (about 0.5 s, 1 s, 2 s, 4 s), and outside it the daily run's 3 again", async () => {
    const f = stubFetch(tooMany);
    const { rpc, sleeps, mod } = await setup();
    const err = await mod.withUserRetryBudget(async () => rpc.getSlot().send())().then(() => null, (e: unknown) => e);
    expect(f).toHaveBeenCalledTimes(5);
    expect(sleeps).toEqual([500, 1_000, 2_000, 4_000]);
    expect(mod.USER_RETRY_DELAYS_MS.length).toBeGreaterThanOrEqual(mod.RETRY_DELAYS_MS.length);
    expect(mod.USER_RETRY_DELAYS_MS.slice(0, mod.RETRY_DELAYS_MS.length)).toEqual([...mod.RETRY_DELAYS_MS]);
    expect(leaks(err)).toBe(false);
    sleeps.length = 0;
    f.mockClear();
    await rpc.getSlot().send().catch(() => null);
    expect(f).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([500, 1_000, 2_000]);
  });

  it("the budget follows the handler through parallel reads (Promise.all), and a success inside it returns as usual", async () => {
    stubFetch(tooMany, tooMany, tooMany, tooMany, ok);
    const { rpc, sleeps, mod } = await setup();
    await expect(mod.withUserRetryBudget(async (n: number) => Promise.all([rpc.getSlot().send()]).then(([s]) => s + BigInt(n)))(1)).resolves.toBe(4243n);
    expect(sleeps).toEqual([500, 1_000, 2_000, 4_000]);
  });

  it("the pace allows 30 requests a second (Developer plan: 50 for the whole key)", async () => {
    const { mod } = await setup();
    expect(mod.RPC_MAX_RPS).toBe(30);
  });

  it("a 500 throws at once: 1 call, no wait", async () => {
    const f = stubFetch(() => new Response("", { status: 500, statusText: "Internal Server Error" }));
    const { rpc, sleeps } = await setup();
    const err = await rpc.getSlot().send().then(() => null, (e: unknown) => e);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect(isSolanaError(err, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) && err.context.statusCode).toBe(500);
  });

  it("a network error throws at once: 1 call, no wait, the URL redacted", async () => {
    const f = stubFetch(() => { throw new TypeError("fetch failed", { cause: new Error(`connect ECONNREFUSED ${FAKE}`) }); });
    const { rpc, sleeps } = await setup();
    const err = await rpc.getSlot().send().then(() => null, (e: unknown) => e);
    expect(f).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
    expect(err).toBeInstanceOf(Error);
    expect(leaks(err)).toBe(false);
  });

  it("jitter is a 0.5x-1.5x multiplier on each base delay", async () => {
    for (const [r, want] of [[0, [250, 500, 1_000]], [0.999, [750, 1_499, 2_998]]] as const) {
      vi.resetModules();
      stubFetch(tooMany);
      vi.stubEnv("HELIUS_RPC_URL", FAKE);
      const mod = await import("@/lib/rpc");
      const sleeps: number[] = [];
      const rpc = createSolanaRpcFromTransport(mod.rpcTransport(FAKE, { sleep: async (ms) => { sleeps.push(ms); }, random: () => r }));
      await rpc.getSlot().send().catch(() => null);
      expect(sleeps).toEqual(want);
    }
  });

  it("honors Retry-After in seconds, capped at 2 s", async () => {
    const f = stubFetch(() => tooMany({ "retry-after": "1" }), () => tooMany({ "retry-after": "60" }), ok);
    const { rpc, sleeps } = await setup();
    await expect(rpc.getSlot().send()).resolves.toBe(4242n);
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it("isHttp429 reads a real kit SolanaError's code and statusCode, not its message", async () => {
    const { mod } = await setup();
    const { SolanaError } = await import("@solana/kit");
    const real429 = new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: "x", statusCode: 429 });
    expect(mod.isHttp429(real429)).toBe(true);
    expect(mod.isHttp429(new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: "x", statusCode: 503 }))).toBe(false);
    expect(mod.isHttp429(new Error("HTTP error (429): Too Many Requests"))).toBe(false);
  });
});
