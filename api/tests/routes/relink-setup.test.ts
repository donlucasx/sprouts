import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { generateKeyPairSigner, getBase64Encoder, getTransactionDecoder, getCompiledTransactionMessageDecoder, type KeyPairSigner } from "@solana/kit";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

/** Task 17a (user rent, design 7): POST /api/relink/build { setupMax? }. */
const { chain, simulateMock } = vi.hoisted(() => ({
  chain: { lamports: 1_000_000_000n, multiReads: 0 },
  simulateMock: vi.fn(async (..._a: unknown[]) => ({ value: { err: null as unknown, logs: [] as string[] } })),
}));
vi.mock("@/lib/subscriptions", async (orig) => ({
  ...(await orig<object>()),
  readDelegation: vi.fn(async () => ({ exists: true, amountPerPeriodRaw: 5_000_000n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 86_400n })),
  readSubscriptionAuthority: vi.fn(async () => ({ exists: true, initId: 4n })),
  readUsdcAtaExists: vi.fn(async () => true),
}));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi", lastValidBlockHeight: 1n } }) }),
  simulateTransaction: (tx: string) => ({ send: () => simulateMock(tx) }),
  getBalance: () => ({ send: async () => ({ value: chain.lamports }) }),
  getMultipleAccounts: (as: string[]) => ({ send: async () => { chain.multiReads++; return { value: as.map(() => null) }; } }),
}) }));

import { POST as build } from "@/app/api/relink/build/route";

const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const STORE = "storenSbvkfzircixnaosc5CbzNZVrHJ6S3EKrS1yqR";
const HSOL = "he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A";
const OLD = "ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD";
let user: KeyPairSigner;
beforeAll(async () => {
  process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
  user = await generateKeyPairSigner();
});
const shape = (b64: string) => {
  const m = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(getBase64Encoder().encode(b64)).messageBytes);
  if (m.version !== 0) throw new Error("not v0");
  const keys = m.staticAccounts as readonly string[];
  return m.instructions.map((ix) => (keys[ix.programAddressIndex] === ATA ? `ATA:${keys[(ix.accountIndices ?? [])[3]]}` : "SUBS"));
};
const post = async (body?: unknown) =>
  build(new Request("http://x/api/relink/build", { method: "POST", headers: { authorization: `Bearer ${await issueSession(user.address, "M")}` }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) }));

describe("relink/build with setupMax (Task 17a)", () => {
  beforeEach(async () => {
    const repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: user.address, sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: user.address, userPubkey: user.address, delegationPda: OLD, dailyCapCents: 500 });
    await repo.saveRules(user.address, { allocation: { SKR: 80, stORE: 10, USDC_LEND: 0, SOL_LEND: 0, hSOL: 10, cbBTC: 0 } as never });
    Object.assign(chain, { lamports: 1_000_000_000n, multiReads: 0 });
    simulateMock.mockReset();
    simulateMock.mockImplementation(async () => ({ value: { err: null, logs: [] } }));
  });

  it("no body (0.1.11 / 0.1.12), an empty body or junk: today's re-link, no setup read, no setupAccounts", async () => {
    for (const body of [undefined, "", "not json", {}]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      const t = await res.json();
      expect(shape(t.transaction)).toEqual(["SUBS", "SUBS"]);
      expect("setupAccounts" in t).toBe(false);
    }
    expect(chain.multiReads).toBe(0);
  });

  it("setupMax 7 with stORE and hSOL on and missing: both prepended, then the revoke and create; setupAccounts 2", async () => {
    const t = await (await post({ setupMax: 7 })).json();
    expect(shape(t.transaction)).toEqual([`ATA:${STORE}`, `ATA:${HSOL}`, "SUBS", "SUBS"]);
    expect(t.setupAccounts).toBe(2);
    expect((await (await post({ setupMax: 1 })).json()).setupAccounts).toBe(1);
  });

  it("SOL short, or a bad setupMax: today's re-link (never refused for the setup)", async () => {
    chain.lamports = 2n * 2_039_280n + 20_000_000n - 1n;
    expect(shape((await (await post({ setupMax: 2 })).json()).transaction)).toEqual(["SUBS", "SUBS"]);
    chain.lamports = 1_000_000_000n;
    for (const setupMax of [8, -1, 1.5, "2"]) {
      const res = await post({ setupMax });
      expect(res.status).toBe(200);
      expect(shape((await res.json()).transaction)).toEqual(["SUBS", "SUBS"]);
    }
  });

  it("the simulation fails with the setup: rebuilt and simulated without it", async () => {
    simulateMock.mockResolvedValueOnce({ value: { err: { InstructionError: [0, "Custom"] }, logs: [] } });
    const t = await (await post({ setupMax: 2 })).json();
    expect(simulateMock).toHaveBeenCalledTimes(2);
    expect(shape(t.transaction)).toEqual(["SUBS", "SUBS"]);
    expect(t.setupAccounts).toBe(0);
  });
});
