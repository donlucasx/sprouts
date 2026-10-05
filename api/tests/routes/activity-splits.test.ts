import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { SKR_ONLY } from "@/domain/coins";
import { GET as activity } from "@/app/api/activity/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/jupiter", async () => {
  const { STORE_MINT } = await import("@/lib/constants");
  return { priceUsd: vi.fn(async (mint: string) => (mint === STORE_MINT ? 73 : 0.0183)) };
});

describe("GET /api/activity splits (spec 3.2)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  });

  it("lists the manager's changes, yours and undos, newest first, from the events", async () => {
    const to = { ...SKR_ONLY, SKR: 45, hSOL: 20, USDC_LEND: 15, SOL_LEND: 10, cbBTC: 10 };
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

  it("reads the day prices in parallel: ten plantings on ten days cost one round trip, not ten (review I2)", async () => {
    const base = { userPubkey: U, walletPubkey: "W", usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed" as const, aiLine: null };
    const leg = { asset: "hSOL" as const, usdcInCents: 200, amountOutRaw: 1_000_000_000n, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: null };
    for (let i = 0; i < 10; i++) {
      const day = `2026-09-${String(10 + i).padStart(2, "0")}`;
      await repo.putCoinDay({ day, asset: "hSOL", rate: 1.2, ratePrev: null, ratePrevDays: null, priceUsd: 100 + i, liquidityUsd: 1e8, priceChange24h: 0, tradeable: true, lastUpdateEpoch: 1047, ok: true });
      await repo.insertPlanting({ ...base, signature: `s${i}`, ts: new Date(`${day}T14:00:00Z`) }, [leg]);
    }
    const orig = repo.getCoinDay.bind(repo);
    vi.spyOn(repo, "getCoinDay").mockImplementation(async (day, asset) => { await new Promise((r) => setTimeout(r, 25)); return orig(day, asset); });
    const t0 = Date.now();
    const res = await activity(new Request("http://x/api/activity", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }));
    const elapsed = Date.now() - t0;
    const body = (await res.json()) as { plantings: { legs: { usdPrice: number | null }[] }[] };
    expect(body.plantings.map((p) => p.legs[0].usdPrice).sort((a, b) => (a as number) - (b as number))).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
    expect(elapsed).toBeLessThan(120);                                   // ten reads in series would take 250 ms
  });

  it("a planting from before its coin's first snapshot takes the week's latest price, then the live stORE price, as /api/me prices the receipt (review M3)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const base = { userPubkey: U, walletPubkey: "W", usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed" as const, aiLine: null, ts: twoDaysAgo };
    const leg = { usdcInCents: 200, amountOutRaw: 1_000_000_000n, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: null };
    await repo.putCoinDay({ day: today, asset: "hSOL", rate: 1.2, ratePrev: null, ratePrevDays: null, priceUsd: 168, liquidityUsd: 1e8, priceChange24h: 0, tradeable: true, lastUpdateEpoch: 1047, ok: true });
    await repo.insertPlanting({ ...base, signature: "s1" }, [{ ...leg, asset: "hSOL" }]);    // no row on its day: the week's latest
    await repo.insertPlanting({ ...base, signature: "s2" }, [{ ...leg, asset: "stORE" }]);   // no row at all: the live stORE price
    await repo.insertPlanting({ ...base, signature: "s3" }, [{ ...leg, asset: "cbBTC" }]);   // nothing anywhere: null
    const res = await activity(new Request("http://x/api/activity", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }));
    const body = (await res.json()) as { plantings: { legs: { asset: string; usdPrice: number | null }[] }[] };
    expect(Object.fromEntries(body.plantings.map((p) => [p.legs[0].asset, p.legs[0].usdPrice]))).toEqual({ hSOL: 168, stORE: 73, cbBTC: null });
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
