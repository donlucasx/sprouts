import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { SKR_ONLY } from "@/domain/coins";
import { GET as activity } from "@/app/api/activity/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));

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
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "split_changed", detail: { by: "you", from: to, to, stop: "balanced", managed: true, managedWas: false, day: "2026-10-04" } });
    const res = await activity(new Request("http://x/api/activity", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { splits: { by: string; why: string | null; to: { hSOL: number }; managed: boolean | null; turnedOn: boolean }[] };
    expect(body.splits.map((s) => s.by)).toEqual(["you", "undo", "manager", "you"]);
    expect(body.splits[2].why).toBe("hSOL grew the most.");
    expect(body.splits[1].to.hSOL).toBe(20);
    // The split event carries the switch (spec 3.2 "you: Balanced, on."): turnedOn only when that save moved it off to on.
    expect(body.splits.map((s) => [s.managed, s.turnedOn])).toEqual([[true, true], [null, false], [null, false], [true, false]]);
  });

  it("serves each planting leg's dollar price: SKR from the SKR price, the others from that day's coin row, null without one (R140)", async () => {
    const ts = new Date("2026-10-02T14:00:00Z");
    await repo.putCoinDay({ day: "2026-10-02", asset: "hSOL", rate: 1.2, ratePrev: null, ratePrevDays: null, priceUsd: 168, liquidityUsd: 1e8, priceChange24h: 0, tradeable: true, lastUpdateEpoch: 1047, ok: true });
    const base = { userPubkey: U, walletPubkey: "W", usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed" as const, aiLine: null, ts };
    const leg = { usdcInCents: 200, amountOutRaw: 1_000_000_000n, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: null };
    await repo.insertPlanting({ ...base, signature: "s1" }, [{ ...leg, asset: "hSOL", staked: false }]);
    await repo.insertPlanting({ ...base, signature: "s2" }, [{ ...leg, asset: "SKR", staked: true }]);
    await repo.insertPlanting({ ...base, signature: "s3" }, [{ ...leg, asset: "cbBTC", staked: false }]);
    const res = await activity(new Request("http://x/api/activity", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }));
    const body = (await res.json()) as { plantings: { legs: { asset: string; usdPrice: number | null }[] }[] };
    const price = Object.fromEntries(body.plantings.map((p) => [p.legs[0].asset, p.legs[0].usdPrice]));
    expect(price).toEqual({ hSOL: 168, SKR: 0.0183, cbBTC: null });
  });

  it("serves each planting leg's USDC fee in cents (spec 7.4)", async () => {
    await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", signature: "sig", usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed", aiLine: null },
      [{ asset: "hSOL", usdcInCents: 200, amountOutRaw: 1_000_000_000n, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: 1.18 }]);
    const res = await activity(new Request("http://x/api/activity", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }));
    const body = (await res.json()) as { plantings: { legs: { asset: string; feeCents: number; feeAmountRaw: string }[] }[] };
    expect(body.plantings[0].legs[0].feeCents).toBe(1);
    expect(body.plantings[0].legs[0].feeAmountRaw).toBe("0");
  });
});
