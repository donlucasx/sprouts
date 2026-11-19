import { describe, it, expect, vi } from "vitest";
import { previewTotals, walletSwaps, parsedEventToTx, PREVIEW_MAX_PAGES, type FetchPage } from "@/lib/preview";
import { DEFAULT_RULES } from "@/domain/roundup";
import { extractSwapLegs, type HeliusEnhancedTx } from "@/lib/book-swap";
import { WSOL } from "@/domain/sizing";
import fixture from "../fixtures/helius-parsed-events.json";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = 1_794_500_000;
const buy = (sig: string, ts: number, usd: number, feePayer = "W"): HeliusEnhancedTx => ({
  signature: sig, timestamp: ts, type: "SWAP", feePayer,
  tokenTransfers: [
    { fromUserAccount: "W", toUserAccount: "POOL", mint: USDC, tokenAmount: usd },
    { fromUserAccount: "POOL", toUserAccount: "W", mint: "TOKEN", tokenAmount: 5 },
  ],
});
/** Pages served in order; every page but the last says there is more. */
const pages = (...ps: HeliusEnhancedTx[][]): FetchPage => {
  let i = 0;
  return vi.fn(async () => {
    const txs = ps[i] ?? [];
    i++;
    return { txs, next: i < ps.length ? `c${i}` : null };
  });
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

describe("parsedEventToTx (Helius Parsed Events, fixture scrubbed to WALLET)", () => {
  const WALLET = "WALLET1111111111111111111111111111111111111";
  const items = fixture.data as unknown[];
  const bySig = (prefix: string) => items.find((e) => (e as { signature: string }).signature.startsWith(prefix));

  it("a sell (token for SOL) reads the wallet's legs", () => {
    const tx = parsedEventToTx(bySig("3YrEEoPF"), WALLET)!;
    expect(tx).toMatchObject({ timestamp: 1795128576, type: "SWAP", feePayer: WALLET });
    expect(extractSwapLegs(tx, WALLET)).toEqual({
      wallet: WALLET, inMint: "6oGuFDbEeaSzTcvrmmd2MqfNYwHKXFoN7regcR22pump", inAmount: 7899.04282, outMint: WSOL, outAmount: 0.002500221,
    });
  });

  it("a buy (SOL for a token) reads the wallet's legs, both wSOL transfers out added up", () => {
    const legs = extractSwapLegs(parsedEventToTx(bySig("UsnzUrW2"), WALLET)!, WALLET)!;
    expect(legs.inMint).toBe(WSOL);
    expect(legs.inAmount).toBeCloseTo(0.000725565, 12);
    expect(legs).toMatchObject({ outMint: "6oGuFDbEeaSzTcvrmmd2MqfNYwHKXFoN7regcR22pump", outAmount: 2551.336647 });
  });

  it("a SOL transfer out, a SOL transfer in and an unparsed item are no swap", () => {
    for (const p of ["65dgazUc", "5JEoLRgA", "4n2SuJw3"]) {
      const tx = parsedEventToTx(bySig(p), WALLET);
      expect(tx).not.toBeNull();
      expect(extractSwapLegs(tx!, WALLET)).toBeNull();
    }
  });

  it("an item with no signature or no time is dropped", () => {
    expect(parsedEventToTx({ parsed: { blockTime: 1 } }, WALLET)).toBeNull();
    expect(parsedEventToTx({ signature: "s", parsed: {} }, WALLET)).toBeNull();
    expect(parsedEventToTx(null, WALLET)).toBeNull();
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

  it("no cursor is the whole history: one read, not partial", async () => {
    const f = pages([buy("a", NOW - 100, 1.17)]);
    expect((await walletSwaps("W", { fetchPage: f, priceUsd: price, nowS: NOW })).partial).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a short page with a cursor is not the end (Parsed Events answered 49 of 100 and a cursor)", async () => {
    const f = pages([buy("a", NOW - 100, 1)], [buy("b", NOW - 200, 1)]);
    const r = await walletSwaps("W", { fetchPage: f, priceUsd: price, nowS: NOW });
    expect(f).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ partial: false });
    expect(r.swaps).toHaveLength(2);
  });

  it("leaves out transactions another account paid for (an airdrop or someone else's swap)", async () => {
    const r = await walletSwaps("W", { fetchPage: pages([buy("x", NOW - 10, 3.5, "SOMEONE")]), priceUsd: price, nowS: NOW });
    expect(r.swaps).toEqual([]);
  });

  it("reads at most 2 pages, passes page 1's cursor to page 2, and says partial when there is more inside the window", async () => {
    expect(PREVIEW_MAX_PAGES).toBe(2);
    const f = vi.fn<FetchPage>(async (_w, cursor) => ({ txs: [buy(`s-${cursor ?? "first"}`, NOW - 1000, 2.5)], next: `after-${cursor ?? "first"}` }));
    const r = await walletSwaps("W", { fetchPage: f, priceUsd: price, nowS: NOW });
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][1]).toBeUndefined();
    expect(f.mock.calls[1][1]).toBe("after-first");
    expect(r.partial).toBe(true);
  });
});
