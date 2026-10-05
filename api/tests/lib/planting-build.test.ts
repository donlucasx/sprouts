import { describe, it, expect, vi, beforeEach } from "vitest";
import { address, generateKeyPairSigner, type KeyPairSigner } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

// Security audit R207 #2 and #4 at the builder: the SKR stake takes the quote's minimum plus the carry the run passed, and the
// Jupiter response is checked for delivery into the puller's own SKR account (SKR) or the user's token account (a wallet coin).
let puller: KeyPairSigner;
const stakes: bigint[] = [];
const checks: Record<string, unknown>[] = [];

vi.mock("@/lib/puller", () => ({ pullerSigner: vi.fn(async () => puller) }));
vi.mock("@/lib/config", () => ({ config: () => ({ feeWallet: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6", heliusRpcUrl: "https://x" }) }));
const tokenAccount = (amount: bigint) => { const b = Buffer.alloc(165); b.writeBigUInt64LE(amount, 64); return b.toString("base64"); };
const simCalls: { addresses: string[] }[] = [];
let preAmount: bigint | null = 5_000n;
let postAmount = 5_200n;
vi.mock("@/lib/rpc", () => ({ rpc: () => ({
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1", lastValidBlockHeight: 1n } }) }),
  getAccountInfo: () => ({ send: async () => ({ value: preAmount === null ? null : { data: [tokenAccount(preAmount), "base64"] } }) }),
  simulateTransaction: (_tx: string, cfg: { accounts: { addresses: string[] } }) => ({ send: async () => { simCalls.push(cfg.accounts); return { value: { err: null, logs: [], unitsConsumed: 1n, accounts: [{ data: [tokenAccount(postAmount), "base64"] }] } }; } }),
}) }));
vi.mock("@/lib/subscriptions", () => ({ buildTransferRecurringIx: vi.fn(async () => ({ programAddress: "De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44", accounts: [], data: new Uint8Array() })) }));
vi.mock("@/lib/staking", async (orig) => {
  const real = await orig<typeof import("@/lib/staking")>();
  return { ...real, buildStakeIx: vi.fn(async (a: Parameters<typeof real.buildStakeIx>[0]) => { stakes.push(a.amountRaw); return real.buildStakeIx(a); }) };
});
vi.mock("@/lib/jupiter", async (orig) => {
  const real = await orig<typeof import("@/lib/jupiter")>();
  return {
    ...real,
    getQuote: vi.fn(async (a: { outputMint: string }) => ({ inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", outputMint: a.outputMint, inAmount: "2000000", outAmount: "1000000", otherAmountThreshold: "990000", priceImpactPct: "0", routePlan: [] })),
    getSwapInstructions: vi.fn(async () => ({ computeBudget: [], setup: [], swap: { programAddress: real.JUPITER_AGGREGATOR, accounts: [], data: new Uint8Array() }, cleanup: null, lookupTables: [] })),
    checkSwapInstructions: vi.fn((p: unknown, a: Record<string, unknown>) => { checks.push(a); }),
  };
});

import { buildPlantingTx, simulatePlanting, tokenAmountOf } from "@/lib/planting";
import { SKR_MINT } from "@/lib/constants";
import { COINS } from "@/domain/coins";

const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
const base = { delegator: address("DdpHknAJvVsG8HYTAN3ZmSLLiPh2GfXP2pMoJJFa1p9m"), user: USER, pullRaw: 2_000_000n, delegationPda: address("ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD") };

describe("buildPlantingTx (R207 #2, #4)", () => {
  beforeEach(async () => { puller = await generateKeyPairSigner(); stakes.length = 0; checks.length = 0; });

  it("stakes the quote's minimum plus the carried remainder, and checks delivery into the puller's own SKR account", async () => {
    const b = await buildPlantingTx({ ...base, asset: "SKR", skrCarryRaw: 1234n });
    expect(stakes).toEqual([990_000n + 1234n]);
    expect(b.minOutRaw).toBe(990_000n);
    const [pullerSkr] = await findAssociatedTokenPda({ owner: puller.address, mint: SKR_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    const [wsol] = await findAssociatedTokenPda({ owner: puller.address, mint: address("So11111111111111111111111111111111111111112"), tokenProgram: TOKEN_PROGRAM_ADDRESS });
    expect(checks[0]).toMatchObject({ puller: puller.address, destination: pullerSkr, wsolAccount: wsol });
    expect(checks[0].destinationOwner).toBeUndefined();
  });

  it("Step 0 (T9): refuses both lending legs before any quote, and every coin leg's check gets a pinned destination", async () => {
    const { getQuote } = await import("@/lib/jupiter");
    vi.mocked(getQuote).mockClear();
    await expect(buildPlantingTx({ ...base, asset: "USDC_LEND" })).rejects.toThrow(/lending leg/);
    await expect(buildPlantingTx({ ...base, asset: "SOL_LEND" })).rejects.toThrow(/lending leg/);
    expect(getQuote).not.toHaveBeenCalled();
    expect(checks).toEqual([]);
    for (const asset of ["SKR", "stORE", "hSOL", "cbBTC"] as const) await buildPlantingTx({ ...base, asset });
    expect(checks.length).toBe(4);
    for (const c of checks) expect(typeof c.destination === "string" && (c.destination as string).length > 0).toBe(true);
  });

  it("without a carry stakes the minimum alone", async () => {
    await buildPlantingTx({ ...base, asset: "SKR" });
    expect(stakes).toEqual([990_000n]);
  });

  it("a wallet coin is checked for delivery into the user's token account, whose owner may get an account created", async () => {
    await buildPlantingTx({ ...base, asset: "hSOL", skrCarryRaw: 1234n });
    expect(stakes).toEqual([]);
    const [userAta] = await findAssociatedTokenPda({ owner: USER, mint: COINS.hSOL.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    expect(checks[0]).toMatchObject({ destination: userAta, destinationOwner: USER });
  });
});

describe("simulatePlanting reports the delivery account's balance before and after (R207 review)", () => {
  beforeEach(async () => { puller = await generateKeyPairSigner(); simCalls.length = 0; });
  it("reads the account the planting delivers to, before and as the simulation leaves it", async () => {
    const b = await buildPlantingTx({ ...base, asset: "SKR" });
    preAmount = 5_000n; postAmount = 5_200n;
    const s = await simulatePlanting(b);
    expect(simCalls[0].addresses).toEqual([b.deliveryAccount]);
    expect(s.delivery).toEqual({ pre: 5_000n, post: 5_200n });
    const [pullerSkr] = await findAssociatedTokenPda({ owner: puller.address, mint: SKR_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    expect(b.deliveryAccount).toBe(pullerSkr);
    preAmount = null; // a wallet coin's account created in the transaction starts at zero
    expect((await simulatePlanting(b)).delivery).toEqual({ pre: 0n, post: 5_200n });
  });
  it("decodes a token account's amount and refuses a short buffer", () => {
    expect(tokenAmountOf(new Uint8Array(Buffer.from(tokenAccount(123n), "base64")))).toBe(123n);
    expect(tokenAmountOf(null)).toBe(0n);
    expect(() => tokenAmountOf(new Uint8Array(10))).toThrow(/not a token account/);
  });
});
