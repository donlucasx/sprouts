import { describe, it, expect, vi } from "vitest";
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

  it("the chain's clock decides: a row whose cooldown has not passed on chain is not cranked", async () => {
    // The row says 49 hours, the program's own unstake timestamp says one hour: the user cancelled and unstaked again from the wallet.
    // 11-14 (ops #6): that row's own cooldown is gone (one slot per position), so it closes as superseded; the new cooldown waits.
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", row({ id: "a", userPubkey: "U1", hoursAgo: 49 }));
    let cranks = 0;
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainWith(1n, 1, async () => { cranks++; return "x"; }) });
    expect(cranks).toBe(0);
    expect(r.cranked).toEqual([]);
    expect(r.skipped).toEqual(["a"]);
    expect(repo.withdrawals.get("a")!.withdrawSignature).toBeNull();
  });

  // 11-13: the 429 retry can stretch a run; the crank starts no new withdrawal past the run's deadline (the route's 300 s kill).
  it("past the deadline: starts none (no chain call, no event) and reports every due row as deferred", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", row({ id: "a", userPubkey: "U1", hoursAgo: 49 }));
    repo.withdrawals.set("b", row({ id: "b", userPubkey: "U2", hoursAgo: 50 }));
    let reads = 0;
    const cranked: string[] = [];
    const chain = { ...chainWith(1n, 50, async (user) => { cranked.push(user); return "sig"; }), readPosition: async () => { reads++; return chainWith(1n, 50, async () => "x").readPosition(); } };
    const r = await runWithdrawCrank({ repo, now: NOW, chain, deadlineMs: Date.now() - 1 });
    expect(r).toEqual({ cranked: [], failed: [], skipped: [], deferred: ["a", "b"] });
    expect(reads).toBe(0);
    expect(cranked).toEqual([]);
    expect(repo.events).toEqual([]);
    expect(repo.withdrawals.get("a")!.withdrawSignature).toBeNull();
  });

  it("the deadline passing mid-run: the started withdrawal finishes, the rest are deferred", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", row({ id: "a", userPubkey: "U1", hoursAgo: 49 }));
    repo.withdrawals.set("b", row({ id: "b", userPubkey: "U2", hoursAgo: 50 }));
    const t0 = Date.now();
    let clock = t0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const chain = chainWith(1n, 50, async () => { clock = t0 + 10_000; return "sig"; });   // the first crank uses up the time
    const r = await runWithdrawCrank({ repo, now: NOW, chain, deadlineMs: t0 + 5_000 }).finally(() => spy.mockRestore());
    expect(r.cranked).toHaveLength(1);
    expect(r.deferred).toHaveLength(1);
    expect([...r.cranked, ...r.deferred].sort()).toEqual(["a", "b"]);
  });

  it("before the deadline: unchanged, nothing deferred", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", row({ id: "a", userPubkey: "U1", hoursAgo: 49 }));
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainWith(1n, 50, async () => "sig"), deadlineMs: Date.now() + 60_000 });
    expect(r).toEqual({ cranked: ["a"], failed: [], skipped: [], deferred: [] });
  });
});

// 11-14 (ops #6): one cooldown slot per position, so only the row whose cooldown is the chain's live one can be delivered. Every
// older open row of that user is closed as skipped ("superseded"), the chain is read once per user, and the delivery is booked on
// the live row, never on whichever due row came first.
describe("runWithdrawCrank: superseded rows (ops #6)", () => {
  const MIN = 60_000;
  /** A row opened at an exact time (ms before NOW), any source. */
  const at = (id: string, msAgo: number, over: Partial<WithdrawalRow> = {}) => row({ id, userPubkey: "U1", hoursAgo: msAgo / H, source: "wallet", unstakeSignature: null, ...over });
  const chainAtMs = (unstakingRaw: bigint, msAgo: number, crank: (user: string) => Promise<string> = async () => "wsig") => ({
    readPosition: async () => ({ shares: 0n, stakedRaw: 0n, unstakingRaw, unstakeTs: sec(new Date(NOW.getTime() - msAgo)) }),
    crankWithdraw: crank,
  });
  const reasons = (repo: MemoryRepo) => repo.events.filter((e) => e.kind === "withdraw_skipped").map((e) => e.detail as { withdrawal: string; reason?: string });

  it("3 open wallet rows, the chain's cooldown newer than all but the last: 2 closed superseded, the live one kept, nothing cranked", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("r1", at("r1", 120 * H));
    repo.withdrawals.set("r2", at("r2", 72 * H));
    repo.withdrawals.set("r3", at("r3", 20 * H));   // the reconcile booked the 30-hour-old wallet unstake 10 hours later
    let reads = 0, cranks = 0;
    const chain = chainAtMs(280_000_000n, 30 * H, async () => { cranks++; return "x"; });
    const r = await runWithdrawCrank({ repo, now: NOW, chain: { ...chain, readPosition: async (u: string) => { reads++; return chain.readPosition(); } } });
    expect(reads).toBe(1);   // once per user, not once per due row
    expect(cranks).toBe(0);
    expect(r.skipped.sort()).toEqual(["r1", "r2"]);
    expect(r.cranked).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(repo.withdrawals.get("r1")!.skippedAt).not.toBeNull();
    expect(repo.withdrawals.get("r2")!.skippedAt).not.toBeNull();
    expect(repo.withdrawals.get("r3")!.skippedAt).toBeNull();
    expect(repo.withdrawals.get("r1")!.cancelSignature).toBeNull();   // skipped, never cancelled: the pot still counts the pick
    expect(reasons(repo).sort((a, b) => a.withdrawal.localeCompare(b.withdrawal))).toEqual([{ withdrawal: "r1", reason: "superseded" }, { withdrawal: "r2", reason: "superseded" }]);
  });

  it("the same with the cooldown past 48 hours: the live row is cranked and booked, even though its own row clock is not due", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("r1", at("r1", 120 * H));
    repo.withdrawals.set("r2", at("r2", 72 * H));
    repo.withdrawals.set("r3", at("r3", 40 * H));
    const cranked: string[] = [];
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainAtMs(280_000_000n, 50 * H, async (u) => { cranked.push(u); return "wsig"; }) });
    expect(cranked).toEqual(["U1"]);
    expect(r.cranked).toEqual(["r3"]);
    expect(r.skipped.sort()).toEqual(["r1", "r2"]);
    expect(repo.withdrawals.get("r3")!.withdrawSignature).toBe("wsig");
    expect(repo.withdrawals.get("r3")!.amountOutRaw).toBe(280_000_000n);
    expect(repo.withdrawals.get("r1")!.withdrawSignature).toBeNull();
    expect(repo.withdrawals.size).toBe(3);   // a live row exists: no row is added
  });

  it("a Sprouts row confirmed 3 s after its unstake is the live one (kept); so is one 3 s before it (clock skew)", async () => {
    for (const offset of [3_000, -3_000]) {
      const repo = new MemoryRepo();
      repo.withdrawals.set("s", at("s", 49 * H - offset, { source: "sprouts", unstakeSignature: "u" }));
      const r = await runWithdrawCrank({ repo, now: NOW, chain: chainAtMs(5n, 49 * H) });
      expect(r.skipped).toEqual([]);
      expect(r.cranked).toEqual(["s"]);
    }
  });

  it("the 5-minute slack: a row 4 minutes older than the chain's cooldown is live, one 6 minutes older is superseded", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("old6", at("old6", 49 * H + 6 * MIN));
    repo.withdrawals.set("old4", at("old4", 49 * H + 4 * MIN));
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainAtMs(5n, 49 * H) });
    expect(r.skipped).toEqual(["old6"]);
    expect(r.cranked).toEqual(["old4"]);
    expect(repo.withdrawals.get("old4")!.skippedAt).toBeNull();
  });

  it("superseded closing never touches the row whose cooldown is the live one, while the cooldown runs or after", async () => {
    for (const chainAgo of [10 * H, 49 * H]) {
      const repo = new MemoryRepo();
      repo.withdrawals.set("dead", at("dead", 100 * H));
      repo.withdrawals.set("live", at("live", chainAgo - 3 * H));   // the reconcile's row, written hours after the wallet unstake
      await runWithdrawCrank({ repo, now: NOW, chain: chainAtMs(7n, chainAgo) });
      expect(repo.withdrawals.get("live")!.skippedAt).toBeNull();
      expect(repo.withdrawals.get("live")!.cancelSignature).toBeNull();
      expect(repo.withdrawals.get("dead")!.skippedAt).not.toBeNull();
    }
  });

  it("closes every open row of the user, due or not; other users are untouched", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("due", at("due", 60 * H));
    repo.withdrawals.set("young", at("young", 20 * H));   // not due by its own clock, but older than the chain's cooldown
    repo.withdrawals.set("other", row({ id: "other", userPubkey: "U2", hoursAgo: 20 }));
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainAtMs(7n, 10 * H) });
    expect(r.skipped.sort()).toEqual(["due", "young"]);
    expect(repo.withdrawals.get("other")!.skippedAt).toBeNull();
  });

  it("nothing unstaking on chain: the user's due rows are skipped as before (no superseded reason), one read", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", at("a", 60 * H));
    repo.withdrawals.set("b", at("b", 50 * H));
    let reads = 0;
    const chain = chainAtMs(0n, 50 * H);
    const r = await runWithdrawCrank({ repo, now: NOW, chain: { ...chain, readPosition: async () => { reads++; return chain.readPosition(); } } });
    expect(reads).toBe(1);
    expect(r.skipped.sort()).toEqual(["a", "b"]);
    expect(reasons(repo).every((d) => d.reason === undefined)).toBe(true);
  });

  it("past the deadline: a user's rows are all deferred and none is closed", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", at("a", 120 * H));
    repo.withdrawals.set("b", at("b", 60 * H));
    let reads = 0;
    const chain = chainAtMs(7n, 50 * H);
    const r = await runWithdrawCrank({ repo, now: NOW, deadlineMs: Date.now() - 1, chain: { ...chain, readPosition: async () => { reads++; return chain.readPosition(); } } });
    expect(r.deferred.sort()).toEqual(["a", "b"]);
    expect(r.skipped).toEqual([]);
    expect(reads).toBe(0);
    expect(repo.withdrawals.get("a")!.skippedAt).toBeNull();
  });

  // Fix E: a cooldown no open row covers (3Jqt 11-12: unstake and restake netted to zero, so the reconcile booked nothing).
  it("a matured cooldown with no live row: exactly one wallet row (amount = unstaking, shares 0, principal 0) is added and cranked", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("stale", at("stale", 100 * H));
    const r = await runWithdrawCrank({ repo, now: NOW, chain: chainAtMs(50_000_000_000n, 49 * H) });
    expect(r.skipped).toEqual(["stale"]);
    const added = [...repo.withdrawals.values()].filter((w) => w.id !== "stale");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ userPubkey: "U1", source: "wallet", unstakeSignature: null, sharesUnstaked: 0n, principalRaw: 0n, amountRaw: 50_000_000_000n, withdrawSignature: "wsig", amountOutRaw: 50_000_000_000n });
    expect(r.cranked).toEqual([added[0].id]);
  });

  it("E is idempotent: a crank that fails leaves its one added row, and a second run adds none", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("stale", at("stale", 100 * H));
    const boom = async () => { throw new Error("429"); };
    const r1 = await runWithdrawCrank({ repo, now: NOW, chain: chainAtMs(9n, 49 * H, boom) });
    expect(r1.failed).toHaveLength(1);
    // The next day: the added row is the live one (its own clock is the day before, so it is due by the 48 h rule only later;
    // push it to due here so the second run visits the user and must see it as covering).
    const added = [...repo.withdrawals.values()].find((w) => w.id !== "stale")!;
    added.unstakeTs = new Date(NOW.getTime() - 48 * H);
    const r2 = await runWithdrawCrank({ repo, now: new Date(NOW.getTime() + 24 * H), chain: chainAtMs(9n, 49 * H, boom) });   // the same cooldown, a day older
    expect(r2.failed).toEqual([added.id]);
    expect(repo.withdrawals.size).toBe(2);
  });

  it("a cooldown not yet matured with no live row: no row is added by the crank (the reconcile books it)", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("stale", at("stale", 100 * H));
    await runWithdrawCrank({ repo, now: NOW, chain: chainAtMs(9n, 10 * H) });
    expect(repo.withdrawals.size).toBe(1);
  });

  // Fix C: the tx was sent; a done-write that changes no row is not a failure (throw-after-write): logged and alerted.
  it("a done-write that changes no row after the withdraw was sent: not failed, the founder is alerted, no withdraw_failed", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", at("a", 49 * H));
    const alerts: string[] = [];
    const r = await runWithdrawCrank({
      repo, now: NOW, alert: async (c) => { alerts.push(c.title); },
      chain: chainAtMs(5n, 49 * H, async () => { await repo.setWithdrawalCancelled("a", "raced"); return "wsig"; }),
    });
    expect(r.failed).toEqual([]);
    expect(alerts).toHaveLength(1);
    expect(repo.events.some((e) => e.kind === "withdraw_failed")).toBe(false);
    expect(repo.withdrawals.get("a")!.withdrawSignature).toBeNull();
    expect(repo.withdrawals.get("a")!.cancelSignature).toBe("raced");
  });

  it("a done-write that throws after the withdraw was sent: not failed either, alerted", async () => {
    const repo = new MemoryRepo();
    repo.withdrawals.set("a", at("a", 49 * H));
    repo.setWithdrawalDone = async () => { throw new Error("db down"); };
    const alerts: string[] = [];
    const r = await runWithdrawCrank({ repo, now: NOW, alert: async (c) => { alerts.push(c.title); }, chain: chainAtMs(5n, 49 * H) });
    expect(r.failed).toEqual([]);
    expect(alerts).toHaveLength(1);
    expect(repo.events.some((e) => e.kind === "withdraw_failed")).toBe(false);
  });
});
