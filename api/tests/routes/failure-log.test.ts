import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { createSignInPayload, renderSignInMessage } from "@/lib/siws";
import { issueSession } from "@/lib/session";
import { generateKeyPairSigner, signBytes, getUtf8Encoder, type KeyPairSigner } from "@solana/kit";

const { genesisMock } = vi.hoisted(() => ({ genesisMock: vi.fn(async (): Promise<unknown> => ({ mint: "GENESIS", kind: "seeker" })) }));
vi.mock("@/lib/genesis", () => ({ verifyGenesisHolder: vi.fn(), verifyAnyGenesisHolder: (...a: unknown[]) => genesisMock(...(a as [])) }));
vi.mock("@/lib/skr", () => ({ skrNameOf: vi.fn(async () => null) }));
vi.mock("@/lib/staking", async (orig) => ({ ...(await orig<object>()), readPosition: vi.fn(async () => ({ shares: 0n, unstakingRaw: 0n, unstakeTs: null })), sharePrice: vi.fn(async () => 1_000_000_000n) }));
vi.mock("@/lib/auth-guard", async (orig) => ({ ...(await orig<object>()), rateLimited: () => false }));

import { POST as verify } from "@/app/api/auth/verify/route";
import { POST as newCode } from "@/app/api/link/new/route";
import { POST as confirm } from "@/app/api/link/confirm/route";
import { POST as report } from "@/app/api/link/report/route";
import { recordFailure, withFailureLog } from "@/lib/failure-log";
import { alertAllowed, founderAlertFor } from "@/lib/founder-alert";

let user: KeyPairSigner;
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const WALLET = "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1";

beforeAll(async () => {
  process.env.APP_ORIGIN ??= "https://sprouts.money";
  process.env.HELIUS_RPC_URL ??= "https://rpc.example/none";
  user = await generateKeyPairSigner();
});

async function signIn(repo: MemoryRepo, opts: { badSignature?: boolean } = {}) {
  const nonce = `n-${Math.random().toString(36).slice(2)}`;
  const input = createSignInPayload({ address: user.address, nonce });
  await repo.putNonce({ nonce, expiresAt: new Date(input.expirationTime) });
  const message = new Uint8Array(getUtf8Encoder().encode(renderSignInMessage(input)));
  const signature = opts.badSignature ? new Uint8Array(64) : new Uint8Array(await signBytes(user.keyPair.privateKey, message));
  return { input, output: { address: user.address, signedMessage: b64(message), signature: b64(signature) } };
}

let repo: MemoryRepo;
beforeEach(() => {
  repo = new MemoryRepo();
  setRepoForTests(repo);
  genesisMock.mockReset();
  genesisMock.mockImplementation(async () => ({ mint: "GENESIS", kind: "seeker" }));
});
const kinds = () => repo.events.map((e) => e.kind);

describe("signin_failed", () => {
  it("a stranger with no Genesis Token: recorded, but anonymous (a fresh key signs for free), so no alert", async () => {
    genesisMock.mockImplementation(async () => null);
    const res = await verify(json("http://x/api/auth/verify", await signIn(repo)));
    expect(res.status).toBe(403);
    const e = repo.events.find((x) => x.kind === "signin_failed")!;
    expect(e).toMatchObject({ userPubkey: null, walletPubkey: user.address, detail: { step: "verify", status: 403 } });
    expect((e.detail as { error: string }).error).toMatch(/Genesis Token/);
    expect(founderAlertFor(e)).toBeNull();
  });

  it("a REGISTERED user whose Genesis Token is gone: tied to them and alerted", async () => {
    expect((await verify(json("http://x/api/auth/verify", await signIn(repo)))).status).toBe(200);
    genesisMock.mockImplementation(async () => null);
    expect((await verify(json("http://x/api/auth/verify", await signIn(repo)))).status).toBe(403);
    const e = repo.events.find((x) => x.kind === "signin_failed")!;
    expect(e).toMatchObject({ userPubkey: user.address, walletPubkey: null });
    expect(founderAlertFor(e)).toMatch(/^Sign-in failed/);
  });

  it("a signature that does not verify: the address is only claimed (walletPubkey), so no alert", async () => {
    const res = await verify(json("http://x/api/auth/verify", await signIn(repo, { badSignature: true })));
    expect(res.status).toBe(401);
    const e = repo.events.find((x) => x.kind === "signin_failed")!;
    expect(e).toMatchObject({ userPubkey: null, walletPubkey: user.address, detail: { status: 401 } });
    expect(founderAlertFor(e)).toBeNull();
  });

  it("a malformed body is not recorded, and a sign-in that works records no failure", async () => {
    expect((await verify(json("http://x/api/auth/verify", { nope: 1 }))).status).toBe(400);
    expect((await verify(json("http://x/api/auth/verify", await signIn(repo)))).status).toBe(200);
    expect(kinds()).not.toContain("signin_failed");
  });

  it("a throw is recorded as a 500 and still thrown", async () => {
    genesisMock.mockImplementation(async () => { throw new Error("rpc down"); });
    await expect(verify(json("http://x/api/auth/verify", await signIn(repo)))).rejects.toThrow("rpc down");
    expect(repo.events.find((x) => x.kind === "signin_failed")).toMatchObject({ userPubkey: null, walletPubkey: user.address, detail: { status: 500, error: "rpc down" } });
  });
});

describe("link_started and link_failed", () => {
  it("a new code writes link_started for its owner", async () => {
    const token = await issueSession("U1111111111111111111111111111111", "M");
    expect((await newCode(new Request("http://x/api/link/new", { method: "POST", headers: { authorization: `Bearer ${token}` } }))).status).toBe(200);
    expect(repo.events.find((x) => x.kind === "link_started")).toMatchObject({ userPubkey: "U1111111111111111111111111111111" });
  });

  it("a confirm on a live code that was never fetched: tied to the code's owner and alerted", async () => {
    await repo.putLinkCode({ code: "ABC234", userPubkey: "OWNER", expiresAt: new Date(Date.now() + 60_000), nonce: 1n });
    expect((await confirm(json("http://x/api/link/confirm", { code: "abc234", wallet: WALLET }))).status).toBe(409);
    const e = repo.events.find((x) => x.kind === "link_failed")!;
    expect(e).toMatchObject({ userPubkey: "OWNER", walletPubkey: WALLET, detail: { step: "confirm", status: 409 } });
    expect(founderAlertFor(e)).toMatch(/^Link failed at confirm/);
  });

  it("an unknown code stays anonymous (no alert)", async () => {
    expect((await confirm(json("http://x/api/link/confirm", { code: "ZZZ999", wallet: WALLET }))).status).toBe(404);
    const e = repo.events.find((x) => x.kind === "link_failed")!;
    expect(e.userPubkey).toBeNull();
    expect(founderAlertFor(e)).toBeNull();
  });
});

describe("POST /api/link/report (the app's own view of a failed link)", () => {
  it("signed in: recorded as link_failed from the app, against the session's owner", async () => {
    const token = await issueSession("U2222222222222222222222222222222", "M");
    const res = await report(json("http://x/api/link/report", { step: "sign", reason: "dropped", error: "CancellationException", wallet: WALLET }, { authorization: `Bearer ${token}` }));
    expect(res.status).toBe(200);
    const e = repo.events.find((x) => x.kind === "link_failed")!;
    expect(e).toMatchObject({ userPubkey: "U2222222222222222222222222222222", walletPubkey: WALLET, detail: { step: "sign", from: "app", reason: "dropped", error: "CancellationException" } });
    expect(founderAlertFor(e)).toBe("Link stopped in the app at sign: wallet 4wiD...EbJ1 (user U222...2222): dropped");
  });

  it("the app's own text never reaches the alert, whatever it says", async () => {
    const token = await issueSession("U4444444444444444444444444444444", "M");
    await report(json("http://x/api/link/report", { step: "sign", reason: "other", error: "@everyone free SOL https://evil.example" }, { authorization: `Bearer ${token}` }));
    const e = repo.events.find((x) => x.kind === "link_failed")!;
    expect((e.detail as { error: string }).error).toContain("@everyone");
    expect(founderAlertFor(e)).not.toMatch(/everyone|evil/);
  });

  it("not signed in, or a bad body: nothing recorded", async () => {
    expect((await report(json("http://x/api/link/report", { step: "sign", reason: "dropped", error: "x" }))).status).toBe(401);
    const token = await issueSession("U3333333333333333333333333333333", "M");
    expect((await report(json("http://x/api/link/report", { step: "elsewhere", reason: "dropped", error: "x" }, { authorization: `Bearer ${token}` }))).status).toBe(400);
    expect(kinds()).not.toContain("link_failed");
  });
});

describe("the wrapper never changes the answer", () => {
  it("a failed event write leaves the route's own response", async () => {
    repo.addEvent = async () => { throw new Error("db down"); };
    const h = withFailureLog("link_failed", "t", async () => ({ userPubkey: null, walletPubkey: null }), async () => new Response(JSON.stringify({ error: "nope" }), { status: 409 }));
    const res = await h(new Request("http://x", { method: "POST", body: "{}" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "nope" });
    await expect(recordFailure("link_failed", "t", { status: 1, error: "x" }, async () => ({ userPubkey: null, walletPubkey: null }))).resolves.toBeUndefined();
  });

  it("a 429 is not recorded", async () => {
    const h = withFailureLog("link_failed", "t", async () => ({ userPubkey: "U", walletPubkey: null }), async () => new Response(JSON.stringify({ error: "Too many requests." }), { status: 429 }));
    await h(new Request("http://x", { method: "POST", body: "{}" }));
    expect(kinds()).toEqual([]);
  });
});

describe("alertAllowed: a caller cannot flood the webhook", () => {
  it("one sign-in or link failure alert per user per kind per 10 minutes; other kinds always pass", () => {
    const e = { kind: "link_failed" as const, userPubkey: "UTHROTTLE" };
    expect(alertAllowed(e, 1_000_000)).toBe(true);
    expect(alertAllowed(e, 1_000_000 + 9 * 60_000)).toBe(false);
    expect(alertAllowed({ kind: "signin_failed", userPubkey: "UTHROTTLE" }, 1_000_000 + 60_000)).toBe(true);
    expect(alertAllowed(e, 1_000_000 + 10 * 60_000)).toBe(true);
    expect(alertAllowed({ kind: "pull_failed", userPubkey: "UTHROTTLE" }, 1_000_000)).toBe(true);
    expect(alertAllowed({ kind: "pull_failed", userPubkey: "UTHROTTLE" }, 1_000_001)).toBe(true);
  });
});
