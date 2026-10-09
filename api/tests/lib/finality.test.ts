import { describe, it, expect } from "vitest";
import { pollFinalized, type SigStatus } from "@/lib/finality";

const fin: SigStatus = { confirmationStatus: "finalized", err: null };
const conf: SigStatus = { confirmationStatus: "confirmed", err: null };

/** A fake clock that the fake sleep advances, so the poll loop runs without waiting. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe("pollFinalized (R499)", () => {
  it("true at once when every signature is finalized", async () => {
    let calls = 0;
    expect(await pollFinalized({ sigs: ["a", "b"], waitMs: 30_000, statuses: async () => { calls++; return [fin, fin]; }, ...clock() })).toBe(true);
    expect(calls).toBe(1);
  });

  it("waits through confirmed and unseen statuses until finalized", async () => {
    const answers: SigStatus[][] = [[conf, null], [fin, conf], [fin, fin]];
    let i = 0;
    expect(await pollFinalized({ sigs: ["a", "b"], waitMs: 30_000, statuses: async () => answers[Math.min(i++, 2)], ...clock() })).toBe(true);
    expect(i).toBe(3);
  });

  it("false when the wait runs out", async () => {
    let calls = 0;
    expect(await pollFinalized({ sigs: ["a"], waitMs: 5_000, statuses: async () => { calls++; return [conf]; }, ...clock() })).toBe(false);
    expect(calls).toBeLessThanOrEqual(3);
  });

  it("false for a finalized transaction that failed: a row pointing at it is wrong", async () => {
    expect(await pollFinalized({ sigs: ["a"], waitMs: 30_000, statuses: async () => [{ confirmationStatus: "finalized", err: { InstructionError: [0, "Custom"] } }], ...clock() })).toBe(false);
  });

  it("false when the node answers fewer statuses than signatures", async () => {
    expect(await pollFinalized({ sigs: ["a", "b"], waitMs: 0, statuses: async () => [fin], ...clock() })).toBe(false);
  });

  it("a zero wait asks once", async () => {
    let calls = 0;
    expect(await pollFinalized({ sigs: ["a"], waitMs: 0, statuses: async () => { calls++; return [conf]; }, ...clock() })).toBe(false);
    expect(calls).toBe(1);
  });
});
