import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { createSignInPayload, renderSignInMessage } from "@/lib/siws";
import { readSession } from "@/lib/session";
import { potForUser } from "@/lib/pot";
import { generateKeyPairSigner, signBytes, getUtf8Encoder, type KeyPairSigner } from "@solana/kit";

const SP = 1_146_000_000n;
const { positionMock } = vi.hoisted(() => ({ positionMock: vi.fn() }));
vi.mock("@/lib/genesis", () => ({ verifyGenesisHolder: vi.fn(async () => ({ mint: "GENESIS" })), verifyAnyGenesisHolder: vi.fn(async () => ({ mint: "GENESIS", kind: "seeker" })) }));
vi.mock("@/lib/skr", () => ({ skrNameOf: vi.fn(async () => null) }));
vi.mock("@/lib/staking", async (orig) => ({ ...(await orig<object>()), readPosition: (...a: unknown[]) => positionMock(...a), sharePrice: vi.fn(async () => SP) }));

import { POST as verify } from "@/app/api/auth/verify/route";
import { verifyAnyGenesisHolder } from "@/lib/genesis";

let user: KeyPairSigner;
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

beforeAll(async () => {
  process.env.APP_ORIGIN ??= "https://sprouts.money";
  process.env.HELIUS_RPC_URL ??= "https://rpc.example/none";
  user = await generateKeyPairSigner();
});

/** Step one done by hand: a nonce the server issued, the payload, the wallet's signature. */
async function signedIn(repo: MemoryRepo, device?: string) {
  const nonce = `n-${Math.random().toString(36).slice(2)}`;
  const input = createSignInPayload({ address: user.address, nonce });
  await repo.putNonce({ nonce, expiresAt: new Date(input.expirationTime) });
  const message = new Uint8Array(getUtf8Encoder().encode(renderSignInMessage(input)));
  const signature = new Uint8Array(await signBytes(user.keyPair.privateKey, message));
  return { input, output: { address: user.address, signedMessage: b64(message), signature: b64(signature) }, ...(device ? { device } : {}) };
}
const post = (body: unknown) => verify(new Request("http://x/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/auth/verify, the first sign-in", () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    positionMock.mockReset();
  });

  // Review Focus 1 / R61: what the Seeker already holds is put in, never earned; a cooldown already running is a basket of principal (I1).
  it("records the position at join; a running cooldown becomes a wallet-source basket with no principal to subtract", async () => {
    positionMock.mockResolvedValue({ shares: 1_000_000_000n, stakedRaw: 1_146_000_000n, unstakingRaw: 50_000_000n, unstakeTs: 1_790_000_000n });
    const r = await post(await signedIn(repo, "phone-1"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(typeof body.token).toBe("string");
    const row = (await repo.getUser(user.address))!;
    expect(row.joinedShares).toBe(1_000_000_000n);
    expect(row.joinedSharePrice).toBe(SP);
    const basket = await repo.pendingWithdrawal(user.address);
    expect(basket?.source).toBe("wallet");
    expect(basket?.amountRaw).toBe(50_000_000n);
    expect(basket?.principalRaw).toBe(0n);
    const pot = await potForUser(repo, row, { position: { shares: 1_000_000_000n, stakedRaw: 1_146_000_000n, unstakingRaw: 50_000_000n, unstakeTs: 1_790_000_000n }, sharePrice: SP });
    expect(pot.skrEarnedRaw).toBe(0n);
    expect(pot.fruit).toBe(0);
  });

  // Review I5 (R84): the device is the client's own installation id, not the Genesis mint, so two clients keep two sessions.
  it("binds the session to the device the client names; another device's sign-in keeps the first session alive", async () => {
    positionMock.mockResolvedValue({ shares: 0n, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: null });
    const phone = (await (await post(await signedIn(repo, "phone-1"))).json()).token as string;
    const laptop = (await (await post(await signedIn(repo, "terminal"))).json()).token as string;
    expect((await readSession(phone))?.pubkey).toBe(user.address);
    expect((await readSession(laptop))?.pubkey).toBe(user.address);
    const again = (await (await post(await signedIn(repo, "phone-1"))).json()).token as string;
    expect(await readSession(phone)).toBeNull();
    expect((await readSession(again))?.pubkey).toBe(user.address);
    expect((await readSession(laptop))?.pubkey).toBe(user.address);
  });

  it("a second sign-in does not re-record the join", async () => {
    positionMock.mockResolvedValue({ shares: 1_000_000_000n, stakedRaw: 1_146_000_000n, unstakingRaw: 0n, unstakeTs: null });
    await post(await signedIn(repo, "phone-1"));
    positionMock.mockResolvedValue({ shares: 5_000_000_000n, stakedRaw: 5_730_000_000n, unstakingRaw: 0n, unstakeTs: null });
    await post(await signedIn(repo, "phone-1"));
    expect((await repo.getUser(user.address))!.joinedShares).toBe(1_000_000_000n);
  });
});

// R86: the Saga Genesis Token opens the vault too; the gate is one call that tries the Seeker token first, then the Saga token.
describe("POST /api/auth/verify, the Saga Genesis Token (R86)", () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    positionMock.mockReset();
    positionMock.mockResolvedValue({ shares: 0n, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: 0n });
  });

  it("a Saga holder registers with the Saga mint recorded", async () => {
    vi.mocked(verifyAnyGenesisHolder).mockResolvedValueOnce({ mint: "SAGA-MINT", kind: "saga" });
    const r = await post(await signedIn(repo, "saga-1"));
    expect(r.status).toBe(200);
    expect((await r.json()).sgtMint).toBe("SAGA-MINT");
    expect((await repo.getUser(user.address))!.sgtMint).toBe("SAGA-MINT");
  });

  it("no token of either kind is refused with copy that names both phones", async () => {
    vi.mocked(verifyAnyGenesisHolder).mockResolvedValueOnce(null);
    const r = await post(await signedIn(repo, "saga-1"));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("This wallet holds no Genesis Token. The vault needs a Seeker or a Saga.");
    expect(await repo.getUser(user.address)).toBeNull();
  });
});

describe("POST /api/auth/verify, Terms at sign-in (R283, contracts 5.6)", () => {
  let repo: MemoryRepo;
  beforeEach(() => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    positionMock.mockReset();
    positionMock.mockResolvedValue({ shares: 0n, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: null });
  });
  it("the current termsVersion is recorded with an event", async () => {
    expect((await post({ ...(await signedIn(repo, "phone-1")), termsVersion: "2026-10-06" })).status).toBe(200);
    expect((await repo.getUser(user.address))!.termsVersion).toBe("2026-10-06");
    expect(repo.events.filter((e) => e.kind === "terms_accepted")).toHaveLength(1);
  });
  it("another version, or none, signs in without recording", async () => {
    expect((await post({ ...(await signedIn(repo, "phone-1")), termsVersion: "2026-01-01" })).status).toBe(200);
    expect((await post(await signedIn(repo, "phone-1"))).status).toBe(200);
    expect((await repo.getUser(user.address))!.termsVersion).toBeNull();
    expect(repo.events.some((e) => e.kind === "terms_accepted")).toBe(false);
  });
});
