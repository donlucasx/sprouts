import { describe, it, expect, vi, afterEach } from "vitest";
import { cached, MEMO_MAX_ENTRIES } from "@/lib/memo";

// Task 7 review: a ttl that depends on the value (a negative answer kept minutes, not a day), and a capped memo (keys carry mints).
describe("cached", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps each answer as long as its own ttl says", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const read = vi.fn(async (v: string | null) => v);
    const ttl = (v: string | null) => (v === null ? 10 * 60_000 : 60 * 60_000);
    await cached("yes", () => read("x"), () => true, ttl);
    await cached("no", () => read(null), () => true, ttl);
    vi.advanceTimersByTime(11 * 60_000);
    await cached("yes", () => read("x"), () => true, ttl);
    await cached("no", () => read(null), () => true, ttl);
    expect(read.mock.calls.map((c) => c[0])).toEqual(["x", null, null]); // the negative read again, the positive kept
    vi.advanceTimersByTime(50 * 60_000);
    await cached("yes", () => read("x"), () => true, ttl);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("holds at most MEMO_MAX_ENTRIES keys, the oldest dropped first", async () => {
    const read = vi.fn(async (k: number) => k);
    for (let k = 0; k <= MEMO_MAX_ENTRIES; k++) await cached(`k${k}`, () => read(k));
    expect(read).toHaveBeenCalledTimes(MEMO_MAX_ENTRIES + 1);
    await cached(`k${MEMO_MAX_ENTRIES}`, () => read(-1)); // the newest is still there
    await cached("k1", () => read(-1)); // the second oldest too
    expect(read).toHaveBeenCalledTimes(MEMO_MAX_ENTRIES + 1);
    await cached("k0", () => read(-1)); // the oldest was dropped
    expect(read).toHaveBeenCalledTimes(MEMO_MAX_ENTRIES + 2);
  });
});
