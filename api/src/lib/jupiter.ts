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

export type Quote = { inputMint: string; outputMint: string; inAmount: string; outAmount: string; otherAmountThreshold: string; priceImpactPct: string; routePlan: unknown[] };

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

const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TOKEN_PROGRAMS = new Set<string>(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
/** Token instruction tags Jupiter's setup and cleanup legitimately use: SyncNative (17) and CloseAccount (9), both on wSOL. */
const SYNC_NATIVE = 17;
const CLOSE_ACCOUNT = 9;

/**
 * Where each Jupiter v6 route instruction puts its output, by Anchor discriminator (sha256("global:<name>")[0..8]). The plain
 * routes carry `user_destination_token_account` at 3 and an optional `destination_token_account` at 4 (None is the Jupiter program
 * id; when set, the output goes there); the shared-accounts routes carry `destination_token_account` at 6. An instruction not in
 * this table (a newer layout) falls back to "present and writable".
 */
const OUTPUT_SLOTS: Record<string, { user: number; custom: number } | { shared: number }> = {
  e517cb977ae3ad2a: { user: 3, custom: 4 }, // route
  "96564774a75d0e68": { user: 3, custom: 4 }, // route_with_token_ledger
  d033ef977b2bed5c: { user: 3, custom: 4 }, // exact_out_route
  c1209b3341d69c81: { shared: 6 }, // shared_accounts_route
  e6798f50779f6aaa: { shared: 6 }, // shared_accounts_route_with_token_ledger
  b0d169a89a7d453e: { shared: 6 }, // shared_accounts_exact_out_route
};

export type ParsedSwap = ReturnType<typeof parseSwapInstructions>;
type KitIx = ParsedSwap["swap"];

const refuse = (why: string): never => { throw new Error(`Jupiter response refused: ${why}`); };

/**
 * One setup or cleanup instruction, decoded (security audit R207 #4): Program allowlists let a compromised response call
 * `System.transfer` or `Token.Approve`/`SetAuthority`/`Transfer` on the puller's accounts, so each instruction is read by its data.
 * Allowed, and nothing else: an ATA Create or CreateIdempotent paid by the puller for the puller's or the destination owner's
 * account; SyncNative on the puller's wSOL account; CloseAccount of the puller's wSOL account back to the puller; compute budget
 * (a duplicate of the transaction's own compute-budget instruction fails the whole transaction, so it cannot raise the fee). The
 * System program is refused outright: with `wrapAndUnwrapSol: false` Jupiter has no reason to move lamports.
 */
function checkHelperInstruction(kind: string, ix: KitIx, a: { puller: string; destinationOwner?: string; wsolAccount?: string }): void {
  const prog = ix.programAddress as string;
  const data = ix.data ?? new Uint8Array();
  const acc = (i: number) => ix.accounts?.[i]?.address as string | undefined;
  if (prog === COMPUTE_BUDGET) return;
  if (prog === ATA_PROGRAM) {
    // Create is tag 0 (or empty data, the legacy form); CreateIdempotent is 1; RecoverNested (2) moves tokens and is refused.
    if (!(data.length === 0 || (data.length === 1 && (data[0] === 0 || data[0] === 1)))) refuse(`${kind} associated-token instruction ${data[0]} is not a create`);
    if (acc(0) !== a.puller) refuse(`${kind} account creation is not paid by the puller`);
    const owner = acc(2);
    if (owner !== undefined && owner !== a.puller && owner !== a.destinationOwner) refuse(`${kind} account creation for ${owner}, who is neither the puller nor the destination's owner`);
    return;
  }
  if (TOKEN_PROGRAMS.has(prog)) {
    if (data.length !== 1 || (data[0] !== SYNC_NATIVE && data[0] !== CLOSE_ACCOUNT)) refuse(`${kind} token instruction ${data[0]} is not SyncNative or CloseAccount`);
    if (!a.wsolAccount || acc(0) !== a.wsolAccount) refuse(`${kind} token instruction on ${acc(0)}, not the puller's wSOL account`);
    if (data[0] === CLOSE_ACCOUNT && (acc(1) !== a.puller || acc(2) !== a.puller)) refuse(`${kind} CloseAccount pays ${acc(1)}, not the puller`);
    return;
  }
  refuse(`${kind} program ${prog} is not allowed`);
}

/**
 * The account the swap delivers to, at its decoded position (R207 #4): "present somewhere in the swap" let a response route the
 * output elsewhere and merely list the destination. Known route layouts must deliver to `destination` (for a plain route: the
 * custom slot when it is set, else the user slot); an unknown layout must at least list it writable.
 */
function checkOutput(swap: KitIx, destination: string): void {
  const accounts = swap.accounts ?? [];
  const at = (i: number) => accounts[i];
  const writable = (i: number) => at(i)?.role === AccountRole.WRITABLE || at(i)?.role === AccountRole.WRITABLE_SIGNER;
  const disc = Buffer.from((swap.data ?? new Uint8Array()).slice(0, 8)).toString("hex");
  const slots = OUTPUT_SLOTS[disc];
  if (!slots) {
    if (!accounts.some((x) => x.address === destination)) refuse("the destination account is missing from the swap");
    if (!accounts.some((x, i) => x.address === destination && writable(i))) refuse("the destination account is not writable in the swap");
    return;
  }
  const slot = "shared" in slots ? slots.shared : (at(slots.custom)?.address as string | undefined) === JUPITER_AGGREGATOR ? slots.user : slots.custom;
  if (!accounts.some((x) => x.address === destination)) refuse("the destination account is missing from the swap");
  if (at(slot)?.address !== destination || !writable(slot)) refuse(`the swap delivers to ${at(slot)?.address}, not the destination`);
}

/**
 * The puller signs whatever Jupiter's HTTP response contains, so the response is checked before it is signed (review I5, R207 #4):
 * the swap must be the Jupiter aggregator, each setup and cleanup instruction must be one of the decoded few above, compute budget
 * must be compute budget, nobody but the puller may be a signer, the fee account must appear in the swap, and the swap must deliver
 * to `destination` (the user's token account for a wallet coin, the puller's SKR account for SKR) in its output position.
 */
export function checkSwapInstructions(p: ParsedSwap, a: { puller: string; feeAccount?: string; destination?: string; destinationOwner?: string; wsolAccount?: string }): void {
  if (p.swap.programAddress !== JUPITER_AGGREGATOR) refuse(`swap program is ${p.swap.programAddress}`);
  for (const ix of p.computeBudget) if (ix.programAddress !== COMPUTE_BUDGET) refuse(`compute budget program ${ix.programAddress} is not allowed`);
  for (const ix of p.setup) checkHelperInstruction("setup", ix, a);
  if (p.cleanup) checkHelperInstruction("cleanup", p.cleanup, a);
  const all = [...p.computeBudget, ...p.setup, p.swap, ...(p.cleanup ? [p.cleanup] : [])];
  for (const ix of all) {
    for (const acc of ix.accounts ?? []) {
      const signer = acc.role === AccountRole.READONLY_SIGNER || acc.role === AccountRole.WRITABLE_SIGNER;
      if (signer && acc.address !== a.puller) refuse(`signer ${acc.address} is not the puller`);
    }
  }
  const swapAccounts = new Set((p.swap.accounts ?? []).map((x) => x.address as string));
  if (a.feeAccount && !swapAccounts.has(a.feeAccount)) refuse("the fee account is missing from the swap");
  if (a.destination) checkOutput(p.swap, a.destination);
}

/** The quote's mints against the registry's (spec 7.3): the only place a wrong coin could enter is Jupiter's answer, so it is checked before anything is signed. */
export function checkQuoteMints(q: Quote, expect: { inputMint: string; outputMint: string }): void {
  if (q.inputMint !== expect.inputMint) throw new Error(`Jupiter quote refused: input mint ${q.inputMint} is not ${expect.inputMint}`);
  if (q.outputMint !== expect.outputMint) throw new Error(`Jupiter quote refused: output mint ${q.outputMint} is not ${expect.outputMint}`);
}

/**
 * The quote's minimum against the slippage asked for (R207 #4): `otherAmountThreshold` is the aggregator's only on-chain floor and
 * the SKR stake's amount, so a response with the right mints and a threshold of 1 would let the route keep nearly everything.
 * Required: threshold >= floor(outAmount * (10_000 - slippageBps) / 10_000) - 1 (one raw unit for rounding), and not above outAmount.
 */
export function checkQuoteSlippage(q: Quote, slippageBps: number): void {
  let out: bigint, min: bigint;
  try {
    out = BigInt(q.outAmount);
    min = BigInt(q.otherAmountThreshold);
  } catch {
    return refuse(`quote amounts ${q.outAmount} / ${q.otherAmountThreshold} are not integers`);
  }
  const floor = (out * BigInt(10_000 - slippageBps)) / 10_000n - 1n;
  if (out <= 0n || min < floor || min > out) throw new Error(`Jupiter quote refused: minimum ${min} is outside ${floor}..${out} for ${slippageBps} bps`);
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
  const slippageBps = a.slippageBps ?? 100;
  const q = new URLSearchParams({
    inputMint: a.inputMint, outputMint: a.outputMint, amount: a.amountRaw.toString(), slippageBps: String(slippageBps),
    maxAccounts: String(a.maxAccounts ?? 24), onlyDirectRoutes: String(a.onlyDirectRoutes ?? false), restrictIntermediateTokens: "true",
    ...(a.platformFeeBps ? { platformFeeBps: String(a.platformFeeBps) } : {}),
  });
  const res = await fetch(`${BASE}/swap/v1/quote?${q}`, { headers: headers() });
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const quote = (await res.json()) as Quote;
  // Every caller gets a quote whose minimum matches the slippage it asked for (R207 #4).
  checkQuoteSlippage(quote, slippageBps);
  return quote;
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

export type PriceInfo = { usdPrice: number; liquidity: number | null; priceChange24h: number | null; decimals: number | null };

/** Several mints' prices in one call (the daily snapshot, spec 5.2); a mint the API does not know is simply absent. Throws on a failed call so the snapshot marks the day. */
export async function pricesUsd(mints: string[]): Promise<Record<string, PriceInfo>> {
  const res = await fetch(`${BASE}/price/v3?ids=${mints.join(",")}`, { headers: headers() });
  if (!res.ok) throw new Error(`Jupiter price failed: ${res.status}`);
  const j = (await res.json()) as Record<string, { usdPrice?: number; liquidity?: number; priceChange24h?: number; decimals?: number } | undefined>;
  const out: Record<string, PriceInfo> = {};
  for (const m of mints) {
    const p = j[m];
    if (!p || typeof p.usdPrice !== "number" || p.usdPrice <= 0) continue;
    out[m] = { usdPrice: p.usdPrice, liquidity: typeof p.liquidity === "number" ? p.liquidity : null, priceChange24h: typeof p.priceChange24h === "number" ? p.priceChange24h : null, decimals: typeof p.decimals === "number" ? p.decimals : null };
  }
  return out;
}
