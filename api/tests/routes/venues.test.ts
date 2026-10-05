import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { dayOf } from "@/domain/day";
import { GET as venues } from "@/app/api/venues/route";

const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
describe("GET /api/venues (contracts 5.1)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    const day = dayOf(new Date());
    for (const [venue, pct] of [["kamino_klend", 4.43], ["jupiter_lend", 4.19]] as const) {
      await repo.putVenueDay({ day, venue, asset: "USDC_LEND", supplyPct: pct, rewardsPct: venue === "jupiter_lend" ? 0.36 : 0, utilizationPct: 90, withdrawableUsd: 1e7, tvlUsd: 1.2e8, exchangeRate: 1.2, avg7Pct: pct, daysMeasured: 2, eligible: true, verdict: venue === "jupiter_lend" ? "avoid" : "ok", reason: venue === "jupiter_lend" ? "incentive_spike" : null, served: null, ok: true });
    }
    await repo.putVenueDay({ day, venue: "marginfi", asset: "USDC_LEND", supplyPct: null, rewardsPct: null, utilizationPct: null, withdrawableUsd: null, tvlUsd: null, exchangeRate: null, avg7Pct: null, daysMeasured: 0, eligible: false, verdict: null, reason: null, served: null, ok: false });
    await repo.putSplitDay({ day, stop: "balanced", split: { SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 }, modelAnswer: null, why: "Your USDC goes to Kamino, 4.4% vs Jupiter 4.2%.", fallback: null, callId: null, venuePick: { USDC_LEND: "kamino_klend", SOL_LEND: null } });
    await repo.putFoundVenues([{ day, poolId: "p1", project: "kamino-lend", symbol: "SOL", asset: "SOL", apyBasePct: 5.64, tvlUsd: 2.5e7, note: "Kamino SOL pool at 5.6% a year." }]);
  });
  const get = async () => venues(new Request("http://x/api/venues", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }));
  it("answers the table, the user's stop's picks and why, and the found venues", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.picks).toEqual({ USDC_LEND: "kamino_klend", SOL_LEND: null });
    expect(body.why).toBe("Your USDC goes to Kamino, 4.4% vs Jupiter 4.2%.");
    expect(body.venues.find((v: { venue: string }) => v.venue === "kamino_klend")).toMatchObject({ name: "Kamino", auto: true, picked: true, verdict: "ok", supplyPct: 4.43 });
    expect(body.venues.find((v: { venue: string }) => v.venue === "jupiter_lend")).toMatchObject({ picked: false, verdict: "avoid", reason: "incentive_spike", rewardsPct: 0.36 });
    expect(body.venues.find((v: { venue: string }) => v.venue === "marginfi")).toMatchObject({ auto: false, note: "rate unavailable", supplyPct: null });
    expect(body.found).toEqual([{ day: body.day, project: "kamino-lend", symbol: "SOL", asset: "SOL", apyBasePct: 5.64, tvlUsd: 2.5e7, note: "Kamino SOL pool at 5.6% a year." }]);
  });
  it("every row carries exactly the contracts 5.1 VenueRow keys; marginfi USDC is listed even with no row", async () => {
    const body = await (await get()).json();
    const keys = ["venue", "asset", "name", "auto", "supplyPct", "rewardsPct", "avg7Pct", "daysMeasured", "utilizationPct", "tvlUsd", "withdrawableUsd", "eligible", "verdict", "reason", "picked", "note"].sort();
    for (const v of body.venues) expect(Object.keys(v).sort()).toEqual(keys);
    expect(Object.keys(body).sort()).toEqual(["day", "found", "picks", "venues", "why"]);
    const empty = new MemoryRepo();
    setRepoForTests(empty);
    await empty.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    const none = await (await get()).json();
    expect(none.venues).toEqual([expect.objectContaining({ venue: "marginfi", asset: "USDC_LEND", note: "rate unavailable", picked: false })]);
    expect(none).toMatchObject({ picks: {}, why: null, found: [] });
  });
  it("no row today: each venue's newest row of the last 7 days, and its day", async () => {
    const fresh = new MemoryRepo();
    setRepoForTests(fresh);
    await fresh.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    const { addDays } = await import("@/domain/day");
    const y = addDays(dayOf(new Date()), -1);
    await fresh.putVenueDay({ day: y, venue: "kamino_klend", asset: "SOL_LEND", supplyPct: 5.1, rewardsPct: 0, utilizationPct: 80, withdrawableUsd: 1e7, tvlUsd: 1e8, exchangeRate: 1100, avg7Pct: 5, daysMeasured: 3, eligible: true, verdict: "ok", reason: null, served: null, ok: true });
    const body = await (await get()).json();
    expect(body.day).toBe(y);
    expect(body.venues.find((v: { venue: string }) => v.venue === "kamino_klend")).toMatchObject({ asset: "SOL_LEND", supplyPct: 5.1 });
  });
  it("a venue that failed today shows its newest row of the last 7 days beside today's rows (M1)", async () => {
    const { addDays } = await import("@/domain/day");
    await repo.putVenueDay({ day: addDays(dayOf(new Date()), -1), venue: "kamino_klend", asset: "SOL_LEND", supplyPct: 5.1, rewardsPct: 0, utilizationPct: 80, withdrawableUsd: 1e7, tvlUsd: 1e8, exchangeRate: 1100, avg7Pct: 5, daysMeasured: 3, eligible: true, verdict: "ok", reason: null, served: null, ok: true });
    const body = await (await get()).json();
    expect(body.day).toBe(dayOf(new Date()));
    expect(body.venues.filter((v: { venue: string }) => v.venue === "kamino_klend").map((v: { asset: string; supplyPct: number }) => [v.asset, v.supplyPct])).toEqual([["USDC_LEND", 4.43], ["SOL_LEND", 5.1]]);
  });
  it("401 without a session", async () => {
    expect((await venues(new Request("http://x/api/venues"))).status).toBe(401);
  });
});
