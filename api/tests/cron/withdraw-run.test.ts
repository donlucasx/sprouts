import { describe, it, expect } from "vitest";
import { MemoryRepo } from "@/db/memory";
import type { WithdrawalRow } from "@/db/types";
import { runWithdrawCrank } from "@/lib/withdraw-run";

const NOW = new Date("2026-09-29T14:00:00Z");
const H = 3_600_000;
const sec = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));

function row(over: Partial<WithdrawalRow> & { id: string; userPubkey: string; hoursAgo: number }): WithdrawalRow {
  const { hoursAgo, ...rest } = over;
  return {
    asset: "SKR", unstakeTs: new Date(NOW.getTime() - hoursAgo * H), unstakeSignature: "u", withdrawSignature: null, amountOutRaw: null, rewardDeltaRaw: null,
    cancelSignature: null, sharesUnstaked: 1n, amountRaw: 1n, principalRaw: 0n, source: "sprouts", skippedAt: null, ...rest,
  };
}
/** The chain agrees with the row: the unstake happened `hoursAgo` hours before NOW. */
const chainWith = (unstakingRaw: bigint, hoursAgo: number, crank: (user: string) => Promise<string>) => ({
  readPosition: async () => ({ shares: 0n, stakedRaw: 0n, unstakingRaw, unstakeTs: sec(new Date(NOW.getTime() - hoursAgo * H)) }),
  crankWithdraw: crank,
});

describe("runWithdrawCrank", () => {
  it("cranks only withdrawals past 48 hours and marks them done", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("old", row({ id: "old", userPubkey: "U1", hoursAgo: 49 }));
    repo.withdrawals.set("new", row({ id: "new", userPubkey: "U2", hoursAgo: 1 }));
    const cranked: string[] = [];
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainWith(4_800_000n, 49, async (user) => { cranked.push(user); return "wsig"; }) });
    expect(r.cranked).toEqual(["old"]);
    expect(cranked).toEqual(["U1"]);
    expect(repo.withdrawals.get("old")!.withdrawSignature).toBe("wsig");
    expect(repo.withdrawals.get("old")!.amountOutRaw).toBe(4_800_000n);
    expect(repo.withdrawals.get("new")!.withdrawSignature).toBeNull();
  });

  it("a failed crank is recorded and the rest continue", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", row({ id: "a", userPubkey: "U1", hoursAgo: 49 }));
    repo.withdrawals.set("b", row({ id: "b", userPubkey: "U2", hoursAgo: 50 }));
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainWith(1n, 50, async (user) => { if (user === "U1") throw new Error("boom"); return "ok"; }) });
    expect(r.cranked).toEqual(["b"]);
    expect(r.failed).toEqual(["a"]);
    expect(repo.events.some((e) => e.kind === "withdraw_failed")).toBe(true);
  });

  // [A11] a cancel the app did not see, or a wallet-side withdrawal the user already took: nothing to crank, the row is closed.
  it("a row with nothing unstaking on chain is closed, not cranked", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", row({ id: "a", userPubkey: "U1", hoursAgo: 49 }));
    let cranks = 0;
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainWith(0n, 49, async () => { cranks++; return "x"; }) });
    expect(cranks).toBe(0);
    expect(r.cranked).toEqual([]);
    expect(r.skipped).toEqual(["a"]);
    expect(repo.withdrawals.get("a")!.skippedAt).not.toBeNull();
    expect(repo.events.some((e) => e.kind === "withdraw_skipped")).toBe(true);
    expect((await repo.dueWithdrawals(NOW)).length).toBe(0);
  });

  it("a cancelled row is never due", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", row({ id: "a", userPubkey: "U1", hoursAgo: 49, cancelSignature: "c" }));
    let cranks = 0;
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainWith(1n, 49, async () => { cranks++; return "x"; }) });
    expect(cranks).toBe(0);
    expect(r.cranked).toEqual([]);
  });

  it("the chain's clock decides: a row whose cooldown has not passed on chain waits for the next run", async () => {
    // The row says 49 hours, the program's own unstake timestamp says one hour: the user cancelled and unstaked again from the wallet.
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", row({ id: "a", userPubkey: "U1", hoursAgo: 49 }));
    let cranks = 0;
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainWith(1n, 1, async () => { cranks++; return "x"; }) });
    expect(cranks).toBe(0);
    expect(r.cranked).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(repo.withdrawals.get("a")!.skippedAt).toBeNull();
  });
});
