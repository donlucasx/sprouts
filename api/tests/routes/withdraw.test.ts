import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { generateKeyPairSigner, signTransaction, getBase64EncodedWireTransaction, getBase64Encoder, getTransactionDecoder, getCompiledTransactionMessageDecoder, decompileTransactionMessage, prependTransactionMessageInstructions, compileTransaction, address, type KeyPairSigner } from "@solana/kit";

/** What Phantom does before it signs (2026-09-29): prepends its own priority fee to the transaction the API built. */
function withWalletPriorityFee(b64tx: string) {
  const t = getTransactionDecoder().decode(getBase64Encoder().encode(b64tx));
  const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(t.messageBytes));
  const fee = { programAddress: address("ComputeBudget111111111111111111111111111111"), accounts: [], data: new Uint8Array([3, 0x10, 0x27, 0, 0, 0, 0, 0, 0]) };
  return compileTransaction(prependTransactionMessageInstructions([fee], m));
}

const SP = 1_146_000_000n;
const { positionMock, sendMock, statusMock, validMock } = vi.hoisted(() => ({
  positionMock: vi.fn(), sendMock: vi.fn(async () => "sig"),
  statusMock: vi.fn(async (_sig: string): Promise<"confirmed" | "failed" | "pending"> => "confirmed"),   // the chain's answer for a signature
  validMock: vi.fn(async (_blockhash: string, _config?: unknown) => true),   // isBlockhashValid, with the config it was asked with
}));
vi.mock("@/lib/staking", async (orig) => ({ ...(await orig<object>()), readPosition: (...a: unknown[]) => positionMock(...a), sharePrice: vi.fn(async () => SP) }));
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));
vi.mock("@/lib/planting", () => ({ signatureStatus: (sig: string) => statusMock(sig) }));
// The confirm poll (20 x 1.5 s) asks the chain once here; settleUnconfirmed is the real one, over the mocked rpc and status.
vi.mock("@/lib/user-tx", async (orig) => ({ ...(await orig<object>()), waitConfirmed: (sig: string) => statusMock(sig) }));
vi.mock("@/lib/rpc", () => ({
  rpc: () => ({
    getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
    sendTransaction: () => ({ send: sendMock }),
    isBlockhashValid: (blockhash: string, config?: unknown) => ({ send: async () => ({ value: await validMock(blockhash, config) }) }),
  }),
}));

import { POST as build } from "@/app/api/withdraw/build/route";
import { POST as confirmRoute } from "@/app/api/withdraw/confirm/route";
import { POST as cancelBuild } from "@/app/api/withdraw/cancel/build/route";
import { POST as cancelConfirm } from "@/app/api/withdraw/cancel/confirm/route";

let user: KeyPairSigner;
let U: string;
let auth: Record<string, string>;
const staked = (shares: bigint, unstakingRaw = 0n, unstakeTs: bigint | null = null) => ({ shares, stakedRaw: (shares * SP) / 1_000_000_000n, unstakingRaw, unstakeTs });
const post = (path: string, body: unknown) => new Request(`http://x${path}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
const signAsUser = async (b64: string) => getBase64EncodedWireTransaction(await signTransaction([user.keyPair], getTransactionDecoder().decode(getBase64Encoder().encode(b64))));

beforeAll(async () => {
  user = await generateKeyPairSigner();
  U = user.address;
});

describe("withdraw routes", () => {
  let repo: MemoryRepo;
  /** A user whose one planting put `legRaw` in (minted 2e9 shares); the chain's position is set per test. */
  async function seed(legRaw: bigint) {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    await repo.setJoinedPosition(U, { shares: 0n, sharePrice: SP });
    const p = await repo.insertPlanting({ userPubkey: U, walletPubkey: "W", signature: "s", usdcPulledCents: 23, networkFeeCents: 3, status: "confirmed", aiLine: null },
      [{ asset: "SKR", usdcInCents: 20, amountOutRaw: legRaw, staked: true, feeAmountRaw: 0n, feeCents: 0, rateAtPlanting: null, venue: null }]);
    await repo.setPlantingShares(p.id, { before: 0n, after: 2_000_000_000n, minted: 2_000_000_000n });
    auth = { authorization: `Bearer ${await issueSession(U, "M")}`, "content-type": "application/json" };
  }
  beforeEach(async () => {
    await seed(2_200_000_000n); // 2,292 SKR in the garden at SP against 2,200 put in: 92 SKR earned
    positionMock.mockReset();
    positionMock.mockResolvedValue(staked(2_000_000_000n));
    sendMock.mockReset();
    sendMock.mockResolvedValue("sig");
    statusMock.mockReset();
    statusMock.mockResolvedValue("confirmed");
    validMock.mockReset();
    validMock.mockResolvedValue(true);
  });

  // Device round 3, items 7 and 8 (10-02): he approved in Solflare after the build's blockhash ran out; the send was refused and the
  // route said "check again in a minute" though nothing could ever land.
  describe("a send that has not confirmed (item 8)", () => {
    const signedEarned = async () => signAsUser((await (await build(post("/api/withdraw/build", { mode: "earned" }))).json()).transaction);
    it("an expired blockhash that never landed: 409, it did not go through, nothing recorded", async () => {
      const signed = await signedEarned();
      sendMock.mockRejectedValueOnce(new Error("Blockhash not found"));
      statusMock.mockResolvedValue("pending");
      validMock.mockResolvedValue(false);
      const r = await confirmRoute(post("/api/withdraw/confirm", { signedTransaction: signed }));
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe("It did not go through. Nothing moved. Try again.");
      // the blockhash the transaction carries, asked at CONFIRMED, the commitment it was fetched at (finalized does not know a young one)
      expect(validMock).toHaveBeenCalledWith("GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", { commitment: "confirmed" });
      expect(await repo.pendingWithdrawal(U)).toBeNull();
    });
    it("a blockhash still valid: 409, it may still go through, check Activity before trying again; nothing recorded", async () => {
      const signed = await signedEarned();
      statusMock.mockResolvedValue("pending");
      const r = await confirmRoute(post("/api/withdraw/confirm", { signedTransaction: signed }));
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe("It may still go through. Check Activity in a minute before you try again.");
      expect(validMock).toHaveBeenCalledWith("GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", { commitment: "confirmed" });
      expect(await repo.pendingWithdrawal(U)).toBeNull();
    });
    it("expired and the second ask says failed: the failed-on-chain answer, nothing recorded", async () => {
      const signed = await signedEarned();
      statusMock.mockResolvedValueOnce("pending").mockResolvedValueOnce("failed");
      validMock.mockResolvedValue(false);
      const r = await confirmRoute(post("/api/withdraw/confirm", { signedTransaction: signed }));
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe("The withdrawal failed on chain. Nothing moved.");
      expect(await repo.pendingWithdrawal(U)).toBeNull();
    });
    it("expired but it landed after all (the second ask confirms): the basket is recorded", async () => {
      const signed = await signedEarned();
      statusMock.mockResolvedValueOnce("pending").mockResolvedValueOnce("confirmed");
      validMock.mockResolvedValue(false);
      positionMock.mockResolvedValue(staked(1_919_720_768n, 92_000_000n, 1_790_000_000n));
      const r = await confirmRoute(post("/api/withdraw/confirm", { signedTransaction: signed }));
      expect(r.status).toBe(200);
      expect((await repo.pendingWithdrawal(U))?.sharesUnstaked).toBe(80_279_232n);
    });
    it("put it back: expired says the SKR is still in the basket; still valid says check the basket; the basket stands either way", async () => {
      await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 80_279_232n, amountRaw: 92_000_000n, principalRaw: 0n });
      const signed = await signAsUser((await (await cancelBuild(post("/api/withdraw/cancel/build", {}))).json()).transaction);
      statusMock.mockResolvedValue("pending");
      validMock.mockResolvedValueOnce(false);
      const expired = await cancelConfirm(post("/api/withdraw/cancel/confirm", { signedTransaction: signed }));
      expect(expired.status).toBe(409);
      expect((await expired.json()).error).toBe("It did not go through. Your SKR is still in the basket. Try again.");
      const waiting = await cancelConfirm(post("/api/withdraw/cancel/confirm", { signedTransaction: signed }));
      expect(waiting.status).toBe(409);
      expect((await waiting.json()).error).toBe("It may still go through. Check the basket in a minute before you try again.");
      expect(await repo.pendingWithdrawal(U)).not.toBeNull();
    });
    it("put it back, expired but it landed late (the second ask confirms): the basket is closed as cancelled", async () => {
      await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 80_279_232n, amountRaw: 92_000_000n, principalRaw: 0n });
      const signed = await signAsUser((await (await cancelBuild(post("/api/withdraw/cancel/build", {}))).json()).transaction);
      statusMock.mockResolvedValueOnce("pending").mockResolvedValueOnce("confirmed");
      validMock.mockResolvedValue(false);
      positionMock.mockResolvedValue(staked(2_000_000_000n));
      const r = await cancelConfirm(post("/api/withdraw/cancel/confirm", { signedTransaction: signed }));
      expect(r.status).toBe(200);
      expect(await repo.pendingWithdrawal(U)).toBeNull();
    });
  });

  // Review I2: a cooldown the wallet started is one basket too; the program allows one, so no fingerprint is asked for a second.
  it("refuses a pick while the chain shows a cooldown the ledger does not know, before any signature", async () => {
    positionMock.mockResolvedValue(staked(1_959_860_384n, 46_000_000n, 1_790_000_000n));
    const r = await build(post("/api/withdraw/build", { mode: "earned" }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("One basket at a time");
  });

  it("confirm still reads the unstake when the wallet prepended its own priority fee (Phantom, 2026-09-29)", async () => {
    const b = await (await build(post("/api/withdraw/build", { mode: "earned" }))).json();
    const signed = getBase64EncodedWireTransaction(await signTransaction([user.keyPair], withWalletPriorityFee(b.transaction)));
    positionMock.mockResolvedValue(staked(1_919_720_768n, 92_000_000n, 1_790_000_000n));
    const r = await confirmRoute(post("/api/withdraw/confirm", { signedTransaction: signed }));
    expect(r.status).toBe(200);
    expect((await repo.pendingWithdrawal(U))?.sharesUnstaked).toBe(80_279_232n);
  });

  // Review I3: a send whose answer is lost is not "nothing moved"; the route holds the signature and asks the chain.
  it("confirm records the basket when the send throws but the signature confirms", async () => {
    const b = await (await build(post("/api/withdraw/build", { mode: "earned" }))).json();
    const signed = await signAsUser(b.transaction);
    sendMock.mockRejectedValueOnce(new Error("socket hang up"));
    positionMock.mockResolvedValue(staked(1_919_720_768n, 92_000_000n, 1_790_000_000n));
    const r = await confirmRoute(post("/api/withdraw/confirm", { signedTransaction: signed }));
    expect(r.status).toBe(200);
    expect((await repo.pendingWithdrawal(U))?.sharesUnstaked).toBe(80_279_232n);
  });

  it("builds an earned pick with the brief", async () => {
    const r = await build(post("/api/withdraw/build", { mode: "earned" }));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(typeof b.transaction).toBe("string");
    expect(b.shares).toBe("80279232");
    expect(b.prunes).toBe(false);
    expect(b.brief.length).toBe(3);   // his note 10-05: three short lines
  });

  // Review Focus 3
  it("refuses a pick below 1 SKR", async () => {
    await seed(1_000_000_000n);
    positionMock.mockResolvedValue({ shares: 873_000_000n, stakedRaw: 1_000_458_000n, unstakingRaw: 0n, unstakeTs: null }); // 1.0005 SKR over 1 SKR put in
    const r = await build(post("/api/withdraw/build", { mode: "earned" }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("1 SKR");
  });

  it("refuses an amount above the garden", async () => {
    const r = await build(post("/api/withdraw/build", { mode: "amount", amountRaw: "9000000000" }));
    expect(r.status).toBe(400);
  });

  // Review Focus 4
  it("refuses a second pick while one ripens", async () => {
    await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 1n, amountRaw: 1_000_000n, principalRaw: 0n });
    const r = await build(post("/api/withdraw/build", { mode: "earned" }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("One basket at a time");
  });

  it("confirm sends the signed unstake, checks the chain, and records the basket from the transaction, not the body [A3]", async () => {
    const b = await (await build(post("/api/withdraw/build", { mode: "earned" }))).json();
    const signed = await signAsUser(b.transaction);
    positionMock.mockResolvedValue(staked(1_919_720_768n, 92_000_000n, 1_790_000_000n));
    const r = await confirmRoute(post("/api/withdraw/confirm", { signedTransaction: signed, shares: "1", amountRaw: "1" }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.basket.amountRaw).toBe("91999999"); // the shares are worth 91,999,999 raw at this price: the plant keeps the dust
    expect(body.basket.readyAt).toBe(new Date((1_790_000_000 + 172_800) * 1000).toISOString());
    const pending = await repo.pendingWithdrawal(U);
    expect(pending?.sharesUnstaked).toBe(80_279_232n);
    expect(pending?.principalRaw).toBe(0n);
    expect(pending?.source).toBe("sprouts");
  });

  it("K-I4: two posts of the same signed unstake racing: one basket row, the same answer twice; the reconcile books no phantom own-stake", async () => {
    const b = await (await build(post("/api/withdraw/build", { mode: "earned" }))).json();
    const signed = await signAsUser(b.transaction);
    positionMock.mockResolvedValue(staked(1_919_720_768n, 92_000_000n, 1_790_000_000n));
    const [r1, r2] = await Promise.all([confirmRoute(post("/api/withdraw/confirm", { signedTransaction: signed })), confirmRoute(post("/api/withdraw/confirm", { signedTransaction: signed }))]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const [b1, b2] = [await r1.json(), await r2.json()];
    expect(b2.basket.id).toBe(b1.basket.id);
    expect(await repo.listWithdrawals(U, 10)).toHaveLength(1);
    // A third post after the fact answers from the row and sends nothing.
    sendMock.mockClear();
    const r3 = await confirmRoute(post("/api/withdraw/confirm", { signedTransaction: signed }));
    expect(r3.status).toBe(200);
    expect((await r3.json()).basket.id).toBe(b1.basket.id);
    expect(sendMock).not.toHaveBeenCalled();
    // The reconcile: shares 2e9 minted - 80_279_232 burned once = what the chain shows; nothing to book.
    const { reconcileOwnStakes } = await import("@/lib/reconcile");
    const out = await reconcileOwnStakes({ repo, now: new Date(Date.now() + 3_600_000), chain: { readPosition: async () => staked(1_919_720_768n, 92_000_000n, 1_790_000_000n), sharePrice: async () => SP } });
    expect(out.adjusted).toEqual([]);
    expect(out.deferred).toEqual([]);
    expect(await repo.listStakeAdjustments(U)).toEqual([]);
  });

  it("confirm refuses an unsigned or foreign transaction before sending anything", async () => {
    const b = await (await build(post("/api/withdraw/build", { mode: "earned" }))).json();
    const r = await confirmRoute(post("/api/withdraw/confirm", { signedTransaction: b.transaction }));
    expect(r.status).toBe(400);
    expect(await repo.pendingWithdrawal(U)).toBeNull();
    expect((await confirmRoute(post("/api/withdraw/confirm", { signedTransaction: "AAAA" }))).status).toBe(400);
  });

  it("put it back: cancel build needs a basket, cancel confirm closes the row once the chain shows nothing unstaking", async () => {
    expect((await cancelBuild(post("/api/withdraw/cancel/build", {}))).status).toBe(409);
    const w = await repo.insertWithdrawal({ userPubkey: U, asset: "SKR", source: "sprouts", unstakeSignature: "x", sharesUnstaked: 80_279_232n, amountRaw: 92_000_000n, principalRaw: 0n });
    const t = await (await cancelBuild(post("/api/withdraw/cancel/build", {}))).json();
    expect(typeof t.transaction).toBe("string");
    const signed = await signAsUser(t.transaction);
    positionMock.mockResolvedValue(staked(2_000_000_000n));
    const r = await cancelConfirm(post("/api/withdraw/cancel/confirm", { signedTransaction: signed }));
    expect(r.status).toBe(200);
    expect((await repo.listWithdrawals(U, 5))[0].id).toBe(w.id);
    expect((await repo.listWithdrawals(U, 5))[0].cancelSignature).not.toBeNull();
    expect(await repo.pendingWithdrawal(U)).toBeNull();
  });
});
