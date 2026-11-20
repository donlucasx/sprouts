import { describe, it, expect, beforeEach, vi } from "vitest";
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { MemoryRepo } from "@/db/memory";
import { setRepoForTests } from "@/db/repo";
import { issueSession } from "@/lib/session";

/** Task 17a (user rent, design 6, 7): GET /api/me/usdc?setup=1 adds setupAccounts; Kimi: ?sources=1&setup=1 answers both. */
const U = "HJCJKRQLV2HVKfe3sFdTF5jjBY1xfWgnK8cLcjH7qnHd";
vi.mock("@/lib/subscriptions", () => ({ readUsdcBalanceRaw: vi.fn(async () => 0n) }));
const { chain } = vi.hoisted(() => ({ chain: { lamports: 1_000_000_000n as bigint | null, existing: new Set<string>() as Set<string> | null, multiReads: 0 } }));
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getBalance: () => ({ send: async () => { if (chain.lamports === null) throw new Error("rpc down"); return { value: chain.lamports }; } }),
  getTokenAccountsByOwner: () => ({ send: async () => ({ value: [] }) }),
  getMultipleAccounts: (as: string[]) => ({ send: async () => { chain.multiReads++; if (chain.existing === null) throw new Error("rpc down"); return { value: as.map((a) => (chain.existing!.has(a) ? { lamports: 1n } : null)) }; } }),
}) }));
vi.mock("@/lib/jupiter", async (orig) => ({ ...(await orig<typeof import("@/lib/jupiter")>()), priceUsd: vi.fn(async () => 200), pricesUsd: vi.fn(async () => ({})) }));

import { GET } from "@/app/api/me/usdc/route";

const KUSDC = "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D";
const get = async (query: string) => (await GET(new Request(`http://x/api/me/usdc${query}`, { headers: { authorization: `Bearer ${await issueSession(U, "M")}` } }))).json();

describe("GET /api/me/usdc?setup=1", () => {
  beforeEach(async () => {
    const repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    await repo.saveRules(U, { allocation: { SKR: 40, stORE: 10, USDC_LEND: 20, SOL_LEND: 10, hSOL: 10, cbBTC: 10 } as never });
    Object.assign(chain, { lamports: 1_000_000_000n, existing: new Set<string>(), multiReads: 0 });
  });

  it("without setup=1: the old shape, no setupAccounts key, no setup read", async () => {
    const body = await get("");
    expect("setupAccounts" in body).toBe(false);
    expect("setupAccounts" in (await get("?sources=1"))).toBe(false);
    expect(chain.multiReads).toBe(0);
  });

  it("setup=1: the missing accounts of the switched-on coins, capped at 7; existing ones not counted", async () => {
    expect((await get("?setup=1")).setupAccounts).toBe(7);
    chain.existing!.add((await findAssociatedTokenPda({ owner: address(U), mint: address(KUSDC), tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0]);
    expect((await get("?setup=1")).setupAccounts).toBe(6);
  });

  it("?sources=1&setup=1 answers both keys", async () => {
    const body = await get("?sources=1&setup=1");
    expect(body.setupAccounts).toBe(7);
    expect(body.topUpSources).toBeDefined();
  });

  it("0 when the SOL does not cover n x rent + 0.02 SOL (the link rule), or when the SOL, rules or chain cannot be read", async () => {
    chain.lamports = 7n * 2_039_280n + 20_000_000n - 1n;
    expect((await get("?setup=1")).setupAccounts).toBe(0);
    chain.lamports = null;
    expect((await get("?setup=1")).setupAccounts).toBe(0);
    chain.lamports = 1_000_000_000n;
    chain.existing = null;
    expect((await get("?setup=1")).setupAccounts).toBe(0);
    setRepoForTests(new MemoryRepo()); // no rules row: the read throws
    chain.existing = new Set();
    expect((await get("?setup=1")).setupAccounts).toBe(0);
  });

  it("a user with SKR only (stORE switched off): 0, and no chain read", async () => {
    const repo = new MemoryRepo();
    setRepoForTests(repo);
    await repo.upsertUser({ seedVaultPubkey: U, sgtMint: "M", skrName: null });
    await repo.saveRules(U, { pins: { stORE: 0 } } as never);
    expect((await get("?setup=1")).setupAccounts).toBe(0);
    expect(chain.multiReads).toBe(0);
  });
});
