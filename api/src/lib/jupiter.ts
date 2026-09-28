import { address, AccountRole, type Address, type Instruction } from "@solana/kit";
import { config } from "./config";

const BASE = "https://api.jup.ag";

export type JupiterIx = { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };

export type SwapInstructionsResponse = {
  computeBudgetInstructions: JupiterIx[];
  setupInstructions: JupiterIx[];
  swapInstruction: JupiterIx;
  cleanupInstruction: JupiterIx | null;
  addressLookupTableAddresses: string[];
};

export type Quote = { inAmount: string; outAmount: string; otherAmountThreshold: string; routePlan: unknown[] };

function headers(): Record<string, string> {
  return { "x-api-key": config().jupiterApiKey, "content-type": "application/json" };
}

/** Jupiter's instruction shape to kit's: signer and writable flags become one of the four account roles. */
export function toKitInstruction(j: JupiterIx): Instruction {
  return {
    programAddress: address(j.programId),
    accounts: j.accounts.map((a) => ({
      address: address(a.pubkey),
      role: a.isSigner
        ? a.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
        : a.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
    })),
    data: new Uint8Array(Buffer.from(j.data, "base64")),
  };
}

export const JUPITER_AGGREGATOR = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

/** Programs a setup or cleanup instruction may call: token accounts, tokens, system transfers, compute budget. */
const SETUP_PROGRAMS = new Set<string>([
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token-2022
  "11111111111111111111111111111111", // System
  "ComputeBudget111111111111111111111111111111",
]);

export type ParsedSwap = ReturnType<typeof parseSwapInstructions>;

/**
 * The puller signs whatever Jupiter's HTTP response contains, so the response is checked before it is signed (review I5):
 * the swap must be the Jupiter aggregator, setup and cleanup may only touch the programs above, nobody but the puller may be
 * a signer, and the fee account (and the destination, when one was requested) must appear in the swap.
 */
export function checkSwapInstructions(p: ParsedSwap, a: { puller: string; feeAccount?: string; destination?: string }): void {
  if (p.swap.programAddress !== JUPITER_AGGREGATOR) throw new Error(`Jupiter response refused: swap program is ${p.swap.programAddress}`);
  for (const [kind, ixs] of [["setup", p.setup], ["cleanup", p.cleanup ? [p.cleanup] : []], ["compute budget", p.computeBudget]] as const) {
    for (const ix of ixs) {
      if (!SETUP_PROGRAMS.has(ix.programAddress)) throw new Error(`Jupiter response refused: ${kind} program ${ix.programAddress} is not allowed`);
    }
  }
  const all = [...p.computeBudget, ...p.setup, p.swap, ...(p.cleanup ? [p.cleanup] : [])];
  for (const ix of all) {
    for (const acc of ix.accounts ?? []) {
      const signer = acc.role === AccountRole.READONLY_SIGNER || acc.role === AccountRole.WRITABLE_SIGNER;
      if (signer && acc.address !== a.puller) throw new Error(`Jupiter response refused: signer ${acc.address} is not the puller`);
    }
  }
  const swapAccounts = new Set((p.swap.accounts ?? []).map((x) => x.address as string));
  if (a.feeAccount && !swapAccounts.has(a.feeAccount)) throw new Error("Jupiter response refused: the fee account is missing from the swap");
  if (a.destination && !swapAccounts.has(a.destination)) throw new Error("Jupiter response refused: the destination account is missing from the swap");
}

export function parseSwapInstructions(r: SwapInstructionsResponse) {
  return {
    computeBudget: r.computeBudgetInstructions.map(toKitInstruction),
    setup: r.setupInstructions.map(toKitInstruction),
    swap: toKitInstruction(r.swapInstruction),
    cleanup: r.cleanupInstruction ? toKitInstruction(r.cleanupInstruction) : null,
    lookupTables: r.addressLookupTableAddresses.map((a) => address(a)) as Address[],
  };
}

export async function getQuote(a: {
  inputMint: Address; outputMint: Address; amountRaw: bigint; slippageBps?: number; maxAccounts?: number; onlyDirectRoutes?: boolean; platformFeeBps?: number;
}): Promise<Quote> {
  const q = new URLSearchParams({
    inputMint: a.inputMint, outputMint: a.outputMint, amount: a.amountRaw.toString(), slippageBps: String(a.slippageBps ?? 100),
    maxAccounts: String(a.maxAccounts ?? 24), onlyDirectRoutes: String(a.onlyDirectRoutes ?? false), restrictIntermediateTokens: "true",
    ...(a.platformFeeBps ? { platformFeeBps: String(a.platformFeeBps) } : {}),
  });
  const res = await fetch(`${BASE}/swap/v1/quote?${q}`, { headers: headers() });
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Quote;
}

/** The swap as separate instructions, so the pull and the stake can sit beside it in one transaction. */
export async function getSwapInstructions(a: { quote: Quote; userPublicKey: Address; destinationTokenAccount?: Address; feeAccount?: Address }) {
  const res = await fetch(`${BASE}/swap/v1/swap-instructions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      quoteResponse: a.quote, userPublicKey: a.userPublicKey, wrapAndUnwrapSol: false, dynamicComputeUnitLimit: true,
      ...(a.destinationTokenAccount ? { destinationTokenAccount: a.destinationTokenAccount } : {}),
      ...(a.feeAccount ? { feeAccount: a.feeAccount } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Jupiter swap-instructions failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return parseSwapInstructions((await res.json()) as SwapInstructionsResponse);
}

/** Current USD price of a mint from Jupiter's price API, or null when unknown. */
export async function priceUsd(mint: string): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}/price/v3?ids=${mint}`, { headers: headers() });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, { usdPrice?: number } | undefined>;
    const p = j[mint]?.usdPrice;
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}
