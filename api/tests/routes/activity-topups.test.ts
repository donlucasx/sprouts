import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { GET as activity } from "@/app/api/activity/route";
import { settleTopUps, SETTLE_MAX } from "@/lib/topup-record";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));
/** The chain's answer per signature; anything not listed has not landed. */
const { landed, asked, calls } = vi.hoisted(() => ({ landed: new Map<string, "confirmed" | "failed">(), asked: [] as string[], calls: { n: 0 } }));
vi.mock("@/lib/planting", async (orig) => ({
  ...(await orig<typeof import("@/lib/planting")>()),
  signatureStatuses: vi.fn(async (sigs: string[]) => { if (sigs.length) calls.n++; asked.push(...sigs); return sigs.map((s) => landed.get(s) ?? "pending"); }),
}));

// 10-27 (his rulings: top-ups show in Activity; Kimi F4 "address this fix asap": a top-up that landed after its confirm poll gave up).
describe("GET /api/activity top-ups", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    landed.clear();
    asked.length = 0;
    calls.n = 0;
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  });
  const get = async () => (await activity(new Request("http://x/api/activity", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }))).json() as Promise<{ topUps: { ts: string; signature: string; usdcRaw: string }[] }>;
  const sent = (signature: string, usdcRaw = "5000000") => repo.addEvent({ userPubkey: U, walletPubkey: U, kind: "topup_sent", detail: { signature, usdcRaw } });

  it("serves each landed top-up at the time it was sent, and skips a malformed row", async () => {
    await sent("a");
    await repo.addEvent({ userPubkey: U, walletPubkey: U, kind: "topped_up", detail: { signature: "a", usdcRaw: "5000000", sentAt: "2026-10-27T20:00:00.000Z" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: U, kind: "topped_up", detail: { signature: "b", usdcRaw: "five" } });
    expect((await get()).topUps).toEqual([{ ts: "2026-10-27T20:00:00.000Z", signature: "a", usdcRaw: "5000000" }]);
    expect(asked).toEqual([]); // a mark that already has its row is not asked again
  });

  it("gives a late-landing top-up its row on the next load, and leaves one still unknown or failed without a row", async () => {
    await sent("late", "10000000");
    await sent("never");
    await sent("failed");
    landed.set("late", "confirmed").set("failed", "failed");
    expect((await get()).topUps.map((t) => [t.signature, t.usdcRaw])).toEqual([["late", "10000000"]]);
    expect(asked.sort()).toEqual(["failed", "late", "never"]);
    expect(calls.n).toBe(1); // every open mark in one RPC call
    asked.length = 0;
    await get();
    expect(asked.sort()).toEqual(["failed", "never"]); // settled once; the others are asked again while they are recent
  });

  it("asks at most SETTLE_MAX marks a load and none older than a week", async () => {
    for (let i = 0; i < SETTLE_MAX + 2; i++) await sent(`s${i}`);
    await settleTopUps(repo, U);
    expect(asked.length).toBe(SETTLE_MAX);
    asked.length = 0;
    await settleTopUps(repo, U, new Date(Date.now() + 8 * 86_400_000));
    expect(asked).toEqual([]);
  });

  it("a failed top-up read leaves the rest of Activity answering, with no top-ups", async () => {
    const list = repo.listEvents.bind(repo);
    repo.listEvents = async (user, kinds, limit) => { if (kinds.includes("topup_sent")) throw new Error("db down"); return list(user, kinds, limit); };
    expect((await get()).topUps).toEqual([]);
  });

  it("a chain read that throws leaves that mark for the next load and still lists the rest", async () => {
    await sent("a");
    await repo.addEvent({ userPubkey: U, walletPubkey: U, kind: "topped_up", detail: { signature: "a", usdcRaw: "5000000", sentAt: "2026-10-27T20:00:00.000Z" } });
    await sent("boom");
    const { signatureStatuses } = await import("@/lib/planting");
    vi.mocked(signatureStatuses).mockRejectedValueOnce(new Error("rpc down"));
    expect((await get()).topUps.map((t) => t.signature)).toEqual(["a"]);
  });

  it("two rows for one signature (racing writers) show once, and the list is newest first by when each was sent", async () => {
    const row = (signature: string, sentAt: string) => repo.addEvent({ userPubkey: U, walletPubkey: U, kind: "topped_up", detail: { signature, usdcRaw: "5000000", sentAt } });
    await row("new", "2026-10-27T21:00:00.000Z");
    await row("old", "2026-10-20T21:00:00.000Z");
    await row("new", "2026-10-27T21:00:00.000Z");
    await row("mid", "2026-10-25T21:00:00.000Z");
    expect((await get()).topUps.map((t) => t.signature)).toEqual(["new", "mid", "old"]);
  });
});
