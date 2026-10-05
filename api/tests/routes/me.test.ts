import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { SKR_ONLY } from "@/domain/coins";

const SP = 1_146_000_000n;
/** A real 44-character key: the routes validate the session pubkey as an address before reading the chain. */
const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/staking", () => ({
  readPosition: vi.fn(async () => ({ shares: 1_000_000_000n, stakedRaw: 1_146_000_000n, unstakingRaw: 0n, unstakeTs: null })),
  sharePrice: vi.fn(async () => SP),
}));
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));
vi.mock("@/lib/store", () => ({ storeBalanceRaw: vi.fn(async () => 0n), storeRedeemRate: vi.fn(async () => 1_048_350_000n) }));
vi.mock("@/lib/holdings", async (orig) => ({ ...(await orig<object>()), readHoldings: vi.fn(async () => ({})), readLendingPositions: vi.fn(async () => []) }));
vi.mock("@/lib/leash", async (orig) => ({ ...(await orig<object>()), readLeashConfig: vi.fn(async () => { throw new Error("not deployed"); }) }));
vi.mock("@/lib/subscriptions", () => ({ readDelegation: vi.fn(async () => ({ exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n })) }));

import { storeBalanceRaw, storeRedeemRate } from "@/lib/store";
import { GET as me } from "@/app/api/me/route";
import { GET as activity } from "@/app/api/activity/route";
import { POST as water } from "@/app/api/water/route";
import { POST as signout } from "@/app/api/auth/signout/route";
import { POST as signoutAll } from "@/app/api/auth/signout-all/route";

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("GET /api/me", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: "lucas.skr" });
    await repo.setJoinedPosition(U, { shares: 0n, sharePrice: SP });
    await repo.addWallet({ pubkey: "W", userPubkey: U, delegationPda: "D", dailyCapCents: 500 });
    const p = await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", signature: "sig", usdcPulledCents: 23, networkFeeCents: 3, status: "confirmed", aiLine: null },
      [{ asset: "SKR", usdcInCents: 20, amountOutRaw: 1_100_000_000n, staked: true, feeAmountRaw: 5_500_000n, feeCents: 0, rateAtPlanting: null, venue: null }]);
    await repo.setPlantingShares(p.id, { before: 0n, after: 1_000_000_000n, minted: 1_000_000_000n });
    await repo.insertSwap({ signature: "s1", walletPubkey: "W", ts: new Date(), inMint: "a", inAmount: 1, outMint: "b", outAmount: 1, usdSizeCents: 80, class: "major", roundupCents: 20 });
  });

  it("answers the pot, the history, the next planting and the last receipt for the signed-in Seeker", async () => {
    const res = await me(new Request("http://x/api/me", bearer(await issueSession(U, "M"))));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.skrName).toBe("lucas.skr");
    expect(body.pot.skrStakedRaw).toBe("1146000000");
    expect(body.pot.skrPutInRaw).toBe("1100000000");
    expect(body.pot.skrEarnedRaw).toBe("46000000");
    expect(body.pot.fruit).toBe(4); // 46 SKR earned on 1,100 put in is 418 bps: the first fruit at 25 bps, then one per 100 [A4]
    expect(body.history.plantings.length).toBe(1);
    expect(body.nextPlanting).toEqual({ pendingCents: 20, thresholdCents: 200, capLeftCents: 500, asset: "SKR" });
    expect(body.lastReceipt.usdcPulledCents).toBe(23);
    expect(body.basket).toBeNull();
    expect(body.wallets[0].status).toBe("active");
  });

  // Plan v2 (audits/ore-plan, finding 2): the stORE rate read fails today; Home must not fail with it.
  it("answers with a null stORE rate when the rate read fails, instead of failing the request", async () => {
    await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", signature: "sig2", usdcPulledCents: 23, networkFeeCents: 3, status: "confirmed", aiLine: null },
      [{ asset: "stORE", usdcInCents: 20, amountOutRaw: 24_000_000_000n, staked: false, feeAmountRaw: 120_000_000n, feeCents: 0, rateAtPlanting: null, venue: null }]);
    vi.mocked(storeRedeemRate).mockRejectedValueOnce(new Error("Invalid param: not a Token account"));
    const res = await me(new Request("http://x/api/me", bearer(await issueSession(U, "M"))));
    expect(res.status).toBe(200);
    expect((await res.json()).pot.storeRedeemRate).toBeNull();
  });

  // Plan v2 item 6: the coin the next planting buys, so the forming bud sits on the right plant.
  it("names the coin the next planting buys", async () => {
    let body = await (await me(new Request("http://x/api/me", bearer(await issueSession(U, "M"))))).json();
    expect(body.nextPlanting.asset).toBe("SKR");
    await repo.saveRules(U, { allocation: { ...SKR_ONLY, SKR: 50, stORE: 50 } });
    await repo.bumpLedger("W", "SKR", 200);
    body = await (await me(new Request("http://x/api/me", bearer(await issueSession(U, "M"))))).json();
    expect(body.nextPlanting.asset).toBe("stORE");
  });

  // Review I2 [A24]: a cooldown the wallet started (found by the reconciliation, or at join) is the basket too.
  it("shows a wallet-side cooldown as the basket", async () => {
    await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "wallet", unstakeSignature: null, sharesUnstaked: 40_139_616n, amountRaw: 46_000_000n, principalRaw: 0n });
    const body = await (await me(new Request("http://x/api/me", bearer(await issueSession(U, "M"))))).json();
    expect(body.basket).not.toBeNull();
    expect(body.basket.amountRaw).toBe("46000000");
  });

  // R159: stORE sold from the wallet app takes its share of the basis; nothing in Sprouts moves it.
  it("stORE's put in follows what is still held: half the planted amount when half is left, the planted amount when more is held", async () => {
    await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", signature: "sig-ore", usdcPulledCents: 203, networkFeeCents: 3, status: "confirmed", aiLine: null },
      [{ asset: "stORE", usdcInCents: 200, amountOutRaw: 2_000_000_000n, staked: false, feeAmountRaw: 0n, feeCents: 1, rateAtPlanting: 1.0, venue: null }]);
    vi.mocked(storeBalanceRaw).mockResolvedValueOnce(1_000_000_000n);
    let body = await (await me(new Request("http://x/api/me", bearer(await issueSession(U, "M"))))).json();
    expect(body.pot.storeRaw).toBe("1000000000");
    expect(body.pot.storePutInRaw).toBe("1000000000");
    vi.mocked(storeBalanceRaw).mockResolvedValueOnce(3_000_000_000n);
    body = await (await me(new Request("http://x/api/me", bearer(await issueSession(U, "M"))))).json();
    expect(body.pot.storePutInRaw).toBe("2000000000");
  });

  it("requires a session", async () => {
    expect((await me(new Request("http://x/api/me"))).status).toBe(401);
  });

  it("GET /api/activity lists the swaps, plantings and withdrawals, newest first", async () => {
    const res = await activity(new Request("http://x/api/activity", bearer(await issueSession(U, "M"))));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.swaps.length).toBe(1);
    expect(body.swaps[0].roundupCents).toBe(20);
    expect(body.plantings.length).toBe(1);
    expect(body.withdrawals).toEqual([]);
  });

  it("POST /api/water records the reveal and /api/me carries it", async () => {
    const token = await issueSession(U, "M");
    const res = await water(new Request("http://x/api/water", { method: "POST", ...bearer(token) }));
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).wateredAt).toBe("string");
    const after = await (await me(new Request("http://x/api/me", bearer(token)))).json();
    expect(after.user.wateredAt).not.toBeNull();
  });

  // R84: sign-out ends the session at once; sign out everywhere ends every device's.
  it("POST /api/auth/signout ends this session; the next call is 401", async () => {
    const token = await issueSession(U, "M");
    expect((await signout(new Request("http://x/api/auth/signout", { method: "POST", ...bearer(token) }))).status).toBe(200);
    expect((await me(new Request("http://x/api/me", bearer(token)))).status).toBe(401);
  });

  it("POST /api/auth/signout-all ends the other device's session too", async () => {
    const phone = await issueSession(U, "M");
    const other = await issueSession(U, "M2");
    expect((await signoutAll(new Request("http://x/api/auth/signout-all", { method: "POST", ...bearer(phone) }))).status).toBe(200);
    expect((await me(new Request("http://x/api/me", bearer(other)))).status).toBe(401);
  });
});
