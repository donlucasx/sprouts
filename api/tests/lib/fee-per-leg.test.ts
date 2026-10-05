import { describe, it, expect, vi, afterEach } from "vitest";
import { address } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

vi.mock("@/lib/config", () => ({ config: () => ({ feeWallet: "8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6", jupiterApiKey: "k", heliusRpcUrl: "https://x" }) }));

import { swapFeeParams } from "@/lib/planting";
import { getQuote, getSwapInstructions } from "@/lib/jupiter";

const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const WSOL = address("So11111111111111111111111111111111111111112");

// R266 + Claude audit F1: Jupiter refuses feeAccount with fee 0 (400 NOT_SUPPORTED), which today became a charged SKR planting.
describe("the fee rides only on coin legs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("swapFeeParams: 50 bps into the fee wallet's USDC account for a coin leg, nothing for a lending leg", async () => {
    const [feeAta] = await findAssociatedTokenPda({ owner: address("8KiTtZXjcpxUGuH93G12iMVNcTYteTbRvaovdeQdfjc6"), mint: USDC, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    expect(await swapFeeParams("hSOL")).toEqual({ platformFeeBps: 50, feeAccount: feeAta });
    expect(await swapFeeParams("cbBTC")).toEqual({ platformFeeBps: 50, feeAccount: feeAta });
    expect(await swapFeeParams("SOL_LEND")).toEqual({});
    expect(await swapFeeParams("USDC_LEND")).toEqual({});
  });

  it("a quote without platformFeeBps and swap-instructions without feeAccount never mention a fee on the wire", async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { body?: string }) => {
      urls.push(url);
      if (init?.body) bodies.push(init.body);
      if (url.includes("/quote")) return new Response(JSON.stringify({ inputMint: USDC, outputMint: WSOL, inAmount: "1000000", outAmount: "8000000", otherAmountThreshold: "7920000", priceImpactPct: "0", routePlan: [] }));
      return new Response(JSON.stringify({ computeBudgetInstructions: [], setupInstructions: [], swapInstruction: { programId: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", accounts: [], data: "" }, cleanupInstruction: null, addressLookupTableAddresses: [] }));
    }));
    const quote = await getQuote({ inputMint: USDC, outputMint: WSOL, amountRaw: 1_000_000n, ...(await swapFeeParams("SOL_LEND")) });
    await getSwapInstructions({ quote, userPublicKey: USDC, ...(await swapFeeParams("SOL_LEND")) });
    expect(urls[0]).not.toContain("platformFeeBps");
    expect(JSON.parse(bodies[0])).not.toHaveProperty("feeAccount");
  });
});
