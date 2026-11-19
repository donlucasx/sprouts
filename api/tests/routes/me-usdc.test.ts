import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/subscriptions", () => ({ readUsdcBalanceRaw: vi.fn(async () => 0n) }));
const { solLamports, tokenAccounts } = vi.hoisted(() => ({
  solLamports: { v: 70_000_000n as bigint | null },
  tokenAccounts: { v: [] as { pubkey: string; mint: string; amount: string; decimals: number }[] | null },
}));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getBalance: () => ({ send: async () => { if (solLamports.v === null) throw new Error("rpc down"); return { value: solLamports.v }; } }),
  getTokenAccountsByOwner: () => ({ send: async () => {
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
}));

import { readUsdcBalanceRaw } from "@/lib/subscriptions";
import { getQuote, jupiterToken, pricesUsd } from "@/lib/jupiter";
import { GET } from "@/app/api/me/usdc/route";
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

const get = async (token?: string) => GET(new Request("http://x/api/me/usdc", token ? { headers: { authorization: `Bearer ${token}` } } : {}));

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
    solLamports.v = 20_000_000n;
    expect((await (await get(await issueSession(U, "M"))).json()).topUpCents).toEqual([]);
    solLamports.v = null;
    expect((await (await get(await issueSession(U, "M"))).json()).topUpCents).toBeNull();
    solLamports.v = 70_000_000n;
  });

  it('0.1.10: answers the SOL in lamports for the no-SOL note, null when it cannot be read', async () => {
    solLamports.v = 1_000n;
    expect((await (await get(await issueSession(U, 'M'))).json()).solLamports).toBe('1000');
    solLamports.v = null;
    expect((await (await get(await issueSession(U, 'M'))).json()).solLamports).toBeNull();
    solLamports.v = 70_000_000n;
  });

  // Task 7: the coins this wallet can top up from, SOL first; 0.1.11 reads only usdcRaw, topUpCents and solLamports
  describe("topUpSources", () => {
    const SKR = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
    const HSOL = "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A";
    const FAKE = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";
    const NOROUTE = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
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
      ];
      vi.mocked(pricesUsd).mockImplementation(async (mints) => {
        const p: Record<string, number> = { [SKR]: 0.02, [FAKE]: 1, [HSOL]: 200, [NOROUTE]: 0.3 };
        return Object.fromEntries(mints.filter((m) => p[m]).map((m) => [m, { usdPrice: p[m], liquidity: null, priceChange24h: null, decimals: null }]));
      });
      vi.mocked(jupiterToken).mockImplementation(async (mint) =>
        mint === SKR ? { symbol: "SKR", decimals: 6, verified: true, tokenProgram: TOKEN }
          : mint === NOROUTE ? { symbol: "JUP", decimals: 6, verified: true, tokenProgram: TOKEN }
          : mint === HSOL ? { symbol: "hSOL", decimals: 9, verified: true, tokenProgram: TOKEN }
          : { symbol: "FAKE", decimals: 6, verified: false, tokenProgram: TOKEN });
      vi.mocked(getQuote).mockImplementation(async (a) => { if (a.inputMint === NOROUTE) throw new Error("no route"); return {} as never; });
    });

    it("lists SOL first, then the verified, routed coins the wallet holds enough of; never a garden coin, an unverified or an unrouted one", async () => {
      vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(0n);
      const body = await (await get(await issueSession(U, "M"))).json();
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

    it("answers topUpSources null when the balances cannot be read, every other key as before", async () => {
      vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(2_050_000n);
      tokenAccounts.v = null;
      const body = await (await get(await issueSession(U, "M"))).json();
      expect(body).toEqual({ usdcRaw: "2050000", topUpCents: [500, 1_000], solLamports: "70000000", topUpSources: null });
    });

    it("answers null when the prices cannot be read", async () => {
      vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(0n);
      vi.mocked(pricesUsd).mockRejectedValueOnce(new Error("jupiter down"));
      expect((await (await get(await issueSession(U, "M"))).json()).topUpSources).toBeNull();
    });

    it("SOL alone when the wallet holds no other coin", async () => {
      vi.mocked(readUsdcBalanceRaw).mockResolvedValueOnce(0n);
      tokenAccounts.v = [];
      expect((await (await get(await issueSession(U, "M"))).json()).topUpSources).toEqual([{ mint: WSOL, symbol: "SOL", decimals: 9, valueCents: 1_400, offers: [500, 1_000] }]);
    });
  });

  it("requires a session", async () => {
    expect((await get()).status).toBe(401);
  });
});
