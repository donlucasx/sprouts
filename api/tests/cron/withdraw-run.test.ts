import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { runWithdrawCrank } from "@/lib/withdraw-run";

const NOW = new Date("2026-09-29T14:00:00Z");
const H = 3_600_000;

describe("runWithdrawCrank", () => {
  it("cranks only withdrawals past 48 hours and marks them done", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("old", { id: "old", userPubkey: "U1", asset: "SKR", unstakeTs: new Date(NOW.getTime() - 49 * H), unstakeSignature: "u1", withdrawSignature: null, amountOutRaw: null, rewardDeltaRaw: null });
    repo.withdrawals.set("new", { id: "new", userPubkey: "U2", asset: "SKR", unstakeTs: new Date(NOW.getTime() - 1 * H), unstakeSignature: "u2", withdrawSignature: null, amountOutRaw: null, rewardDeltaRaw: null });
    const cranked: string[] = [];
    const r = await runWithdrawCrank({
      repo, now: NOW,
      chain: { readPosition: async () => ({ shares: 0n, stakedRaw: 0n, unstakingRaw: 4_800_000n, unstakeTs: 1n }), crankWithdraw: async (user) => { cranked.push(user); return "wsig"; } },
    });
    expect(r.cranked).toEqual(["old"]);
    expect(cranked).toEqual(["U1"]);
    expect(repo.withdrawals.get("old")!.withdrawSignature).toBe("wsig");
    expect(repo.withdrawals.get("old")!.amountOutRaw).toBe(4_800_000n);
    expect(repo.withdrawals.get("new")!.withdrawSignature).toBeNull();
  });

  it("a failed crank is recorded and the rest continue", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", { id: "a", userPubkey: "U1", asset: "SKR", unstakeTs: new Date(NOW.getTime() - 49 * H), unstakeSignature: "u1", withdrawSignature: null, amountOutRaw: null, rewardDeltaRaw: null });
    repo.withdrawals.set("b", { id: "b", userPubkey: "U2", asset: "SKR", unstakeTs: new Date(NOW.getTime() - 50 * H), unstakeSignature: "u2", withdrawSignature: null, amountOutRaw: null, rewardDeltaRaw: null });
    const r = await runWithdrawCrank({
      repo, now: NOW,
      chain: { readPosition: async () => ({ shares: 0n, stakedRaw: 0n, unstakingRaw: 1n, unstakeTs: 1n }), crankWithdraw: async (user) => { if (user === "U1") throw new Error("boom"); return "ok"; } },
    });
    expect(r.cranked).toEqual(["b"]);
    expect(r.failed).toEqual(["a"]);
    expect(repo.events.some((e) => e.kind === "pull_failed")).toBe(true);
  });
});
