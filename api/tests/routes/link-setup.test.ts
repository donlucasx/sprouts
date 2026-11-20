import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { generateKeyPairSigner, getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder, address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

/**
 * Task 17a (user rent, design 7): GET /api/link/{code}?wallet=W&setup=N. The fake chain: the wallet's SOL, which accounts exist, the
 * simulation (a queue of answers, then ok), and how often each read ran.
 */
const { chain, simulateMock } = vi.hoisted(() => ({
  chain: { lamports: 1_000_000_000n, existing: new Set<string>(), balanceReads: 0, multiReads: 0 },
  simulateMock: vi.fn(async (..._a: unknown[]) => ({ value: { err: null as unknown, logs: [] as string[] } })),
}));
vi.mock("@/lib/subscriptions", async (orig) => ({
  ...(await orig<object>()),
  readDelegation: vi.fn(async () => ({ exists: false })),
  readSubscriptionAuthority: vi.fn(async () => ({ exists: false })),
  readUsdcAtaExists: vi.fn(async () => false),
  readUsdcBalanceRaw: vi.fn(async () => 0n),
  readUsdcApproved: vi.fn(async () => true),
}));
vi.mock("@/lib/auth-guard", async (orig) => ({ ...(await orig<object>()), rateLimited: () => false }));
vi.mock("@/lib/puller", () => ({ pullerSigner: vi.fn(async () => ({ address: "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1" })) }));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
  simulateTransaction: (tx: string) => ({ send: () => simulateMock(tx) }),
  getBalance: () => ({ send: async () => { chain.balanceReads++; return { value: chain.lamports }; } }),
  getMultipleAccounts: (as: string[]) => ({ send: async () => { chain.multiReads++; return { value: as.map((a) => (chain.existing.has(a) ? { lamports: 1n } : null)) }; } }),
}) }));

import { POST as newCode } from "@/app/api/link/new/route";
import { GET as getTx } from "@/app/api/link/[code]/route";

const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const STORE = "storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR";
const HSOL = "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A";
const CBBTC = "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij";
const KUSDC = "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D";
const FUSDC = "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D";
const KSOL = "2UywZrUdyqs5vDchy7fKQJKau2RVyuzBev2XKGPDSiX1";
const FSOL = "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RENT = 2_039_280n;
const MARGIN = 20_000_000n;

let SEEKER = "";
let WEB = "";
beforeAll(async () => {
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
  SEEKER = (await generateKeyPairSigner()).address;
  WEB = (await generateKeyPairSigner()).address;
});
const ataOf = async (owner: string, mint: string) => (await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0] as string;
/** program + the mint slot of each instruction (ATA creates only), e.g. ["ATA:<mint>", "SUBS"]. */
function shape(b64: string): string[] {
  const m = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(getBase64Encoder().encode(b64)).messageBytes);
  if (m.version !== 0) throw new Error("not v0");
  const keys = m.staticAccounts as readonly string[];
  return m.instructions.map((ix) => (keys[ix.programAddressIndex] === ATA ? `ATA:${keys[(ix.accountIndices ?? [])[3]]}` : "SUBS"));
}

describe("link approval with the opt-in setup (Task 17a)", () => {
  let repo: MemoryRepo;
  let code: string;
  const get = async (q: string) => getTx(new Request(`http://x/api/link/${code}?${q}`), { params: Promise.resolve({ code }) });

  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: SEEKER, sgtMint: "M", skrName: null });
    // Every coin on: USDC lending 20 first, then stORE, hSOL, cbBTC, SOL lending at 10 each (table order on ties).
    await repo.saveRules(SEEKER, { allocation: { SKR: 40, stORE: 10, USDC_LEND: 20, SOL_LEND: 10, hSOL: 10, cbBTC: 10 } as never });
    const token = await issueSession(SEEKER, "M");
    code = (await (await newCode(new Request("http://x/api/link/new", { method: "POST", headers: { authorization: `Bearer ${token}` } }))).json()).code;
    Object.assign(chain, { lamports: 1_000_000_000n, balanceReads: 0, multiReads: 0 });
    chain.existing.clear();
    simulateMock.mockReset();
    simulateMock.mockImplementation(async () => ({ value: { err: null, logs: [] } }));
  });

  it("no setup param: today's approval exactly (no setup read, no setupAccounts key), byte for byte the same as an ignored setup", async () => {
    const plain = await (await get(`wallet=${SEEKER}`)).json();
    expect(plain.transaction).toBeTypeOf("string");
    expect("setupAccounts" in plain).toBe(false);
    expect(chain.multiReads + chain.balanceReads).toBe(0);
    expect(shape(plain.transaction)).toEqual([`ATA:${USDC}`, "SUBS", "SUBS"]);
    // A setup param that is not 1..7 builds the same bytes (and reads nothing for the setup)
    for (const bad of ["0", "8", "-1", "1.5", "abc", ""]) {
      const t = await (await get(`wallet=${SEEKER}&setup=${bad}`)).json();
      expect(t.transaction).toBe(plain.transaction);
      expect(t.setupAccounts).toBe(0);
    }
    expect(chain.multiReads).toBe(0);
  });

  it("setup=3, 7 missing, enough SOL: 3 leading creates (largest share first), then today's approval; setupAccounts 3", async () => {
    const t = await (await get(`wallet=${SEEKER}&setup=3`)).json();
    expect(shape(t.transaction)).toEqual([`ATA:${KUSDC}`, `ATA:${FUSDC}`, `ATA:${STORE}`, `ATA:${USDC}`, "SUBS", "SUBS"]);
    expect(t.setupAccounts).toBe(3);
    expect(chain.multiReads).toBe(1);
  });

  it("setup=7 with every account missing: all 7, in order, and it fits", async () => {
    const t = await (await get(`wallet=${SEEKER}&setup=7`)).json();
    expect(shape(t.transaction).slice(0, 7)).toEqual([KUSDC, FUSDC, STORE, HSOL, CBBTC, KSOL, FSOL].map((m) => `ATA:${m}`));
    expect(getBase64Encoder().encode(t.transaction).length).toBeLessThanOrEqual(1232);
    expect(t.setupAccounts).toBe(7);
  });

  it("accounts that exist are skipped; N above the missing count takes the missing only", async () => {
    for (const m of [KUSDC, FUSDC, STORE, HSOL, CBBTC]) chain.existing.add(await ataOf(SEEKER, m));
    const t = await (await get(`wallet=${SEEKER}&setup=7`)).json();
    expect(shape(t.transaction)).toEqual([`ATA:${KSOL}`, `ATA:${FSOL}`, `ATA:${USDC}`, "SUBS", "SUBS"]);
    expect(t.setupAccounts).toBe(2);
  });

  it("SOL short of n x rent + 0.02 SOL: none at all (never a part), today's bytes", async () => {
    const plain = (await (await get(`wallet=${SEEKER}`)).json()).transaction;
    chain.lamports = 3n * RENT + MARGIN - 1n;
    const short = await (await get(`wallet=${SEEKER}&setup=3`)).json();
    expect(short.transaction).toBe(plain);
    expect(short.setupAccounts).toBe(0);
    chain.lamports = 3n * RENT + MARGIN;
    expect((await (await get(`wallet=${SEEKER}&setup=3`)).json()).setupAccounts).toBe(3);
  });

  it("founder D3: a web-linked wallet (not the Seeker's own key) gets none, and nothing is read for it", async () => {
    const t = await (await get(`wallet=${WEB}&setup=3`)).json();
    expect(shape(t.transaction)).toEqual([`ATA:${USDC}`, "SUBS", "SUBS"]);
    expect(t.setupAccounts).toBe(0);
    expect(chain.multiReads + chain.balanceReads).toBe(0);
  });

  it("a failed setup read never blocks the link: today's approval", async () => {
    chain.existing = null as never; // the read throws
    const t = await get(`wallet=${SEEKER}&setup=3`);
    chain.existing = new Set();
    expect(t.status).toBe(200);
    const body = await t.json();
    expect(shape(body.transaction)).toEqual([`ATA:${USDC}`, "SUBS", "SUBS"]);
    expect(body.setupAccounts).toBe(0);
  });

  it("the simulation fails WITH the setup: rebuilt and simulated without it; only that second failure reaches the user", async () => {
    simulateMock.mockResolvedValueOnce({ value: { err: { InstructionError: [0, "Custom"] }, logs: [] } });
    const ok = await (await get(`wallet=${SEEKER}&setup=3`)).json();
    expect(simulateMock).toHaveBeenCalledTimes(2);
    expect(shape(ok.transaction)).toEqual([`ATA:${USDC}`, "SUBS", "SUBS"]);
    expect(ok.setupAccounts).toBe(0);
    simulateMock.mockClear();
    simulateMock.mockResolvedValueOnce({ value: { err: "InsufficientFundsForRent", logs: [] } }).mockResolvedValueOnce({ value: { err: "InsufficientFundsForRent", logs: [] } });
    const bad = await get(`wallet=${SEEKER}&setup=3`);
    expect(bad.status).toBe(400);
    expect(simulateMock).toHaveBeenCalledTimes(2);
    const { error } = await bad.json();
    expect(error).toMatch(/needs a little SOL/);
    expect(error).not.toMatch(/revoke/i); // Kimi: rent is not refunded "when you revoke"
    expect(error).not.toMatch(/—/);
  });
});
