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
const { positionMock, sendMock } = vi.hoisted(() => ({ positionMock: vi.fn(), sendMock: vi.fn(async () => "sig") }));
vi.mock("@/lib/staking", async (orig) => ({ ...(await orig<object>()), readPosition: (...a: unknown[]) => positionMock(...a), sharePrice: vi.fn(async () => SP) }));
vi.mock("@/lib/jupiter", () => ({ priceUsd: vi.fn(async () => 0.0183) }));
vi.mock("@/lib/planting", () => ({ signatureStatus: vi.fn(async () => "confirmed") }));
vi.mock("@/lib/rpc", () => ({
  rpc: () => ({
    getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
    sendTransaction: () => ({ send: sendMock }),
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
      [{ asset: "SKR", usdcInCents: 20, amountOutRaw: legRaw, staked: true, feeAmountRaw: 0n }]);
    await repo.setPlantingShares(p.id, { before: 0n, after: 2_000_000_000n, minted: 2_000_000_000n });
    auth = { authorization: `Bearer ${await issueSession(U, "M")}`, "content-type": "application/json" };
  }
  beforeEach(async () => {
    await seed(2_200_000_000n); // 2,292 SKR in the garden at SP against 2,200 put in: 92 SKR earned
    positionMock.mockReset();
    positionMock.mockResolvedValue(staked(2_000_000_000n));
    sendMock.mockReset();
    sendMock.mockResolvedValue("sig");
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
    expect(b.brief.length).toBe(5);
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
