import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { SKR_ONLY } from "@/domain/coins";
import { GET as activity } from "@/app/api/activity/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";

describe("GET /api/activity splits (spec 3.2)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  });

  it("lists the manager's changes, yours and undos, newest first, from the events", async () => {
    const to = { ...SKR_ONLY, SKR: 45, hSOL: 20, JitoSOL: 15, JupSOL: 10, cbBTC: 10 };
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "split_changed", detail: { by: "you", from: SKR_ONLY, to, stop: "balanced", managed: true, day: "2026-10-02" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "split_changed", detail: { by: "manager", from: to, to: { ...to, hSOL: 25, cbBTC: 5 }, stop: "balanced", why: "hSOL grew the most.", fallback: null, day: "2026-10-03" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "split_undone", detail: { from: { ...to, hSOL: 25, cbBTC: 5 }, to, day: "2026-10-03" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: "W", kind: "pull_failed", detail: null });
    const res = await activity(new Request("http://x/api/activity", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { splits: { by: string; why: string | null; to: { hSOL: number } }[] };
    expect(body.splits.map((s) => s.by)).toEqual(["undo", "manager", "you"]);
    expect(body.splits[1].why).toBe("hSOL grew the most.");
    expect(body.splits[0].to.hSOL).toBe(20);
  });
});
