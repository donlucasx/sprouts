import { describe, it, expect, beforeEach, vi } from "vitest";
import { isStockName, stockMints, _clearStockCache } from "@/lib/token-kind";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const asset = (id: string, name: string, symbol: string) => ({ id, content: { metadata: { name, symbol } } });

describe("isStockName (names as the tokens carry them, 11-12)", () => {
  it.each([
    ["NVIDIA xStock", "NVDAx"], ["Tesla (Ondo Tokenized)", "TSLAon"], ["Tesla - Backpack Securities", "TSLA"], ["Anduril PreStocks", "ANDURIL"],
  ])("%s is a share", (name, symbol) => expect(isStockName(name, symbol)).toBe(true));
  it.each([["Bonk", "Bonk"], ["Hylo 3x Leveraged SOL", "xSOL"], ["Meteora", "MET"], ["Stockpile Cat", "STOCKPILE"]])("%s is not", (name, symbol) =>
    expect(isStockName(name, symbol)).toBe(false));
});

describe("stockMints", () => {
  beforeEach(() => _clearStockCache());

  it("asks once for unknown mints, never for known coins, and caches the answer", async () => {
    const f = vi.fn(async () => ({ json: async () => ({ result: [asset("NVDA", "NVIDIA xStock", "NVDAx"), asset("BONK", "Bonk", "Bonk")] }) }));
    expect([...(await stockMints([USDC, "NVDA", "BONK"], f, "rpc"))]).toEqual(["NVDA"]);
    expect(JSON.parse((f.mock.calls[0] as any)[1].body).params.ids).toEqual(["NVDA", "BONK"]);
    expect([...(await stockMints(["NVDA", "BONK"], f, "rpc"))]).toEqual(["NVDA"]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a failed lookup labels nothing a stock and is asked again next time", async () => {
    const down = vi.fn(async () => { throw new Error("timeout"); });
    expect((await stockMints(["NVDA"], down, "rpc")).size).toBe(0);
    const up = vi.fn(async () => ({ json: async () => ({ result: [asset("NVDA", "NVIDIA xStock", "NVDAx")] }) }));
    expect([...(await stockMints(["NVDA"], up, "rpc"))]).toEqual(["NVDA"]);
  });
});
