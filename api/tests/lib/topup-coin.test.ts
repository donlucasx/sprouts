import { describe, it, expect, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";

// 11-24 (his "should it be recorded and show in each users activity?"): each top-up records what paid, and Activity reads it.
vi.mock("@/lib/jupiter", async (orig) => ({ ...(await orig<typeof import("@/lib/jupiter")>()), jupiterToken: vi.fn(async (m: string) => (m === "JUPmint" ? { symbol: "JUP", decimals: 6, verified: true, tokenProgram: "x" } : m === "BADmint" ? { symbol: "<script>", decimals: 6, verified: true, tokenProgram: "x" } : null)) }));
vi.mock("@/lib/planting", () => ({ signatureStatuses: vi.fn(async (s: string[]) => s.map(() => "confirmed")) }));
import { topUpCoinSymbol } from "@/lib/topup";
import { markTopUpSent, recordTopUpLanded, settleTopUps } from "@/lib/topup-record";
import { SKR_MINT, WSOL_MINT } from "@/lib/constants";

describe("topUpCoinSymbol", () => {
  it("SOL and SKR by mint, any other coin by Jupiter's symbol, null when unknown or not a plain symbol", async () => {
    expect(await topUpCoinSymbol(WSOL_MINT)).toBe("SOL");
    expect(await topUpCoinSymbol(SKR_MINT)).toBe("SKR");
    expect(await topUpCoinSymbol("JUPmint")).toBe("JUP");
    expect(await topUpCoinSymbol("NOPEmint")).toBeNull();
    expect(await topUpCoinSymbol("BADmint")).toBeNull();
  });
});

describe("top-up records carry what paid", () => {
  it("mark and landed row hold inputMint and coin; a settled row (landed later) keeps them; an old mark without them stays without", async () => {
    const repo = new MemoryRepo();
    await markTopUpSent(repo, { user: "U", signature: "s1", usdcRaw: "5000000", inputMint: "JUPmint", coin: "JUP" });
    await recordTopUpLanded(repo, { user: "U", signature: "s1", usdcRaw: "5000000", inputMint: "JUPmint", coin: "JUP", sentAt: new Date() });
    await markTopUpSent(repo, { user: "U", signature: "s2", usdcRaw: "5000000", inputMint: SKR_MINT, coin: "SKR" });   // landed later
    await markTopUpSent(repo, { user: "U", signature: "s3", usdcRaw: "5000000" });   // recorded before 11-24
    const rows = await settleTopUps(repo, "U");
    const by = Object.fromEntries(rows.map((r) => [(r.detail as { signature: string }).signature, r.detail as { coin?: string; inputMint?: string }]));
    expect(by.s1).toMatchObject({ coin: "JUP", inputMint: "JUPmint" });
    expect(by.s2).toMatchObject({ coin: "SKR", inputMint: SKR_MINT });
    expect(by.s3.coin).toBeUndefined();
    expect(by.s3.inputMint).toBeUndefined();
  });
});
