import { describe, it, expect, vi } from "vitest";
import { cached, clearSharedReads } from "@/lib/memo";
import { retryOncePrice, WEBHOOK_PRICE_TIMEOUT_MS, WEBHOOK_PRICE_RETRY_MS } from "@/lib/webhook-price";

const noSleep = async () => {};

describe("retryOncePrice", () => {
  it("uses the documented bounds", () => {
    expect(WEBHOOK_PRICE_TIMEOUT_MS).toBe(800);
    expect(WEBHOOK_PRICE_RETRY_MS).toBe(300);
  });

  it("a first null then a price: the price, two reads, one wait of the retry delay", async () => {
    const read = vi.fn<(m: string) => Promise<number | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(150);
    const sleep = vi.fn(noSleep);
    expect(await retryOncePrice(read, { sleep })("M")).toBe(150);
    expect(read).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(300);
  });

  it("a first throw then a price: the price", async () => {
    const read = vi.fn<(m: string) => Promise<number | null>>().mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce(150);
    expect(await retryOncePrice(read, { sleep: noSleep })("M")).toBe(150);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("a first price: one read", async () => {
    const read = vi.fn(async () => 150 as number | null);
    expect(await retryOncePrice(read, { sleep: noSleep })("M")).toBe(150);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("two nulls: null after two reads", async () => {
    const read = vi.fn(async () => null as number | null);
    expect(await retryOncePrice(read, { sleep: noSleep })("M")).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("a read that never resolves: null after both bounds", async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(() => new Promise<number | null>(() => {}));
      let out: number | null | undefined;
      const p = retryOncePrice(read)("M").then((v) => { out = v; });
      await vi.advanceTimersByTimeAsync(799);
      expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2 + 300);
      expect(read).toHaveBeenCalledTimes(2);
      expect(out).toBeUndefined();
      await vi.advanceTimersByTimeAsync(800);
      await p;
      expect(out).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("over a memoized read whose first call hangs, the retry reads fresh (retryRead) and can succeed; without it the retry joins the hung promise", async () => {
    vi.useFakeTimers();
    try {
      clearSharedReads();
      const raw = vi.fn<(m: string) => Promise<number | null>>()
        .mockImplementationOnce(() => new Promise<number | null>(() => {}))
        .mockResolvedValue(150);
      const memoed = (m: string) => cached(`p|${m}`, () => raw(m), (v) => v !== null);
      const fresh = vi.fn(async () => 150 as number | null);
      const p = retryOncePrice(memoed, { retryRead: fresh })("M");
      await vi.advanceTimersByTimeAsync(800 + 300 + 1);
      expect(await p).toBe(150);
      expect(fresh).toHaveBeenCalledTimes(1);
      expect(raw).toHaveBeenCalledTimes(1);
      // Without retryRead the retry gets the same pending promise: no second request, null.
      clearSharedReads();
      raw.mockReset();
      raw.mockImplementationOnce(() => new Promise<number | null>(() => {})).mockResolvedValue(150);
      const q = retryOncePrice(memoed)("M");
      await vi.advanceTimersByTimeAsync(800 + 300 + 800 + 1);
      expect(await q).toBeNull();
      expect(raw).toHaveBeenCalledTimes(1);
    } finally {
      clearSharedReads();
      vi.useRealTimers();
    }
  });
});
