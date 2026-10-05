import { describe, expect, it } from "vitest";
import { coalesce } from "../../src/lib/coalesce";

describe("coalesce", () => {
  it("runs once for calls that overlap and hands each the same result", async () => {
    let calls = 0;
    let release!: (v: number) => void;
    const run = coalesce(() => { calls++; return new Promise<number>((r) => { release = r; }); });
    const a = run(), b = run(), c = run();
    release(7);
    expect(await Promise.all([a, b, c])).toEqual([7, 7, 7]);
    expect(calls).toBe(1);
  });

  it("runs again once the previous run has settled", async () => {
    let calls = 0;
    const run = coalesce(async () => ++calls);
    expect(await run()).toBe(1);
    expect(await run()).toBe(2);
  });

  it("runs again after a failed run", async () => {
    let calls = 0;
    const run = coalesce(async () => { calls++; if (calls === 1) throw new Error("x"); return calls; });
    await expect(run()).rejects.toThrow("x");
    expect(await run()).toBe(2);
  });
});
