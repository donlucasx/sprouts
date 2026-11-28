import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// 11-28 (Kimi Jupiter re-assessment fix 1): display and sizing prices from Helius DAS getAssetBatch, Jupiter only as the fallback.
const jupPrice = vi.fn<(m: string) => Promise<number | null>>();
vi.mock("@/lib/jupiter", () => ({ priceUsd: (m: string) => jupPrice(m) }));
vi.mock("@/lib/config", () => ({ config: () => ({ heliusRpcUrl: "https://rpc.test" }) }));

import { priceFromAsset, dasPricesUsd, dasPriceUsd, displayPriceUsd, setDasPricesForTests, setDasFetchForTests, DAS_BATCH_MAX } from "@/lib/das-price";
import { sharedPriceUsd } from "@/lib/shared-reads";

const SKR = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const STORE = "sTorERYB6xAZ1SSKYtGs5LGyLEuMuDBn7Ddr1rTZLBG";
// The 11-28 probe's shape (getAssetBatch result items, trimmed).
const asset = (id: string, price?: number, currency = "USDC") => ({ id, token_info: price === undefined ? { symbol: "X" } : { symbol: "X", price_info: { price_per_token: price, currency } } });

const fakeFetch = (result: unknown[] | (() => never)) => {
  const f = vi.fn(async (_url: string, init: RequestInit) => {
    if (typeof result === "function") result();
    const ids = (JSON.parse(String(init.body)) as { params: { ids: string[] } }).params.ids;
    return { json: async () => ({ result: (result as { id: string }[]).filter((a) => ids.includes(a.id)) }) };
  });
  return f;
};

describe("priceFromAsset (the DAS mapping)", () => {
  it("reads token_info.price_info.price_per_token in USDC or USD; anything else is no price", () => {
    expect(priceFromAsset(asset(SKR, 0.0183))).toBe(0.0183);
    expect(priceFromAsset(asset(SKR, 1.0001, "usd"))).toBe(1.0001);
    expect(priceFromAsset(asset(SKR))).toBeNull();
    expect(priceFromAsset(asset(SKR, 0.02, "EUR"))).toBeNull();
    expect(priceFromAsset(asset(SKR, 0))).toBeNull();
    expect(priceFromAsset(asset(SKR, Number.NaN))).toBeNull();
    expect(priceFromAsset({ id: SKR, token_info: { price_info: { price_per_token: "0.02" } } })).toBeNull();
    expect(priceFromAsset(null)).toBeNull();
  });
});

describe("dasPricesUsd", () => {
  it("one getAssetBatch for the mints (deduplicated), chunked at DAS_BATCH_MAX; a mint without price_info is absent", async () => {
    const f = fakeFetch([asset(SKR, 0.0183), asset(USDC, 1), asset(STORE)]);
    expect(await dasPricesUsd([SKR, USDC, STORE, SKR], f, "https://rpc.test")).toEqual({ [SKR]: 0.0183, [USDC]: 1 });
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(f.mock.calls[0][1].body));
    expect(body).toMatchObject({ method: "getAssetBatch", params: { ids: [SKR, USDC, STORE] } });
    const many = Array.from({ length: DAS_BATCH_MAX + 1 }, (_, i) => `M${i}`);
    const g = fakeFetch([]);
    await dasPricesUsd(many, g, "https://rpc.test");
    expect(g).toHaveBeenCalledTimes(2);
  });
  it("a failed call is no prices (the fallback decides), never a throw", async () => {
    expect(await dasPricesUsd([SKR], fakeFetch(() => { throw new Error("down"); }), "https://rpc.test")).toEqual({});
  });
  it("an answer naming a mint that was not asked is ignored", async () => {
    const f = vi.fn(async () => ({ json: async () => ({ result: [asset("OTHER", 5), asset(SKR, 0.02)] }) }));
    expect(await dasPricesUsd([SKR], f, "https://rpc.test")).toEqual({ [SKR]: 0.02 });
  });
});

describe("displayPriceUsd and the batcher", () => {
  beforeEach(() => { setDasPricesForTests(true); jupPrice.mockReset(); });
  afterEach(() => { setDasPricesForTests(false); setDasFetchForTests(undefined); });

  it("asks made together share ONE getAssetBatch; a mint DAS prices never reaches Jupiter", async () => {
    const f = fakeFetch([asset(SKR, 0.0183), asset(USDC, 1)]);
    setDasFetchForTests(f);
    expect(await Promise.all([displayPriceUsd(SKR), displayPriceUsd(USDC), dasPriceUsd(SKR)])).toEqual([0.0183, 1, 0.0183]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(jupPrice).not.toHaveBeenCalled();
  });
  it("FALLBACK: a mint without price_info, or a DAS failure, is priced by Jupiter (the shared lane)", async () => {
    setDasFetchForTests(fakeFetch([asset(STORE)]));
    jupPrice.mockResolvedValue(0.5);
    expect(await displayPriceUsd(STORE)).toBe(0.5);
    expect(jupPrice).toHaveBeenCalledWith(STORE);
    setDasFetchForTests(fakeFetch(() => { throw new Error("down"); }));
    jupPrice.mockResolvedValueOnce(0.02);
    expect(await displayPriceUsd(SKR)).toBe(0.02);
    jupPrice.mockResolvedValueOnce(null);
    expect(await displayPriceUsd("UNKNOWN")).toBeNull();
  });
  it("sharedPriceUsd (Home, Activity, the preview, the webhook's and the swap check's sizing) reads DAS first", async () => {
    setDasFetchForTests(fakeFetch([asset(SKR, 0.0191)]));
    expect(await sharedPriceUsd(SKR)).toBe(0.0191);
    expect(jupPrice).not.toHaveBeenCalled();
  });
});

describe("money paths stay on Jupiter's (or Pyth's) fresh price: no money module reads the DAS / shared display price", () => {
  const root = path.resolve(__dirname, "../../src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") || p.endsWith(".tsx") ? [p] : []; });
  const src = (rel: string) => readFileSync(path.join(root, rel), "utf8");
  const usesDisplay = (s: string) => /das-price|sharedPriceUsd|displayPriceUsd|dasPriceUsd/.test(s);

  it("the top-up (its price bound and its source list), the planting, the plant run and the leash never read it", () => {
    for (const rel of ["lib/topup.ts", "lib/planting.ts", "lib/plant-run.ts", "lib/leash.ts", "lib/pyth.ts", "app/api/topup/build/route.ts", "app/api/cron/plant/route.ts"]) {
      expect(usesDisplay(src(rel)), rel).toBe(false);
    }
    // The bound is computed from Jupiter's pricesUsd, read in the build itself.
    expect(src("lib/topup.ts")).toMatch(/import \{[^}]*\bpricesUsd\b[^}]*\} from "\.\/jupiter"/);
    expect(src("lib/topup.ts")).toMatch(/price = \(await pricesUsd\(\[inputMint\]\)\)\[inputMint\]\?\.usdPrice;/);
  });
  it("only the display and sizing readers import the DAS price", () => {
    const users = files(root).filter((p) => usesDisplay(readFileSync(p, "utf8"))).map((p) => path.relative(root, p)).sort();
    expect(users).toEqual([
      "app/api/activity/route.ts", "app/api/me/preview/route.ts", "app/api/me/route.ts", "app/api/me/usdc/route.ts",
      "app/api/webhooks/helius/route.ts", "app/api/withdraw/build/route.ts", "lib/das-price.ts", "lib/shared-reads.ts", "lib/swap-check.ts",
    ]);
  });
});
