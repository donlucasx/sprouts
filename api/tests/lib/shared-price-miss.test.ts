import { describe, it, expect, vi, afterEach } from "vitest";

// 11-23 (Kimi day review item 1): a missing price is kept 10 s, a real one PRICE_CACHE_TTL_MS (11-28); a miss is not re-read on every load.
const priceUsd = vi.fn();
vi.mock("@/lib/jupiter", () => ({ priceUsd: (m: string) => priceUsd(m) }));

describe("sharedPriceUsd keeps a miss briefly", () => {
  afterEach(() => { vi.useRealTimers(); priceUsd.mockReset(); });
  it("a null is reused for 10 s, then read again; a price is reused past that", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T19:00:00Z"));
    const { sharedPriceUsd, SHARED_PRICE_MISS_TTL_MS } = await import("@/lib/shared-reads");
    expect(SHARED_PRICE_MISS_TTL_MS).toBe(10_000);
    priceUsd.mockResolvedValueOnce(null).mockResolvedValueOnce(73.5);
    expect(await sharedPriceUsd("MISS1")).toBeNull();
    vi.setSystemTime(new Date("2026-11-23T19:00:05Z"));
    expect(await sharedPriceUsd("MISS1")).toBeNull();
    expect(priceUsd).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-11-23T19:00:11Z"));
    expect(await sharedPriceUsd("MISS1")).toBe(73.5);
    expect(priceUsd).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2026-11-23T19:00:50Z"));
    expect(await sharedPriceUsd("MISS1")).toBe(73.5);
    expect(priceUsd).toHaveBeenCalledTimes(2);
    // 11-28: a price lives PRICE_CACHE_TTL_MS (45 s; it was 120 s), then it is read again.
    priceUsd.mockResolvedValueOnce(74);
    vi.setSystemTime(new Date("2026-11-23T19:00:57Z"));
    expect(await sharedPriceUsd("MISS1")).toBe(74);
    expect(priceUsd).toHaveBeenCalledTimes(3);
  });
});
