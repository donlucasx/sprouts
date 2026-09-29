import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

const SP = 1_146_000_000n;
/** A real 44-character key: the routes validate the session pubkey as an address before reading the chain. */
const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/staking", () => ({
  readPosition: vi.fn(async () => ({ shares: 1_000_000_000n, stakedRaw: 1_146_000_000n, unstakingRaw: 0n, unstakeTs: null })),
  sharePrice: vi.fn(async () => SP),
}));
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));
vi.mock("@/lib/store", () => ({ storeBalanceRaw: vi.fn(async () => 0n), storeRedeemRate: vi.fn(async () => 1_048_350_000n) }));

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
      [{ asset: "SKR", usdcInCents: 20, amountOutRaw: 1_100_000_000n, staked: true, feeAmountRaw: 5_500_000n }]);
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
    expect(body.nextPlanting).toEqual({ pendingCents: 20, thresholdCents: 200, capLeftCents: 500 });
    expect(body.lastReceipt.usdcPulledCents).toBe(23);
    expect(body.basket).toBeNull();
    expect(body.wallets[0].status).toBe("active");
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
