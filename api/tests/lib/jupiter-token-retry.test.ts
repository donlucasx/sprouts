import { describe, it, expect, vi, afterEach } from "vitest";
import { jupiterToken, isJupiterRateLimit } from "@/lib/jupiter";

// 11-25 (server queue): the token search goes through jupiterFetch, so a 429 is retried and, after the last attempt, reads as a rate limit.
describe("jupiterToken on a 429", () => {
  process.env.JUPITER_API_KEY ??= "test";
  afterEach(() => vi.unstubAllGlobals());
  const MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
  it("retries and returns the token", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1
      ? new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } })
      : new Response(JSON.stringify([{ id: MINT, symbol: "JUP", decimals: 6, isVerified: true, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }])))));
    expect(await jupiterToken(MINT)).toEqual({ symbol: "JUP", decimals: 6, verified: true, tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" });
    expect(n).toBe(2);
  });
  it("after three 429s throws a rate-limit error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 429, headers: { "retry-after": "0.01" } })));
    const e = await jupiterToken(MINT).catch((x) => x);
    expect(isJupiterRateLimit(e)).toBe(true);
  });
});
