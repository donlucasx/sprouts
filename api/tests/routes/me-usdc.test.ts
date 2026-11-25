import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { clearSharedReads } from "@/lib/memo";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/subscriptions", () => ({ readUsdcBalanceRaw: vi.fn(async () => 0n) }));
const { solLamports, tokenAccounts, tokenReads } = vi.hoisted(() => ({
  solLamports: { v: 70_000_000n as bigint | null },
  tokenReads: { n: 0 },
  tokenAccounts: { v: [] as { pubkey: string; mint: string; amount: string; decimals: number }[] | null },
}));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getBalance: () => ({ send: async () => { if (solLamports.v === null) throw new Error("rpc down"); return { value: solLamports.v }; } }),
  getTokenAccountsByOwner: () => ({ send: async () => {
    tokenReads.n++;
    if (tokenAccounts.v === null) throw new Error("rpc down");
    return { value: tokenAccounts.v.map((t) => ({ pubkey: t.pubkey, account: { data: { parsed: { info: { mint: t.mint, tokenAmount: { amount: t.amount, decimals: t.decimals } } } } } })) };
  } }),
}) }));
vi.mock("@/lib/jupiter", async (orig) => ({
  ...(await orig<typeof import("@/lib/jupiter")>()),
  priceUsd: vi.fn(async () => 200),
  pricesUsd: vi.fn(async () => ({})),
  getQuote: vi.fn(async () => ({})),
  jupiterToken: vi.fn(async () => null),
  // 11-23: the source probe also builds the swap and reads it like the real top-up; a Whirlpool step (variant 17) is one it may carry
  getSwapInstructions: vi.fn(async () => ({ swap: { data: swapData(17) } })),
}));
vi.mock("@/lib/puller", () => ({ pullerSigner: async () => ({ address: "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1" }) }));
/** Jupiter's shared-accounts ExactOut data with one route step of `variant` (17 = Whirlpool, 1 payload byte; 47 = one a top-up may not use). */
function swapData(variant: number): Uint8Array {
  const out = [...Buffer.from("b0d169a89a7d453e", "hex"), 0, 1, 0, 0, 0, variant, ...(variant === 17 ? [0] : variant === 47 ? [1, 0] : []), 100, 0, 1];   // 47: a_to_b, None
  return new Uint8Array([...out, ...new Array(8 + 8 + 2 + 1).fill(0)]);
}

import { readUsdcBalanceRaw } from "@/lib/subscriptions";
import { getQuote, getSwapInstructions, jupiterToken, pricesUsd } from "@/lib/jupiter";
import { GET } from "@/app/api/me/usdc/route";
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const get = async (token?: string, query = "") => GET(new Request(`http://x/api/me/usdc${query}`, token ? { headers: { authorization: `Bearer ${token}` } } : {}));
const getSources = async (token: string) => get(token, "?sources=1");
/** 0.1.13: the same read from a phone that names its version (x-sprouts-app). */
const getSourcesAs = async (token: string, version: string) => GET(new Request("http://x/api/me/usdc?sources=1", { headers: { authorization: `Bearer ${token}`, "x-sprouts-app": version } }));

// Link a wallet's note before "This phone's wallet" approves: the signed-in Seeker's own USDC, read only.
describe("GET /api/me/usdc", () => {
  beforeEach(async () => {
    setRepoForTests(new MemoryRepo());
    vi.mocked(readUsdcBalanceRaw).mockReset();
  });

  it("answers the session wallet's USDC in base units, read for that wallet only", async () => {
    vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(2_050_000n);
    const res = await get(await issueSession(U, "M"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ usdcRaw: "2050000", topUpCents: [500, 1_000] });
    expect(vi.mocked(readUsdcBalanceRaw)).toHaveBeenCalledWith(U);
  });

  it("answers null, not zero, when the chain cannot be read", async () => {
    vi.mocked(readUsdcBalanceRaw).mockRejectedValueOnce(new Error("rpc down"));
    const res = await get(await issueSession(U, "M"));
    expect((await res.json()).usdcRaw).toBeNull();
  });

  // 10-27: the "Add USDC" amounts this wallet's SOL covers; unknown (no SOL read) is null, so the app offers all and the build decides
  it("answers which top-up amounts the wallet's SOL covers, null when the SOL cannot be read", async () => {
    solLamports.v = 20_000_000n;  clearSharedReads();   // 11-25: Home's chain reads are kept 15 s; a new wallet state reads fresh
    expect((await (await get(await issueSession(U, "M"))).json()).topUpCents).toEqual([]);
    solLamports.v = null;  clearSharedReads();   // 11-25: Home's chain reads are kept 15 s; a new wallet state reads fresh
    expect((await (await get(await issueSession(U, "M"))).json()).topUpCents).toBeNull();
    solLamports.v = 70_000_000n;
  });

  it('0.1.10: answers the SOL in lamports for the no-SOL note, null when it cannot be read', async () => {
    solLamports.v = 1_000n;  clearSharedReads();   // 11-25: Home's chain reads are kept 15 s; a new wallet state reads fresh
    expect((await (await get(await issueSession(U, 'M'))).json()).solLamports).toBe('1000');
    solLamports.v = null;  clearSharedReads();   // 11-25: Home's chain reads are kept 15 s; a new wallet state reads fresh
    expect((await (await get(await issueSession(U, 'M'))).json()).solLamports).toBeNull();
    solLamports.v = 70_000_000n;
  });

  // Task 7: the coins this wallet can top up from, SOL first; 0.1.11 reads only usdcRaw, topUpCents and solLamports
  describe("topUpSources", () => {
    const SKR = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
    const HSOL = "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A";
    const FAKE = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
    const NOROUTE = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
    const THIN = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // verified, routed, but its $5 route costs $5.50 at today's price
    const WSOL = "So11111111111111111111111111111111111111112";
    const ata = async (mint: string) => (await findAssociatedTokenPda({ owner: address(U), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0] as string;
    const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    beforeEach(async () => {
      solLamports.v = 70_000_000n; // 0.07 SOL at $200 = $14: topUpCents [500, 1000]
      tokenAccounts.v = [
        { pubkey: await ata(SKR), mint: SKR, amount: "400000000", decimals: 6 }, // 400 SKR at $0.02 = $8
        { pubkey: await ata(FAKE), mint: FAKE, amount: "50000000", decimals: 6 }, // $50, unverified
        { pubkey: await ata(HSOL), mint: HSOL, amount: "1000000000", decimals: 9 }, // a garden coin, $200
        { pubkey: await ata(NOROUTE), mint: NOROUTE, amount: "100000000", decimals: 6 }, // $30, verified, no route
        { pubkey: await ata(THIN), mint: THIN, amount: "100000000000", decimals: 5 }, // 1M at $0.00002 = $20, verified, routed, overpriced
      ];
      tokenReads.n = 0;
      vi.mocked(pricesUsd).mockImplementation(async (mints) => {
        const p: Record<string, number> = { [SKR]: 0.02, [FAKE]: 1, [HSOL]: 200, [NOROUTE]: 0.3, [THIN]: 0.00002 };
        return Object.fromEntries(mints.filter((m) => p[m]).map((m) => [m, { usdPrice: p[m], liquidity: null, priceChange24h: null, decimals: null }]));
      });
      vi.mocked(jupiterToken).mockImplementation(async (mint) =>
        mint === SKR ? { symbol: "SKR", decimals: 6, verified: true, tokenProgram: TOKEN }
          : mint === NOROUTE ? { symbol: "JUP", decimals: 6, verified: true, tokenProgram: TOKEN }
          : mint === THIN ? { symbol: "BONK", decimals: 5, verified: true, tokenProgram: TOKEN }
          : mint === HSOL ? { symbol: "hSOL", decimals: 9, verified: true, tokenProgram: TOKEN }
          : { symbol: "FAKE", decimals: 6, verified: false, tokenProgram: TOKEN });
      // $5 out: SKR's maximum 251 SKR = $5.02 (within $5.15); THIN's 275,000 = $5.50 (the phone would refuse it as overpriced)
      vi.mocked(getQuote).mockImplementation(async (a) => {
        if (a.inputMint === NOROUTE) throw new Error("no route");
        return { inputMint: a.inputMint, otherAmountThreshold: a.inputMint === THIN ? "27500000000" : "251000000" } as never;
      });
    });

    it("lists SOL first, then the verified, routed coins the wallet holds enough of; never a garden coin, an unverified, an unrouted or an overpriced one", async () => {
      vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(0n);
      const body = await (await getSources(await issueSession(U, "M"))).json();
      expect(body.topUpSources).toEqual([
        { mint: WSOL, symbol: "SOL", decimals: 9, valueCents: 1_400, offers: [500, 1_000] },
        { mint: SKR, symbol: "SKR", decimals: 6, valueCents: 800, offers: [500] },
      ]);
      expect(body).toMatchObject({ usdcRaw: "0", topUpCents: [500, 1_000], solLamports: "70000000" });
      // the route check is a $5 ExactOut quote through the pinned dexes, never for a coin already refused
      const asked = vi.mocked(getQuote).mock.calls.map((c) => c[0]);
      expect(asked.every((a) => a.swapMode === "ExactOut" && a.amountRaw === 5_000_000n && a.dexes?.join(",") === "Raydium CLMM,Whirlpool")).toBe(true);
      expect(asked.map((a) => a.inputMint)).not.toContain(HSOL);
    });

    it("0.1.13: a signed-in user's coins carry their split share and cost (lib/topup-cost.ts), so the phone lists the cheapest first", async () => {
      const repo = new MemoryRepo();
      setRepoForTests(repo);
      await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
      const target = (await import("@/lib/plant-run")).plantingTarget((await import("@/db/types")).rulesRowToRules(await repo.getRules(U)), []);
      vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(0n);
      const body = await (await getSources(await issueSession(U, "M"))).json();
      const [sol, skr] = body.topUpSources;
      const { topUpCost } = await import("@/lib/topup-cost");
      expect(sol).toMatchObject({ symbol: "SOL", ...topUpCost(WSOL, target) });
      expect(skr).toMatchObject({ symbol: "SKR", ...topUpCost(SKR, target) });
      expect(skr.splitPct).toBe(Math.round(target!.SKR));
      expect(sol.costBps).toBeLessThan(skr.costBps);
    });
    it("answers topUpSources null when the balances cannot be read, every other key as before", async () => {
      vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(2_050_000n);
      tokenAccounts.v = null;
      const body = await (await getSources(await issueSession(U, "M"))).json();
      expect(body).toEqual({ usdcRaw: "2050000", topUpCents: [500, 1_000], solLamports: "70000000", topUpSources: null });
    });

    it("answers null when the prices cannot be read", async () => {
      vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(0n);
      vi.mocked(pricesUsd).mockRejectedValueOnce(new Error("jupiter down"));
      expect((await (await getSources(await issueSession(U, "M"))).json()).topUpSources).toBeNull();
    });

    // Task 7 review: opt-in, so the background refresh, Link a wallet and 0.1.11 cost what they did (no token-accounts read)
    it("without ?sources=1 answers the old shape, no topUpSources key, and reads no token accounts and no prices", async () => {
      vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(0n);
      vi.mocked(pricesUsd).mockClear();
      vi.mocked(getQuote).mockClear();
      vi.mocked(jupiterToken).mockClear();
      const body = await (await get(await issueSession(U, "M"))).json();
      expect(body).toEqual({ usdcRaw: "0", topUpCents: [500, 1_000], solLamports: "70000000" });
      expect(tokenReads.n).toBe(0);
      expect(pricesUsd).not.toHaveBeenCalled();
      expect(getQuote).not.toHaveBeenCalled();
      expect(jupiterToken).not.toHaveBeenCalled();
    });

    it("keeps a route an hour but a missing one only 10 minutes (a Jupiter hiccup never hides a coin for long)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const quoted = () => vi.mocked(getQuote).mock.calls.map((c) => c[0].inputMint as string);
        vi.mocked(getQuote).mockClear();
        await getSources(await issueSession(U, "M"));
        expect(quoted().filter((m) => m === SKR || m === NOROUTE).sort()).toEqual([NOROUTE, SKR].sort());
        vi.advanceTimersByTime(11 * 60_000);
        vi.mocked(getQuote).mockClear();
        await getSources(await issueSession(U, "M"));
        expect(quoted()).toContain(NOROUTE);
        expect(quoted()).not.toContain(SKR);
      } finally {
        vi.useRealTimers();
      }
    });

    it("11-23: a coin whose route quotes but builds with a swap variant the top-up may not carry (SKR, variant 47) is not offered", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.advanceTimersByTime(3 * 60 * 60_000);   // past every cached probe
        vi.mocked(getSwapInstructions).mockImplementation(async (a) => ({ swap: { data: swapData(a.quote.inputMint === SKR ? 47 : 17) } }) as never);
        vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(0n);
        const body = await (await getSources(await issueSession(U, "M"))).json();
        expect(body.topUpSources).toEqual([{ mint: WSOL, symbol: "SOL", decimals: 9, valueCents: 1_400, offers: [500, 1_000] }]);
        expect(vi.mocked(getSwapInstructions).mock.calls.some((c) => c[0].useSharedAccounts === true && c[0].wrapAndUnwrapSol === false)).toBe(true);
      } finally {
        vi.mocked(getSwapInstructions).mockImplementation(async () => ({ swap: { data: swapData(17) } }) as never);
        vi.useRealTimers();
      }
    });

    it("0.1.13: a route through WhirlpoolSwapV2 (47) is offered to a 0.1.13 phone, never to an older one", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.advanceTimersByTime(6 * 60 * 60_000);   // past every cached probe
        vi.mocked(getSwapInstructions).mockImplementation(async (a) => ({ swap: { data: swapData(a.quote.inputMint === SKR ? 47 : 17) } }) as never);
        vi.mocked(readUsdcBalanceRaw).mockResolvedValue(0n);
        const symbols = async (r: Response) => ((await r.json()).topUpSources as { symbol: string }[]).map((x) => x.symbol);
        expect(await symbols(await getSourcesAs(await issueSession(U, "M"), "0.1.13"))).toContain("SKR");
        expect(await symbols(await getSourcesAs(await issueSession(U, "M"), "0.1.12"))).not.toContain("SKR");
        expect(await symbols(await getSources(await issueSession(U, "M")))).not.toContain("SKR");
      } finally {
        vi.mocked(getSwapInstructions).mockImplementation(async () => ({ swap: { data: swapData(17) } }) as never);
        vi.mocked(readUsdcBalanceRaw).mockReset();
        vi.useRealTimers();
      }
    });

    it("SOL alone when the wallet holds no other coin", async () => {
      vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(0n);
      tokenAccounts.v = [];
      expect((await (await getSources(await issueSession(U, "M"))).json()).topUpSources).toEqual([{ mint: WSOL, symbol: "SOL", decimals: 9, valueCents: 1_400, offers: [500, 1_000] }]);
    });
  });

  it("requires a session", async () => {
    expect((await get()).status).toBe(401);
  });
});
