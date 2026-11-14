import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { reconcileOwnStakes } from "@/lib/reconcile";
import { runWithdrawCrank } from "@/lib/withdraw-run";
import { potInputs, potFromInputs, countedPicks, absorbedPickIds } from "@/lib/pot";
import type { Position } from "@/lib/staking";
import { GET as exportTax } from "@/app/api/export/tax/route";

/**
 * 11-14 (review of 962d66c): the pick count and the tax export after the staking program's one cooldown slot replaced an earlier
 * cooldown. Every scenario drives the real reconcile and crank on the in-memory repo, so the rows are the ones production writes.
 */
const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
const SP = 1_146_000_000n;   // 1 share = 1.146 SKR
const H = 3_600_000;
const MINTED = 1_000_000_000n;
let R = 0;   // the test's "now", real clock: rows the repo writes are stamped with it
const secAgo = (ms: number) => BigInt(Math.floor((R - ms) / 1000));
const position = (shares: bigint, unstakingRaw: bigint, msAgo: number): Position => ({ shares, stakedRaw: 0n, unstakingRaw, unstakeTs: unstakingRaw ? secAgo(msAgo) : null });

let repo: MemoryRepo;
beforeEach(async () => {
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
  R = Date.now();
  repo = new MemoryRepo();
  setRepoForTests(repo);
  await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
  await repo.setJoinedPosition(U, { shares: 0n, sharePrice: SP });
  // One SKR planting: 1,146 SKR in, 1,000,000,000 shares minted
  const p = await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", signature: "sigPlant", usdcPulledCents: 1000, networkFeeCents: 0, status: "confirmed", aiLine: null },
    [{ asset: "SKR", venue: null, usdcInCents: 1000, amountOutRaw: 1_146_000_000n, staked: true, feeAmountRaw: 0n, feeCents: 5, rateAtPlanting: null }]);
  await repo.setPlantingShares(p.id, { before: 0n, after: MINTED, minted: MINTED });
});

const reconcile = (pos: Position) => reconcileOwnStakes({ repo, now: new Date(R), chain: { readPosition: async () => pos, sharePrice: async () => SP, finalized: async () => true } });
const crank = (pos: Position, sig: string, nowMs = R + 49 * H) => runWithdrawCrank({ repo, now: new Date(nowMs), chain: { readPosition: async () => pos, crankWithdraw: async () => sig }, alert: async () => {} });
/** A Sprouts unstake confirmed `msAgo` before now: shares burned, amount fixed at unstake, principal the part above earned. */
async function sproutsRow(msAgo: number, o: { shares?: bigint; amountRaw?: bigint; principalRaw?: bigint; sig?: string } = {}) {
  const w = await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "sprouts", unstakeSignature: o.sig ?? "sigS", sharesUnstaked: o.shares ?? 100_000_000n, amountRaw: o.amountRaw ?? 114_600_000n, principalRaw: o.principalRaw ?? 50_000_000n });
  repo.withdrawals.get(w.id)!.unstakeTs = new Date(R - msAgo);
  return w.id;
}
const backdate = (id: string, msAgo: number) => { repo.withdrawals.get(id)!.unstakeTs = new Date(R - msAgo); };
const rows = () => [...repo.withdrawals.values()].sort((a, b) => a.unstakeTs.getTime() - b.unstakeTs.getTime() || a.id.localeCompare(b.id));
const skips = () => repo.events.filter((e) => e.kind === "withdraw_skipped");
const pot = async (pos: Position) => potFromInputs((await repo.getUser(U))!, await potInputs(repo, (await repo.getUser(U))!), { position: pos, sharePrice: SP });
const csvLines = async () => {
  const res = await exportTax(new Request("http://x/api/export/tax", { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }));
  expect(res.status).toBe(200);
  return (await res.text()).trimEnd().split("\r\n").slice(1).map((l) => ({ line: l, hash: l.split(",").at(-1)!, sent: l.split(",")[1], received: l.split(",")[3] }));
};

describe("cancel + re-unstake from the wallet (the same shares): one cooldown, one pick", () => {
  // The user picked 114.6 SKR in Sprouts (S), cancelled from the wallet and unstaked the same shares again: the share count matches
  // the ledger, so the reconcile closes S as superseded and books the uncovered cooldown as a wallet row E (fix E).
  let live: Position;
  beforeEach(() => { live = position(MINTED - 100_000_000n, 114_700_000n, 2 * H); });

  it("picked counts the cooldown once; put in, earned and fruit do not move", async () => {
    await sproutsRow(30 * H);
    await reconcile(live);
    const [s, e] = rows();
    expect(s.skippedAt).not.toBeNull();
    expect(e).toMatchObject({ source: "wallet", sharesUnstaked: 0n, principalRaw: 0n, amountRaw: 114_700_000n });
    const p = await pot(live);
    expect(p.skrPickedRaw).toBe(114_700_000n);                 // was 229,300,000: S and the cooldown that holds S's SKR again
    expect(p.skrPrincipalPickedRaw).toBe(50_000_000n);         // S's principal still lowers put in, exactly as before
    expect(p.skrPutInRaw).toBe(1_146_000_000n - 50_000_000n);
    const inputs = await potInputs(repo, (await repo.getUser(U))!);
    expect(countedPicks(inputs.withdrawals, inputs.skippedEvents).map((w) => w.id)).toEqual([e.id]);
  });

  it("the tax export: S's reward and withdrawal once, carried by the crank's delivery of the live cooldown", async () => {
    await sproutsRow(30 * H);
    await reconcile(live);
    await crank(live, "wsigC");
    const lines = await csvLines();
    const skr = lines.filter((l) => l.hash !== "sigPlant");
    expect(skr.map((l) => l.hash)).toEqual(["sigS", ""]);   // the reward keeps its unstake hash; the inferred delivery is not a TxHash
    expect(skr[1].line).toContain("likely arrived in wsigC..., after a later wallet unstake");
    expect(skr[0].received).toBe("64.60");     // S's earned: 114.6 - 50
    expect(skr[1].sent).toBe("114.60");        // S's own amount; the wallet's part of the delivery is not a Sprouts withdrawal
  });
});

describe("withdraw + re-unstake from the wallet (BZQ7, every 48 h): every unstake is a real pick", () => {
  it("each wallet row stays a pick; nothing is exported (wallet unstakes are not Sprouts withdrawals)", async () => {
    // Day 1: the wallet unstakes 200,000,000 shares
    await reconcile(position(800_000_000n, 229_200_000n, 51 * H));
    const w1 = rows()[0].id;
    backdate(w1, 50 * H);
    // Two days later: the wallet withdrew that cooldown and unstaked 150,000,000 more shares
    const live = position(650_000_000n, 171_900_000n, 2 * H);
    await reconcile(live);
    expect(repo.withdrawals.get(w1)!.skippedAt).not.toBeNull();
    const p = await pot(live);
    expect(p.skrPickedRaw).toBe(229_200_000n + 171_900_000n);
    expect(countedPicks(rows(), skips())).toHaveLength(2);
    await crank(live, "wsigB");
    const lines = await csvLines();
    expect(lines.map((l) => l.hash)).toEqual(["sigPlant"]);
  });
});

describe("a Sprouts pick merged into a later wallet unstake (the cooldown reset): the export keeps S's line", () => {
  it("S's reward and withdrawal are exported with the delivery that carried them; picked is unchanged", async () => {
    await sproutsRow(30 * H);
    // The wallet unstaked 100,000,000 more shares during S's cooldown: one cooldown of both, its clock reset
    const live = position(800_000_000n, 114_600_000n + 114_650_000n, 2 * H);
    await reconcile(live);
    const [s, w] = rows();
    expect(s.skippedAt).not.toBeNull();
    expect(w).toMatchObject({ source: "wallet", amountRaw: 114_600_000n });
    expect((await pot(live)).skrPickedRaw).toBe(229_200_000n);
    await crank(live, "wsigM");
    expect(repo.withdrawals.get(w.id)!.amountOutRaw).toBe(229_250_000n);
    const skr = (await csvLines()).filter((l) => l.hash !== "sigPlant");
    expect(skr.map((l) => l.hash)).toEqual(["sigS", ""]);   // the reward keeps its unstake hash; the inferred delivery is not a TxHash
    expect(skr[1].line).toContain("likely arrived in wsigM..., after a later wallet unstake");
    expect(skr[1].sent).toBe("114.60");
  });

  it("S's cooldown withdrawn by the wallet before a fresh unstake: the crank's delivery holds none of S, so S is not exported (as before)", async () => {
    await sproutsRow(30 * H);
    const live = position(800_000_000n, 114_650_000n, 2 * H);
    await reconcile(live);
    await crank(live, "wsigF");
    expect((await csvLines()).map((l) => l.hash)).toEqual(["sigPlant"]);
  });

  it("a superseded S is attributed to one delivery only, never again to a later one", async () => {
    await sproutsRow(100 * H);
    const first = position(800_000_000n, 229_250_000n, 90 * H);
    await reconcile(first);
    backdate(rows()[1].id, 89 * H);
    await crank(first, "wsig1", R);
    // Later, a fresh wallet unstake and a second crank delivery
    const second = position(700_000_000n, 114_700_000n, 2 * H);
    await reconcile(second);
    await crank(second, "wsig2");
    const skr = (await csvLines()).filter((l) => l.hash !== "sigPlant");
    expect(skr.map((l) => l.hash)).toEqual(["sigS", ""]);   // the reward keeps its unstake hash; the inferred delivery is not a TxHash
    expect(skr[1].line).toContain("likely arrived in wsig1..., after a later wallet unstake");
    expect(skr.map((l) => l.line).join("\n")).not.toContain("wsig2");
  });
});

describe("a plain Sprouts withdrawal: unchanged", () => {
  it("one pick, its reward and withdrawal with its own delivery", async () => {
    await sproutsRow(49 * H);
    const live = position(900_000_000n, 114_600_000n, 49 * H);
    await crank(live, "wsigP", R);
    const p = await pot(position(900_000_000n, 0n, 0));
    expect(p.skrPickedRaw).toBe(114_600_000n);
    expect(countedPicks(rows(), skips())).toHaveLength(1);
    const skr = (await csvLines()).filter((l) => l.hash !== "sigPlant");
    expect(skr.map((l) => l.hash)).toEqual(["sigS", "wsigP"]);
  });
});

describe("an uncovered cooldown row (fix E)", () => {
  it("3Jqt: a stale sign-up row superseded by a smaller cooldown; both stay picks (the cooldown cannot hold the old one)", async () => {
    const signup = await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "wallet", unstakeSignature: null, sharesUnstaked: 0n, amountRaw: 200_000_000_000n, principalRaw: 0n });
    backdate(signup.id, 30 * H);
    const live = position(MINTED, 50_000_000_000n, 20 * H);
    await reconcile(live);
    expect(repo.withdrawals.get(signup.id)!.skippedAt).not.toBeNull();
    expect((await pot(live)).skrPickedRaw).toBe(250_000_000_000n);
    expect(countedPicks(rows(), skips())).toHaveLength(2);
  });

  it("a cooldown no row ever tracked: its row is the pick", async () => {
    const live = position(MINTED, 7_000_000n, 3 * H);
    await reconcile(live);
    expect((await pot(live)).skrPickedRaw).toBe(7_000_000n);
  });

  // The documented trade-off: the chain's one read cannot tell "S cancelled and its shares unstaked again" from "S withdrawn from the
  // wallet, then an unstake and a restake of the same size". A cooldown at least as large as S is read as holding S. The display's
  // picked can then miss S (it never touches put in, earned or fruit), and the export dates S's lines with the later delivery's hash.
  it("trade-off: S withdrawn by the wallet, then an unstake and a same-size restake at least as large as S, reads as S re-taken", async () => {
    await sproutsRow(30 * H);
    const live = position(MINTED - 100_000_000n, 300_000_000n, 2 * H);
    await reconcile(live);
    const p = await pot(live);
    expect(p.skrPickedRaw).toBe(300_000_000n);
    expect(p.skrPutInRaw).toBe(1_146_000_000n - 50_000_000n);
  });
});

// Review fix round (a1919b2)
describe("fix round: orders, sources, missing events, ties", () => {
  it("M2: the crank closes S as superseded while the new cooldown runs, the reconcile books E hours later: still one pick", async () => {
    const s = await sproutsRow(50 * H);                  // due, so the crank visits this user
    const live = position(MINTED - 100_000_000n, 114_700_000n, 6 * H);
    await crank(live, "never", R);                       // not matured: S closed as superseded, no row added
    expect(repo.withdrawals.get(s)!.skippedAt).not.toBeNull();
    expect(repo.withdrawals.size).toBe(1);
    repo.withdrawals.get(s)!.skippedAt = new Date(R - 5 * H);   // that crank ran five hours before the reconcile
    await reconcile(live);
    expect(rows()).toHaveLength(2);
    expect((await pot(live)).skrPickedRaw).toBe(114_700_000n);
    expect(countedPicks(rows(), skips())).toHaveLength(1);
  });

  it("M2 bound: a row booked between S's close and E (it covered the cooldown) keeps S out of E", async () => {
    const s = await sproutsRow(30 * H);
    repo.withdrawals.get(s)!.skippedAt = new Date(R - 20 * H);
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "withdraw_skipped", detail: { withdrawal: s, reason: "superseded" } });
    const w = await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "wallet", unstakeSignature: null, sharesUnstaked: 5n, amountRaw: 1_000_000n, principalRaw: 0n });
    backdate(w.id, 10 * H);
    repo.withdrawals.get(w.id)!.skippedAt = new Date(R - 3 * H);
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "withdraw_skipped", detail: { withdrawal: w.id, reason: "superseded" } });
    const e = await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "wallet", unstakeSignature: null, sharesUnstaked: 0n, amountRaw: 500_000_000n, principalRaw: 0n });
    expect([...absorbedPickIds(rows(), skips())]).toEqual([w.id]);
    expect(countedPicks(rows(), skips()).map((x) => x.id).sort()).toEqual([s, e.id].sort());
  });

  it("no withdraw_skipped events: nothing is absorbed and nothing is carried (the numbers before this fix)", async () => {
    await sproutsRow(30 * H);
    const live = position(MINTED - 100_000_000n, 114_700_000n, 2 * H);
    await reconcile(live);
    repo.events = repo.events.filter((e) => e.kind !== "withdraw_skipped");
    expect((await pot(live)).skrPickedRaw).toBe(229_300_000n);
    await crank(live, "wsigN");
    expect((await csvLines()).map((l) => l.hash)).toEqual(["sigPlant"]);
  });

  it("a skip with nothing unstaking (no 'superseded' reason) is never absorbed", async () => {
    const s = await sproutsRow(30 * H);
    repo.withdrawals.get(s)!.skippedAt = new Date(R - 10 * H);
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "withdraw_skipped", detail: { withdrawal: s } });
    await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "wallet", unstakeSignature: null, sharesUnstaked: 0n, amountRaw: 500_000_000n, principalRaw: 0n });
    expect(absorbedPickIds(rows(), skips()).size).toBe(0);
  });

  it("H1: a delivery booked on a Sprouts row carries no superseded row (its own line already exports all it sent)", async () => {
    const s = await sproutsRow(100 * H);
    repo.withdrawals.get(s)!.skippedAt = new Date(R - 60 * H);
    await repo.addEvent({ userPubkey: U, walletPubkey: null, kind: "withdraw_skipped", detail: { withdrawal: s, reason: "superseded" } });
    const l = await sproutsRow(50 * H, { sig: "sigL" });
    await repo.setWithdrawalDone(l, "wsigL", 229_250_000n);
    const skr = (await csvLines()).filter((x) => x.hash !== "sigPlant");
    expect(skr.map((x) => x.hash)).toEqual(["sigL", "wsigL"]);
    expect(skr[1].sent).toBe("229.25");
  });

  it("equal timestamps: the same rows are absorbed whatever order they are read in (ties broken on id)", async () => {
    const a = await sproutsRow(30 * H, { sig: "sigA" });
    const b = await sproutsRow(30 * H, { sig: "sigB" });
    const live = position(MINTED - 200_000_000n, 114_700_000n, 2 * H);
    await reconcile(live);
    for (const id of [a, b]) repo.withdrawals.get(id)!.skippedAt = repo.withdrawals.get(a)!.skippedAt;
    const forward = absorbedPickIds(rows(), skips());
    const backward = absorbedPickIds([...rows()].reverse(), skips());
    expect(forward.size).toBe(1);   // the cooldown holds one of the two
    expect([...backward]).toEqual([...forward]);
    expect([...forward]).toEqual([[a, b].sort().at(-1)]);   // newest by (time, id) first
    expect((await repo.listWithdrawals(U, 10)).map((w) => w.id)).toEqual((await repo.listWithdrawals(U, 10)).map((w) => w.id));
  });
});
