import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";
import { getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder, getBase64EncodedWireTransaction, generateKeyPairSigner, signTransaction, decompileTransactionMessage, prependTransactionMessageInstructions, compileTransaction, address, type KeyPairSigner } from "@solana/kit";

vi.mock("@/lib/subscriptions", async (orig) => ({
  ...(await orig<object>()),
  readDelegation: vi.fn(async () => ({ exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n })),
  readSubscriptionAuthority: vi.fn(async () => ({ exists: false })),
  readUsdcAtaExists: vi.fn(async () => true),
}));
vi.mock("@/lib/helius", () => ({ heliusAddAddress: vi.fn(async () => undefined) }));
// The per-address limiter has its own tests; these exercise the link flow, which now makes more requests than one window allows.
vi.mock("@/lib/auth-guard", async (orig) => ({ ...(await orig<object>()), rateLimited: () => false }));
vi.mock("@/lib/puller", () => ({ pullerSigner: vi.fn(async () => ({ address: "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1" })) }));
const { simulateMock } = vi.hoisted(() => ({ simulateMock: vi.fn(async () => ({ value: { err: null as unknown, logs: [] as string[] } })) }));
vi.mock("@/lib/rpc", () => ({
  rpc: () => ({
    getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
    sendTransaction: () => ({ send: async () => "sig" }),
    simulateTransaction: () => ({ send: simulateMock }),
  }),
}));


/** What Phantom does before it signs (2026-09-29): prepends its own priority fee to the transaction the API built. */
function withWalletPriorityFee(b64tx: string) {
  const t = getTransactionDecoder().decode(getBase64Encoder().encode(b64tx));
  const m = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(t.messageBytes));
  const fee = { programAddress: address("ComputeBudget111111111111111111111111111111"), accounts: [], data: new Uint8Array([3, 0x10, 0x27, 0, 0, 0, 0, 0, 0]) };
  return compileTransaction(prependTransactionMessageInstructions([fee], m));
}

import { POST as newCode } from "@/app/api/link/new/route";
import { GET as getTx } from "@/app/api/link/[code]/route";
import { POST as confirm } from "@/app/api/link/confirm/route";

// The wallet is a throwaway keypair so a test can sign the approval the GET builds (Task 5).
let WALLET = "9H7ChDC2o32wC8jcpVDjLGQhwyx1hmLW1fiCjsjUuzFm";
let walletKeyPair: KeyPairSigner;
const OTHER = "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6";

beforeAll(async () => {
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
  process.env.HELIUS_WEBHOOK_ID ??= "hook-1";
  walletKeyPair = await generateKeyPairSigner();
  WALLET = walletKeyPair.address;
});

async function mintCode(repo: MemoryRepo) {
  const token = await issueSession("U", "M");
  const res = await newCode(new Request("http://x/api/link/new", { method: "POST", headers: { authorization: `Bearer ${token}` } }));
  return (await res.json()) as { code: string; expiresAt: string };
}

/** How many instructions a base64 wire transaction carries (the approval is v0, so the compiled message has them inline). */
function instructionCount(b64: string): number {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(b64));
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  return "instructions" in message ? message.instructions.length : -1;
}

describe("link flow", () => {
  let repo: MemoryRepo;

  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: "lucas.skr" });
  });

  it("issues a code, returns an unsigned transaction, links on confirm", async () => {
    const c = await mintCode(repo);
    expect(c.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const t = await (await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) })).json();
    expect(typeof t.transaction).toBe("string");
    expect(t.cap).toBe(500);
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: c.code, wallet: WALLET }) }));
    expect(await r.json()).toEqual({ linked: true, skrName: "lucas.skr" });
    expect((await repo.getWallet(WALLET))?.userPubkey).toBe("U");
    expect((await repo.getWallet(WALLET))?.delegationPda).toBe(t.delegationPda);
    // the wallet row carries the webhook outcome, not only the event (the first real link on 09-28 showed false on the row, true on the event)
    expect((await repo.getWallet(WALLET))?.webhookAdded).toBe(true);
  });

  it("still links when the webhook add fails, and the row says so", async () => {
    const { heliusAddAddress } = await import("@/lib/helius");
    const mock = heliusAddAddress as unknown as { mockRejectedValueOnce: (e: unknown) => void };
    mock.mockRejectedValueOnce(new Error("helius down"));
    const c = await mintCode(repo);
    await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) });
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: c.code, wallet: WALLET }) }));
    expect(r.status).toBe(200);
    expect((await repo.getWallet(WALLET))?.webhookAdded).toBe(false);
  });

  it("re-link: a wallet with an existing authority gets a one-instruction approval instead of a re-init", async () => {
    const { readSubscriptionAuthority } = await import("@/lib/subscriptions");
    const mock = readSubscriptionAuthority as unknown as { mockResolvedValue: (v: unknown) => void };
    mock.mockResolvedValue({ exists: true, initId: 42n });
    try {
      const c = await mintCode(repo);
      const t = await (await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) })).json();
      expect(instructionCount(t.transaction)).toBe(1);
    } finally {
      mock.mockResolvedValue({ exists: false });
    }
  });

  it("a fresh wallet gets the two-instruction approval (init the authority, then the delegation)", async () => {
    const c = await mintCode(repo);
    const t = await (await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) })).json();
    expect(instructionCount(t.transaction)).toBe(2);
  });

  it("a fresh wallet with no USDC account gets three instructions: the account is created in the same approval (the Saga, 2026-09-29)", async () => {
    const { readUsdcAtaExists } = await import("@/lib/subscriptions");
    (readUsdcAtaExists as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(false);
    const c = await mintCode(repo);
    const t = await (await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) })).json();
    expect(instructionCount(t.transaction)).toBe(3);
  });

  it("a wallet with no SOL is told so before any wallet is asked, and the code stays free for another wallet (MetaMask, 2026-09-29)", async () => {
    simulateMock.mockResolvedValueOnce({ value: { err: "AccountNotFound", logs: [] } });
    const c = await mintCode(repo);
    const r = await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/needs a little SOL/);
    const again = await getTx(new Request(`http://x/api/link/${c.code}?wallet=${OTHER}`), { params: Promise.resolve({ code: c.code }) });
    expect(again.status).toBe(200);
  });

  it("any other failing simulation is refused with the reason, the code still free", async () => {
    simulateMock.mockResolvedValueOnce({ value: { err: { InstructionError: [1, { Custom: 136 }] }, logs: ["Program log: stale"] } });
    const c = await mintCode(repo);
    const r = await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/would fail on chain/);
    expect((await repo.peekLinkCode(c.code))!.walletPubkey).toBeNull();
  });

  it("a code another wallet already used says to get a new one", async () => {
    const c = await mintCode(repo);
    await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) });
    const r = await getTx(new Request(`http://x/api/link/${c.code}?wallet=${OTHER}`), { params: Promise.resolve({ code: c.code }) });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("This code was already used with another wallet. Get a new code in the app, then try again.");
  });

  // Review I3: a wallet linked before (revoked, or re-approving) must re-link, not 500 on the row after the code is burned.
  it("re-linking a revoked wallet reactivates it with the new delegation and keeps its ledger", async () => {
    const OLD = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    await repo.addWallet({ pubkey: WALLET, userPubkey: "U", delegationPda: OLD, dailyCapCents: 500 });
    await repo.bumpLedger(WALLET, "SKR", 215);
    await repo.setWalletStatus(WALLET, "revoked");
    const c = await mintCode(repo);
    const t = await (await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) })).json();
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: c.code, wallet: WALLET }) }));
    expect(r.status).toBe(200);
    const row = await repo.getWallet(WALLET);
    expect(row?.status).toBe("active");
    expect(row?.delegationPda).toBe(t.delegationPda);
    expect(row?.delegationPda).not.toBe(OLD);
    expect(row?.ledgerCents).toEqual({ SKR: 215 });
  });

  it("refuses a wallet that another Seeker still holds", async () => {
    await repo.upsertUser({ seedVaultPubkey: "U2", sgtMint: "M2", skrName: null });
    await repo.addWallet({ pubkey: WALLET, userPubkey: "U2", delegationPda: "11111111111111111111111111111111", dailyCapCents: 500 });
    const c = await mintCode(repo);
    const res = await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) });
    expect(res.status).toBe(409);
    expect(await repo.peekLinkCode(c.code)).not.toBeNull();
  });

  // Review I4: a wallet must hold one delegation to the puller; re-approving revokes the live one in the same transaction.
  it("re-linking a wallet whose delegation is still live revokes it in the same approval", async () => {
    const { readSubscriptionAuthority } = await import("@/lib/subscriptions");
    const auth = readSubscriptionAuthority as unknown as { mockResolvedValue: (v: unknown) => void };
    auth.mockResolvedValue({ exists: true, initId: 42n });
    try {
      await repo.addWallet({ pubkey: WALLET, userPubkey: "U", delegationPda: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", dailyCapCents: 500 });
      const c = await mintCode(repo);
      const t = await (await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) })).json();
      // revoke the old delegation, then create the new one (the authority exists, so no init)
      expect(instructionCount(t.transaction)).toBe(2);
      expect(t.revokes).toBe("7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs");
    } finally {
      auth.mockResolvedValue({ exists: false });
    }
  });

  // Task 5 [A3]: the phone's own wallet signs the approval and posts it; the API checks it is the wallet's own approval before sending.
  it("confirm can carry the signed approval and send it before waiting for the delegation", async () => {
    const c = await mintCode(repo);
    const t = await (await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`, { headers: { "x-forwarded-for": "10.0.0.5" } }), { params: Promise.resolve({ code: c.code }) })).json();
    const signed = getBase64EncodedWireTransaction(await signTransaction([walletKeyPair.keyPair], getTransactionDecoder().decode(getBase64Encoder().encode(t.transaction))));
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: c.code, wallet: WALLET, signedTransaction: signed }) }));
    expect(r.status).toBe(200);
    expect((await repo.getWallet(WALLET))?.status).toBe("active");
  });

  it("confirm accepts a signed approval that creates the USDC account first", async () => {
    const { readUsdcAtaExists } = await import("@/lib/subscriptions");
    (readUsdcAtaExists as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(false);
    const c = await mintCode(repo);
    const t = await (await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) })).json();
    expect(instructionCount(t.transaction)).toBe(3);
    const signed = getBase64EncodedWireTransaction(await signTransaction([walletKeyPair.keyPair], getTransactionDecoder().decode(getBase64Encoder().encode(t.transaction))));
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: c.code, wallet: WALLET, signedTransaction: signed }) }));
    expect(r.status).toBe(200);
  });

  it("confirm accepts the approval after the wallet prepends its own priority fee (Phantom, 2026-09-29)", async () => {
    const c = await mintCode(repo);
    const t = await (await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) })).json();
    const signed = getBase64EncodedWireTransaction(await signTransaction([walletKeyPair.keyPair], withWalletPriorityFee(t.transaction)));
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: c.code, wallet: WALLET, signedTransaction: signed }) }));
    expect(r.status).toBe(200);
  });

  it("confirm refuses a posted transaction that is not the wallet's own approval", async () => {
    const c = await mintCode(repo);
    await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`, { headers: { "x-forwarded-for": "10.0.0.6" } }), { params: Promise.resolve({ code: c.code }) });
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: c.code, wallet: WALLET, signedTransaction: "AAAA" }) }));
    expect(r.status).toBe(400);
    expect(await repo.peekLinkCode(c.code)).not.toBeNull();
  });

  it("binds the code to the first wallet that fetches it", async () => {
    const c = await mintCode(repo);
    await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) });
    const second = await getTx(new Request(`http://x/api/link/${c.code}?wallet=${OTHER}`), { params: Promise.resolve({ code: c.code }) });
    expect(second.status).toBe(409);
  });

  it("does not burn the code when the delegation is not on chain yet", async () => {
    const { readDelegation } = await import("@/lib/subscriptions");
    (readDelegation as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n });
    const c = await mintCode(repo);
    await getTx(new Request(`http://x/api/link/${c.code}?wallet=${WALLET}`), { params: Promise.resolve({ code: c.code }) });
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: c.code, wallet: WALLET, waitMs: 0 }) }));
    expect(r.status).toBe(409);
    expect(await repo.peekLinkCode(c.code)).not.toBeNull();
    (readDelegation as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n });
  });

  it("refuses an unknown or used code", async () => {
    const r = await confirm(new Request("http://x/api/link/confirm", { method: "POST", body: JSON.stringify({ code: "ZZZZZZ", wallet: WALLET }) }));
    expect(r.status).toBe(404);
  });

  it("requires a session to mint a code", async () => {
    expect((await newCode(new Request("http://x/api/link/new", { method: "POST" }))).status).toBe(401);
  });
});
