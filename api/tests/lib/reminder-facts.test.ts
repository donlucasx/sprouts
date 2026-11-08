import { describe, it, expect } from "vitest";
import { reminderFactsFor } from "@/lib/reminder-facts";
import type { EventRow, EventKind, UserRow, WalletRow } from "@/db/types";
import type { Repo } from "@/db/repo";

const U = "USERPUBKEY";
const now = new Date("2026-11-08T12:00:00Z");
const h = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000);
const user = { seedVaultPubkey: U, createdAt: h(100) } as UserRow;
const wallet = (pubkey: string, status: WalletRow["status"], over: Partial<WalletRow> = {}) =>
  ({ pubkey, userPubkey: U, status, linkModel: "leash", createdAt: h(50), ...over }) as WalletRow;
let id = 0;
const ev = (kind: EventKind, hoursAgo: number, walletPubkey: string | null = null, detail: unknown = null): EventRow =>
  ({ id: ++id, userPubkey: U, walletPubkey, ts: h(hoursAgo), kind, detail });
/** A repo that answers listEvents newest first, as the real ones do. */
const repoOf = (events: EventRow[], swaps: { ts: Date }[] = []) => {
  const calls = { listEvents: 0 };
  const repo = {
    listEvents: async (_u: string, kinds: EventKind[], limit: number) => { calls.listEvents++; return events.filter((e) => kinds.includes(e.kind)).sort((a, b) => b.ts.getTime() - a.ts.getTime()).slice(0, limit); },
    listSwaps: async () => swaps,
  } as unknown as Repo;
  return { repo, calls };
};

describe("reminderFactsFor", () => {
  it("one listEvents call; counts wallets and finds the first active link and the last swap", async () => {
    const { repo, calls } = repoOf([], [{ ts: h(5) }]);
    const f = await reminderFactsFor(repo, user, [wallet("A", "active", { createdAt: h(30) }), wallet("B", "active", { createdAt: h(60) }), wallet("C", "revoked")], now);
    expect(calls.listEvents).toBe(1);
    expect(f.walletsEver).toBe(3);
    expect(f.activeWallets).toBe(2);
    expect(f.firstActiveLinkAt).toEqual(h(60));
    expect(f.lastSwapAt).toEqual(h(5));
    expect(f.signedUpAt).toEqual(user.createdAt);
    expect(f.now).toBe(now);
  });

  it("a paused wallet whose newest pause event is resumed is not in pausedNoUsdcSince; one whose newest is paused_no_usdc is", async () => {
    const events = [ev("paused_no_usdc", 90, "A"), ev("resumed", 80, "A"), ev("paused_no_usdc", 70, "B"), ev("paused_no_usdc", 40, "B")];
    const { repo } = repoOf(events);
    const f = await reminderFactsFor(repo, user, [wallet("A", "paused"), wallet("B", "paused")], now);
    expect(f.pausedNoUsdcSince).toEqual([{ wallet: "B", since: h(40) }]);
  });

  it("a user pause is not a no-USDC pause", async () => {
    const { repo } = repoOf([ev("paused_no_usdc", 90, "A"), ev("paused_by_user", 80, "A")]);
    expect((await reminderFactsFor(repo, user, [wallet("A", "paused")], now)).pausedNoUsdcSince).toEqual([]);
  });

  it("stoppedSince: a revoked leash wallet Sprouts stopped, since its newest revoke_seen; a user revoke is not", async () => {
    const events = [ev("revoke_seen", 60, "A", { by: "token_revoke" }), ev("revoke_seen", 30, "A", null), ev("revoke_seen", 20, "B", { by: "user" })];
    const { repo } = repoOf(events);
    const f = await reminderFactsFor(repo, user, [wallet("A", "revoked"), wallet("B", "revoked"), wallet("P", "revoked", { linkModel: "puller" })], now);
    expect(f.stoppedSince).toEqual([{ wallet: "A", since: h(30) }]);
  });

  it("lastLinkAttemptAfterFail: a link_started newer than the newest link_failed", async () => {
    const failed = repoOf([ev("link_failed", 30), ev("link_failed", 40)]);
    const f1 = await reminderFactsFor(failed.repo, user, [], now);
    expect(f1.lastLinkFailAt).toEqual(h(30));
    expect(f1.lastLinkAttemptAfterFail).toBe(false);
    const retried = repoOf([ev("link_failed", 30), ev("link_started", 20)]);
    expect((await reminderFactsFor(retried.repo, user, [], now)).lastLinkAttemptAfterFail).toBe(true);
    const older = repoOf([ev("link_started", 40), ev("link_failed", 30)]);
    expect((await reminderFactsFor(older.repo, user, [], now)).lastLinkAttemptAfterFail).toBe(false);
    const linked = repoOf([ev("link_failed", 30), ev("wallet_linked", 10, "A")]);
    expect((await reminderFactsFor(linked.repo, user, [], now)).lastLinkAttemptAfterFail).toBe(true);
  });

  it("no link_failed: lastLinkFailAt null", async () => {
    const f = await reminderFactsFor(repoOf([]).repo, user, [], now);
    expect(f.lastLinkFailAt).toBeNull();
    expect(f.lastLinkAttemptAfterFail).toBe(false);
  });
});
