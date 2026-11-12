import { describe, it, expect, vi } from "vitest";
import { previewTotals, walletSwaps, PREVIEW_MAX_PAGES, type FetchPage } from "@/lib/preview";
import { DEFAULT_RULES } from "@/domain/roundup";
import type { HeliusEnhancedTx } from "@/lib/book-swap";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = 1_794_500_000;
const buy = (sig: string, ts: number, usd: number, feePayer = "W"): HeliusEnhancedTx => ({
  signature: sig, timestamp: ts, type: "SWAP", feePayer,
  tokenTransfers: [
    { fromUserAccount: "W", toUserAccount: "POOL", mint: USDC, tokenAmount: usd },
    { fromUserAccount: "POOL", toUserAccount: "W", mint: "TOKEN", tokenAmount: 5 },
  ],
});
const pages = (...ps: HeliusEnhancedTx[][]): FetchPage => {
  let i = 0;
  return vi.fn(async () => ps[i++] ?? []);
};

describe("previewTotals", () => {
  it("sums each day's savings capped at the daily limit, and the add-10-cents comparison", () => {
    const swaps = [{ day: "d1", sizeCents: 117 }, { day: "d1", sizeCents: 100 }, { day: "d2", sizeCents: 100 }];
    expect(previewTotals(swaps, DEFAULT_RULES)).toMatchObject({ swaps: 3, savedCents: 83, perSwapSavedCents: 83 + 10 + 10 + 10 });
    const many = Array.from({ length: 100 }, () => ({ day: "d1", sizeCents: 101 }));
    // the cap holds with the new rules on too
    expect(previewTotals(many, { ...DEFAULT_RULES, perSwapOn: true, perSwapCents: 25, smallOn: true }).savedCents).toBe(DEFAULT_RULES.dailyCapCents);
    expect(previewTotals(many, DEFAULT_RULES).savedCents).toBe(DEFAULT_RULES.dailyCapCents);
  });
});

describe("walletSwaps", () => {
  const price = async () => null;

  it("reads the wallet's own swaps of the last 30 days, newest first, and stops at the window's start", async () => {
    const f = pages([buy("a", NOW - 100, 1.17), buy("b", NOW - 200, 1), buy("old", NOW - 31 * 86_400, 5)], [buy("never", NOW - 40 * 86_400, 5)]);
    const r = await walletSwaps("W", { fetchPage: f, priceUsd: price, nowS: NOW });
    expect(r).toEqual({ swaps: [{ day: expect.any(String), sizeCents: 117 }, { day: expect.any(String), sizeCents: 100 }], partial: false });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a short page is the whole history: one read, no empty second call", async () => {
    const f = pages([buy("a", NOW - 100, 1.17)]);
    expect((await walletSwaps("W", { fetchPage: f, priceUsd: price, nowS: NOW })).partial).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("leaves out transactions another account paid for (an airdrop or someone else's swap)", async () => {
    const r = await walletSwaps("W", { fetchPage: pages([buy("x", NOW - 10, 3.5, "SOMEONE")]), priceUsd: price, nowS: NOW });
    expect(r.swaps).toEqual([]);
  });

  it("pages with `before` and says partial when the page limit is reached", async () => {
    const full = (p: number) => Array.from({ length: 100 }, (_, i) => buy(`p${p}-${i}`, NOW - 1000 * (p + 1) - i, 2.5));
    const f = vi.fn(async (_w: string, _before: string | undefined) => full(0));
    const r = await walletSwaps("W", { fetchPage: f, priceUsd: price, nowS: NOW });
    expect(f).toHaveBeenCalledTimes(PREVIEW_MAX_PAGES);
    expect(f.mock.calls[1][1]).toBe("p0-99");
    expect(r.partial).toBe(true);
  });
});
