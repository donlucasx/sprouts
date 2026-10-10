import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { dayOf } from "@/domain/day";
import { GET as activity } from "@/app/api/activity/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));

describe("GET /api/activity, lending (contracts 5.7)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  });
  const get = async () => (await activity(new Request("http://x/api/activity", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }))).json();

  it("legs name the venue with receipt and underlying units; retired legs stay listed", async () => {
    const base = { userPubkey: U, walletPubkey: "W", usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed" as const, aiLine: null };
    await repo.insertPlanting({ ...base, signature: "s1" }, [{ asset: "USDC_LEND", venue: "kamino_klend", usdcInCents: 200, amountOutRaw: 1_661_072n, staked: false, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: 1.2038 }]);
    await repo.insertPlanting({ ...base, signature: "s0", ts: new Date("2026-09-01T00:00:00Z") }, [{ asset: "JitoSOL", venue: null, usdcInCents: 200, amountOutRaw: 1n, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: null }]);
    const body = await get();
    const legs = body.plantings.map((p: { legs: unknown[] }) => p.legs[0]);
    expect(legs).toEqual([
      expect.objectContaining({ asset: "USDC_LEND", venue: "kamino_klend", amountOutRaw: "1661072", receiptOutRaw: "1661072", underlyingOutRaw: "1999598" }),
      expect.objectContaining({ asset: "JitoSOL", venue: null, receiptOutRaw: null, underlyingOutRaw: null }),
    ]);
  });
  it("R583 at the route (s6 review C8): a legacy planting's leg reads what was pulled (the 3c fee added back); a new one is untouched", async () => {
    const leg = { asset: "USDC_LEND" as const, venue: "kamino_klend" as const, amountOutRaw: 1n, staked: false, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: 1 };
    await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed", aiLine: null, signature: "legacy", ts: new Date("2026-10-05T00:00:00Z") }, [{ ...leg, usdcInCents: 200 }]);
    await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", usdcPulledCents: 150, networkFeeCents: 0, status: "confirmed", aiLine: null, signature: "new" }, [{ ...leg, usdcInCents: 150 }]);
    const body = await get();
    const bySig = Object.fromEntries(body.plantings.map((p: { signature: string; legs: { usdcInCents: number }[] }) => [p.signature, p.legs[0]!.usdcInCents]));
    expect(bySig).toEqual({ legacy: 203, new: 150 });
  });
  it("R359: a lend_withdrawn row carries whole (false for a part) when the event recorded it, and no key when it did not", async () => {
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "lend_withdrawn", detail: { asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: "5", underlyingRaw: "6", signature: "p1", whole: false } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "lend_withdrawn", detail: { asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: "5", underlyingRaw: "6", signature: "p0" } });
    const res = await activity(new Request("http://x/api/activity", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }));
    const rows = (await res.json()).lendWithdrawals as { signature: string; whole?: boolean }[];
    expect(rows.find((r) => r.signature === "p1")?.whole).toBe(false);
    expect("whole" in rows.find((r) => r.signature === "p0")!).toBe(false);
  });
  it("lendWithdrawals carry underlyingRaw (null when the event has none); moves; found", async () => {
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "lend_withdrawn", detail: { asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "1661072", underlyingRaw: "2001591", signature: "w1" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "lend_withdrawn", detail: { asset: "SOL_LEND", venue: "jupiter_lend", receiptRaw: "940800", signature: "w0" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "move_done", detail: { asset: "USDC_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: "1661072" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "terms_accepted", detail: { version: "2026-10-06" } });
    await repo.putFoundVenues([{ day: dayOf(new Date()), poolId: "p1", project: "kamino-lend", symbol: "SOL", asset: "SOL", apyBasePct: 5.64, tvlUsd: 2.5e7, note: null }]);
    const body = await get();
    const byS = Object.fromEntries(body.lendWithdrawals.map((w: { signature: string }) => [w.signature, w]));
    expect(byS.w1).toEqual({ ts: expect.any(String), asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "1661072", underlyingRaw: "2001591", signature: "w1" });
    expect(byS.w0.underlyingRaw).toBeNull();
    expect(body.moves).toEqual([{ ts: expect.any(String), asset: "USDC_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: "1661072", status: "done" }]);
    expect(body.found).toEqual([{ day: dayOf(new Date()), project: "kamino-lend", symbol: "SOL", asset: "SOL", apyBasePct: 5.64, tvlUsd: 2.5e7, note: null }]);
  });
  it("malformed lend and move events are skipped; a status outside MoveStatus reads from the event kind (M4)", async () => {
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "lend_withdrawn", detail: { asset: "JitoSOL", venue: "kamino_klend", receiptRaw: "1", signature: "bad-asset" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "lend_withdrawn", detail: { asset: "USDC_LEND", venue: "marginfi", receiptRaw: "1", signature: "bad-venue" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "lend_withdrawn", detail: { asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "1.5", signature: "bad-raw" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "lend_withdrawn", detail: null });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "lend_withdrawn", detail: { asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "7", underlyingRaw: "x", signature: "ok" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "move_dismissed", detail: { asset: "USDC_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: "1", status: "hacked" } });
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "move_done", detail: { asset: "USDC_LEND", from: "kamino_klend", to: "nowhere" } });
    const body = await get();
    expect(body.lendWithdrawals).toEqual([{ ts: expect.any(String), asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "7", underlyingRaw: null, signature: "ok" }]);
    expect(body.moves).toEqual([{ ts: expect.any(String), asset: "USDC_LEND", from: "kamino_klend", to: "jupiter_lend", receiptRaw: "1", status: "dismissed" }]);
  });
});
