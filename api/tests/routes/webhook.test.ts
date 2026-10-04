import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import type { HeliusEnhancedTx } from "@/lib/book-swap";
import fixtureJson from "../fixtures/helius-swap.json";
import { getBase58Decoder } from "@solana/kit";

// Security R207 #8, the route's wiring: the booking task the webhook schedules re-reads each swap from chain through the app's
// RPC (faked here) before booking it. `after` runs the task inline so the test can await it.
const { tasks, getTransactionMock } = vi.hoisted(() => ({ tasks: [] as Promise<unknown>[], getTransactionMock: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: (fn: () => Promise<unknown>) => { tasks.push(fn()); } }));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({ getTransaction: () => ({ send: getTransactionMock }) }) }));
vi.mock("@/lib/jupiter", () => ({ priceUsd: async () => null }));
vi.mock("@/lib/puller", () => ({ pullerSigner: async () => ({ address: "PULLER" }) }));

import { POST } from "@/app/api/webhooks/helius/route";

const fixture = fixtureJson as unknown as HeliusEnhancedTx;
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const bal = (accountIndex: number, mint: string, amount: string, decimals: number) => ({ accountIndex, mint, owner: "WALLET", uiTokenAmount: { amount, decimals } });

/** The fixture's swap as the chain has it, timed now so it is recent. */
function onChain(blockTime: number) {
  return {
    blockTime: BigInt(blockTime),
    meta: { err: null, preBalances: [1_000_000_000n], postBalances: [999_995_000n], preTokenBalances: [bal(1, USDC, "5000000", 6)], postTokenBalances: [bal(1, USDC, "3830000", 6), bal(2, BONK, "5200050000", 5)] },
    transaction: { message: { accountKeys: [{ pubkey: "WALLET", signer: true }] } },
  };
}

async function deliver(tx: HeliusEnhancedTx) {
  const res = await POST(new Request("http://x/api/webhooks/helius", { method: "POST", headers: { authorization: "Bearer hook-secret" }, body: JSON.stringify([tx]) }));
  await Promise.all(tasks.splice(0));
  return res;
}

describe("POST /api/webhooks/helius", () => {
  let repo: MemoryRepo;
  const now = Math.floor(Date.now() / 1000);
  // A well-formed 64-byte signature: the RPC helper refuses the fixture's placeholder before any call (and so books nothing).
  const tx = { ...fixture, timestamp: now, signature: getBase58Decoder().decode(new Uint8Array(64).fill(7)) };

  beforeAll(() => {
    process.env.HELIUS_WEBHOOK_SECRET = "hook-secret";
  });
  beforeEach(async () => {
    repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: "U", sgtMint: "M", skrName: null });
    await repo.addWallet({ pubkey: "WALLET", userPubkey: "U", delegationPda: "D", dailyCapCents: 500 });
    getTransactionMock.mockReset();
  });

  it("books a swap the chain confirms, with one getTransaction", async () => {
    getTransactionMock.mockResolvedValue(onChain(now));
    expect((await deliver(tx)).status).toBe(200);
    expect((await repo.unplantedSwaps("WALLET")).length).toBe(1);
    expect(getTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("does not book a well-formed event whose transaction the chain does not confirm (a forged event with the secret)", async () => {
    getTransactionMock.mockResolvedValue(onChain(now - 3 * 86_400));   // a real old swap re-posted with a fresh timestamp
    expect((await deliver(tx)).status).toBe(200);
    expect(getTransactionMock).toHaveBeenCalledTimes(1);
    expect((await repo.unplantedSwaps("WALLET")).length).toBe(0);
  });
});
