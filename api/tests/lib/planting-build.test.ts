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
vi.mock("@/lib/rpc", () => ({ rpc: () => ({ getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "4wiD3N7FrBNJSmZUQDkGHM4CsvDrvyvx7G1FApLGEbJ1", lastValidBlockHeight: 1n } }) }) }) }));
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

import { buildPlantingTx } from "@/lib/planting";
import { SKR_MINT } from "@/lib/constants";
import { COINS } from "@/domain/coins";

const USER = address("52vzF8A1qEL7qTY7HiRnvTrXSMN4FkTANZ1DYKQBiF6e");
const base = { delegator: address("DdpHknAJvVsG8HYTAN3ZmSLLiPh2GfXP2pMoJJFa1p9m"), user: USER, pullRaw: 2_000_000n, feeBps: 50, delegationPda: address("ADaL11LqTrsaqMh5XkyVGV6nE2wPdvPaR7GgFSvvJWuD") };

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
