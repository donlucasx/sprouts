import { SKR_ONLY } from "@/domain/coins";
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { createSignInPayload, renderSignInMessage } from "@/lib/siws";
import { generateKeyPairSigner, signBytes, getUtf8Encoder, signTransaction, getBase64EncodedWireTransaction, getBase64Encoder, getTransactionDecoder, type KeyPairSigner } from "@solana/kit";

const { readDelegationMock, statusMock, validMock } = vi.hoisted(() => ({
  readDelegationMock: vi.fn(async () => ({ exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n })),
  statusMock: vi.fn(async (_sig: string): Promise<"confirmed" | "failed" | "pending"> => "confirmed"),
  validMock: vi.fn(async (_blockhash: string, _config?: unknown) => true),
}));
vi.mock("@/lib/subscriptions", async (orig) => ({ ...(await orig<object>()), readDelegation: readDelegationMock }));
vi.mock("@/lib/rpc", () => ({
  rpc: () => ({
    getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
    sendTransaction: () => ({ send: async () => "sig" }),
    isBlockhashValid: (blockhash: string, config?: unknown) => ({ send: async () => ({ value: await validMock(blockhash, config) }) }),
  }),
}));
vi.mock("@/lib/planting", () => ({ signatureStatus: (sig: string) => statusMock(sig) }));
vi.mock("@/lib/user-tx", async (orig) => ({ ...(await orig<object>()), waitConfirmed: (sig: string) => statusMock(sig) }));   // one ask, not the 30 s poll

import { PUT as putRules } from "@/app/api/rules/route";
import { POST as walletAction } from "@/app/api/wallets/[pubkey]/route";
import { GET as revokeGet, POST as revokePost } from "@/app/api/revoke/[wallet]/route";

let user: KeyPairSigner;
let U: string;
let wallet: KeyPairSigner;
let W: string;
let auth: Record<string, string>;
const DELEGATION = "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs";

beforeAll(async () => {
  process.env.APP_ORIGIN ??= "https://sprouts.money";
  user = await generateKeyPairSigner();
  U = user.address;
  wallet = await generateKeyPairSigner();
  W = wallet.address;
});

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
/** A fresh Seed Vault sign-in for a sensitive write (R84): a single-use nonce the server issued, signed by the key given. */
async function reauth(repo: MemoryRepo, signer: KeyPairSigner, nonce = `n-${Math.random().toString(36).slice(2)}`) {
  const input = createSignInPayload({ address: signer.address, nonce });
  await repo.putNonce({ nonce, expiresAt: new Date(input.expirationTime) });
  const message = new Uint8Array(getUtf8Encoder().encode(renderSignInMessage(input)));
  const signature = new Uint8Array(await signBytes(signer.keyPair.privateKey, message));
  return { input, output: { address: signer.address, signedMessage: b64(message), signature: b64(signature) } };
}
const put = (body: unknown) => putRules(new Request("http://x/api/rules", { method: "PUT", headers: auth, body: JSON.stringify(body) }));
const act = (pubkey: string, body: unknown, headers: Record<string, string> = auth) =>
  walletAction(new Request(`http://x/api/wallets/${pubkey}`, { method: "POST", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ pubkey }) });

describe("rules, wallets, revoke", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: W, userPubkey: U, delegationPda: DELEGATION, dailyCapCents: 500 });
    auth = { authorization: `Bearer ${await issueSession(U, "M")}`, "content-type": "application/json" };
  });

  it("PUT saves validated rules and refuses out-of-range values", async () => {
    const ok = await put({ dailyCapCents: 300, pctOn: false });
    expect(ok.status).toBe(200);
    expect((await repo.getRules(U)).dailyCapCents).toBe(300);
    expect((await repo.getRules(U)).pctOn).toBe(false);
    expect((await put({ dailyCapCents: 50_000 })).status).toBe(400);
    expect((await put({ roundupToCents: 200 })).status).toBe(400);
  });

  // The split is never set directly (spec 3.1): with the manager off the stORE share is a pin, up to 50, and SKR is the rest.
  it("PUT takes the stORE share as a pin with the manager off, up to 50", async () => {
    expect((await put({ pins: { stORE: 50 } })).status).toBe(200);
    expect((await repo.getRules(U)).allocation).toEqual({ ...SKR_ONLY, SKR: 50, stORE: 50 });
    expect((await put({ pins: { stORE: 60 } })).status).toBe(400);
    expect((await put({ pins: { stORE: 55 } })).status).toBe(400);
    expect((await put({ pins: { stORE: 50, hSOL: 30 } })).status).toBe(400);
    expect((await repo.getRules(U)).allocation).toEqual({ ...SKR_ONLY, SKR: 50, stORE: 50 });
  });

  // R84: raising the limit is one of the two writes a stolen session must not be able to do.
  it("raising the daily limit needs a fresh Seed Vault sign-in; lowering does not; a sign-in is single-use", async () => {
    expect((await put({ dailyCapCents: 300 })).status).toBe(200); // the limit tops out at $5, so lower it first
    const refused = await put({ dailyCapCents: 500 });
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toContain("sign in again");
    expect((await repo.getRules(U)).dailyCapCents).toBe(300);
    const r = await reauth(repo, user);
    expect((await put({ dailyCapCents: 500, reauth: r })).status).toBe(200);
    expect((await repo.getRules(U)).dailyCapCents).toBe(500);
    await put({ dailyCapCents: 300 });
    expect((await put({ dailyCapCents: 400, reauth: r })).status).toBe(403); // the nonce was consumed
    expect((await put({ dailyCapCents: 200 })).status).toBe(200); // lowering needs nothing
  });

  it("a sign-in by another key, or for another Seeker, is refused", async () => {
    const other = await generateKeyPairSigner();
    await put({ dailyCapCents: 300 }); // the limit tops out at $5, so lower it to have something to raise
    const r = await reauth(repo, other);
    expect((await put({ dailyCapCents: 500, reauth: r })).status).toBe(403);
    const forged = { ...(await reauth(repo, other)), output: { ...(await reauth(repo, other)).output, address: U } };
    expect((await put({ dailyCapCents: 500, reauth: forged })).status).toBe(403);
  });

  it("pause needs no sign-in, resume does; only the owner; never on a revoked wallet [A20]", async () => {
    expect((await act(W, { action: "pause" })).status).toBe(200);
    expect((await repo.getWallet(W))?.status).toBe("paused");
    expect((await act(W, { action: "resume" })).status).toBe(403);
    expect((await act(W, { action: "resume", reauth: await reauth(repo, user) })).status).toBe(200);
    expect((await repo.getWallet(W))?.status).toBe("active");
    const other = { authorization: `Bearer ${await issueSession("U2", "M2")}`, "content-type": "application/json" };
    expect((await act(W, { action: "pause" }, other)).status).toBe(404);
    await repo.setWalletStatus(W, "revoked");
    expect((await act(W, { action: "resume", reauth: await reauth(repo, user) })).status).toBe(409);
  });

  // Security R207 #7 and #9: the per-wallet limit alone let one caller enumerate many wallets; a per-IP limit now binds too, keyed
  // on the platform's address, so a rotated x-forwarded-for prefix does not open a new bucket.
  it("revoke GET: one caller enumerating many wallets is stopped by the per-IP limit", async () => {
    const was = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      const get = (w: string, ip: string, spoof: string) => revokeGet(new Request(`http://x/api/revoke/${w}`, { headers: { "x-real-ip": ip, "x-forwarded-for": `${spoof}, ${ip}` } }), { params: Promise.resolve({ wallet: w }) });
      const wallets = await Promise.all(Array.from({ length: 21 }, async () => (await generateKeyPairSigner()).address));
      const statuses = [];
      for (const [i, w] of wallets.entries()) statuses.push((await get(w, "198.51.100.9", `10.0.0.${i}`)).status);
      expect(statuses.slice(0, 20).every((st) => st === 200)).toBe(true);
      expect(statuses[20]).toBe(429);
      expect((await get(wallets[0], "198.51.100.10", "10.0.0.1")).status).toBe(200);   // another caller is not affected
    } finally {
      if (was === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = was;
    }
  });

  it("revoke: GET answers no transaction for an unknown wallet, POST sends the wallet's own signed revoke and marks it revoked [A3]", async () => {
    const unknown = await revokeGet(new Request("http://x/api/revoke/9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm"), { params: Promise.resolve({ wallet: "9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm" }) });
    expect(unknown.status).toBe(200);
    expect((await unknown.json()).transaction).toBeNull();
    const t = await (await revokeGet(new Request(`http://x/api/revoke/${W}`), { params: Promise.resolve({ wallet: W }) })).json();
    expect(typeof t.transaction).toBe("string");
    const bad = await revokePost(new Request(`http://x/api/revoke/${W}`, { method: "POST", body: JSON.stringify({ signedTransaction: "AAAA" }) }), { params: Promise.resolve({ wallet: W }) });
    expect(bad.status).toBe(400);
    const signed = getBase64EncodedWireTransaction(await signTransaction([wallet.keyPair], getTransactionDecoder().decode(getBase64Encoder().encode(t.transaction))));
    const r = await revokePost(new Request(`http://x/api/revoke/${W}`, { method: "POST", body: JSON.stringify({ signedTransaction: signed }) }), { params: Promise.resolve({ wallet: W }) });
    expect(r.status).toBe(200);
    expect((await r.json()).revoked).toBe(true);
    expect((await repo.getWallet(W))?.status).toBe("revoked");
    expect(repo.events.some((e) => e.kind === "revoke_seen" && e.walletPubkey === W)).toBe(true);
  });
  it("revoke that has not confirmed (round 3, item 8): an expired blockhash did not go through; a valid one may still go through; the wallet stays linked", async () => {
    const t = await (await revokeGet(new Request(`http://x/api/revoke/${W}`), { params: Promise.resolve({ wallet: W }) })).json();
    const signed = getBase64EncodedWireTransaction(await signTransaction([wallet.keyPair], getTransactionDecoder().decode(getBase64Encoder().encode(t.transaction))));
    const send = () => revokePost(new Request(`http://x/api/revoke/${W}`, { method: "POST", body: JSON.stringify({ signedTransaction: signed }) }), { params: Promise.resolve({ wallet: W }) });
    statusMock.mockResolvedValue("pending");
    validMock.mockResolvedValueOnce(false);
    const expired = await send();
    expect(expired.status).toBe(409);
    expect((await expired.json()).error).toBe("It did not go through. Nothing changed. Try again.");
    validMock.mockResolvedValueOnce(true);
    const waiting = await send();
    expect(waiting.status).toBe(409);
    expect((await waiting.json()).error).toBe("It may still go through. Check Settings in a minute before you try again.");
    expect(validMock).toHaveBeenLastCalledWith(expect.any(String), { commitment: "confirmed" });   // the blockhash's own commitment
    expect((await repo.getWallet(W))?.status).not.toBe("revoked");
    // landed late: expired, but the second ask confirms; the wallet is revoked
    statusMock.mockReset();
    statusMock.mockResolvedValueOnce("pending").mockResolvedValueOnce("confirmed").mockResolvedValue("confirmed");
    validMock.mockResolvedValueOnce(false);
    const late = await send();
    expect(late.status).toBe(200);
    expect((await repo.getWallet(W))?.status).toBe("revoked");
  });
});
