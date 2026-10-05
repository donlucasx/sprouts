import { describe, it, expect, vi, afterEach } from "vitest";
import { getJson } from "@/lib/venues/rates";

describe("getJson", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects a hung host once its 10 s timeout signal fires, instead of waiting forever", async () => {
    // Node's real AbortSignal.timeout ignores fake timers, so the signal is replaced by one the test fires; the asked-for length is asserted.
    const ctl = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(ctl.signal);
    // A fetch that never answers but honours its abort signal, like the real one.
    vi.stubGlobal("fetch", (_url: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason))));
    const p = getJson("https://example.test/x");
    const assertion = expect(p).rejects.toBeDefined();
    ctl.abort(new Error("timed out"));
    await assertion;
    expect(timeout).toHaveBeenCalledWith(10_000);
    vi.unstubAllGlobals();
  });
});
