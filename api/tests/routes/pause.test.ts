import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { createSignInPayload, renderSignInMessage } from "@/lib/siws";
import { generateKeyPairSigner, signBytes, getUtf8Encoder, type KeyPairSigner } from "@solana/kit";
import { POST as pause } from "@/app/api/pause/route";

// R147: the switch on Home. Off pauses every linked wallet (nothing is pulled or planted); on resumes them all with ONE fresh
// sign-in (R84), where the per-wallet route would ask one per wallet (the nonce is single use).
let user: KeyPairSigner;
let U: string;
let auth: Record<string, string>;
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
async function reauth(repo: MemoryRepo, signer: KeyPairSigner, nonce = `n-${Math.random().toString(36).slice(2)}`) {
  const input = createSignInPayload({ address: signer.address, nonce });
  await repo.putNonce({ nonce, expiresAt: new Date(input.expirationTime) });
  const message = new Uint8Array(getUtf8Encoder().encode(renderSignInMessage(input)));
  const signature = new Uint8Array(await signBytes(signer.keyPair.privateKey, message));
  return { input, output: { address: signer.address, signedMessage: b64(message), signature: b64(signature) } };
}
const call = (body: unknown) => pause(new Request("http://x/api/pause", { method: "POST", headers: auth, body: JSON.stringify(body) }));

beforeAll(async () => {
  process.env.APP_ORIGIN ??= "https://sprouts.money";
  user = await generateKeyPairSigner();
  U = user.address;
});

describe("POST /api/pause (R147)", () => {
  let repo: MemoryRepo;
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: "W1", userPubkey: U, delegationPda: "D1", dailyCapCents: 500 });
    await repo.addWallet({ pubkey: "W2", userPubkey: U, delegationPda: "D2", dailyCapCents: 500 });
    await repo.addWallet({ pubkey: "W3", userPubkey: U, delegationPda: "D3", dailyCapCents: 500 });
    await repo.setWalletStatus("W3", "revoked");
    auth = { authorization: `Bearer ${await issueSession(U, "M")}`, "content-type": "application/json" };
  });

  it("paused: true pauses every active wallet with the session alone; a revoked wallet is left alone", async () => {
    const res = await call({ paused: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paused: boolean; wallets: { pubkey: string; status: string }[] };
    expect(body.paused).toBe(true);
    expect(body.wallets.map((w) => [w.pubkey, w.status])).toEqual([["W1", "paused"], ["W2", "paused"], ["W3", "revoked"]]);
  });

  it("paused: false needs one fresh sign-in and resumes every paused wallet, one event each", async () => {
    await call({ paused: true });
    const refused = await call({ paused: false });
    expect(refused.status).toBe(403);
    expect((await refused.json()) as object).toMatchObject({ reauth: true });
    const res = await call({ paused: false, reauth: await reauth(repo, user) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { paused: boolean; wallets: { pubkey: string; status: string }[] };
    expect(body.paused).toBe(false);
    expect(body.wallets.map((w) => w.status)).toEqual(["active", "active", "revoked"]);
    expect(repo.events.filter((e) => e.kind === "resumed").map((e) => e.walletPubkey)).toEqual(["W1", "W2"]);
  });

  it("a bad body names the field", async () => {
    const res = await call({ paused: "yes" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("Bad request: paused.");
  });
});
