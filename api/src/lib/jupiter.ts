import { address, AccountRole, type Address, type Instruction } from "@solana/kit";
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "./config";
import { createTokenLane, PaceRefused, type Lane } from "./pace";

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

/** T21 minor (final review): every Jupiter call stops at 10 s, as the venue reads do (venues/rates.ts getJson). */
const timeout = () => AbortSignal.timeout(10_000);

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
/**
 * The one Token instruction Jupiter's setup or cleanup may carry: SyncNative (17) on the puller's wSOL. CloseAccount (9) is REFUSED
 * (Task 11 review I1): the puller's wSOL account pools every user's WSOL carry, and with `wrapAndUnwrapSol: false` Jupiter never
 * needs to close it; a close would unwrap the other users' carry into the puller's lamports.
 */
const SYNC_NATIVE = 17;

/**
 * Where each Jupiter v6 route instruction puts its output, by Anchor discriminator (sha256("global:<name>")[0..8]). The plain
 * routes carry `user_destination_token_account` at 3 and an optional `destination_token_account` at 4 (None is the Jupiter program
 * id; when set, the output goes there); the shared-accounts routes carry `destination_token_account` at 6. A swap instruction not
 * in this table is REFUSED (fail closed, by design): a new Jupiter layout stops plantings until its output slot is added here.
 * Live responses on 2026-10-03 (all six coins, 2 USDC) used only `route` (SKR, cbBTC, stORE) and `shared_accounts_route`
 * (hSOL, JitoSOL, JupSOL).
 */
// `source` (Task 11 review I1): where the route takes its input, `user_source_token_account` at 2 in the plain routes and
// `source_token_account` at 3 in the shared-accounts routes (Jupiter v6 IDL).
const OUTPUT_SLOTS: Record<string, ({ user: number; custom: number } | { shared: number }) & { source: number }> = {
  e517cb977ae3ad2a: { user: 3, custom: 4, source: 2 }, // route
  "96564774a75d0e68": { user: 3, custom: 4, source: 2 }, // route_with_token_ledger
  d033ef977b2bed5c: { user: 3, custom: 4, source: 2 }, // exact_out_route
  c1209b3341d69c81: { shared: 6, source: 3 }, // shared_accounts_route
  e6798f50779f6aaa: { shared: 6, source: 3 }, // shared_accounts_route_with_token_ledger
  b0d169a89a7d453e: { shared: 6, source: 3 }, // shared_accounts_exact_out_route
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
    if (data.length !== 1 || data[0] !== SYNC_NATIVE) refuse(`${kind} token instruction ${data[0]} is not SyncNative (a CloseAccount of the pooled wSOL is refused)`);
    if (!a.wsolAccount || acc(0) !== a.wsolAccount) refuse(`${kind} token instruction on ${acc(0)}, not the puller's wSOL account`);
    return;
  }
  refuse(`${kind} program ${prog} is not allowed`);
}

const swapLayout = (swap: KitIx) => {
  const disc = Buffer.from((swap.data ?? new Uint8Array()).slice(0, 8)).toString("hex");
  return { disc, slots: OUTPUT_SLOTS[disc] };
};

/**
 * The account the swap delivers to, at its decoded position (R207 #4): "present somewhere in the swap" let a response route the
 * output elsewhere and merely list the destination. The route must deliver to `destination` (for a plain route: the custom slot
 * when it is set, else the user slot), writable. Unknown layouts never get here (refused in checkSwapInstructions).
 */
function checkOutput(swap: KitIx, destination: string): void {
  const accounts = swap.accounts ?? [];
  const at = (i: number) => accounts[i];
  const writable = (i: number) => at(i)?.role === AccountRole.WRITABLE || at(i)?.role === AccountRole.WRITABLE_SIGNER;
  const { slots } = swapLayout(swap);
  if (!slots) return refuse("unknown swap layout");
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
export function checkSwapInstructions(p: ParsedSwap, a: { puller: string; feeAccount?: string; destination: string; destinationOwner?: string; wsolAccount?: string; source?: string }): void {
  if (p.swap.programAddress !== JUPITER_AGGREGATOR) refuse(`swap program is ${p.swap.programAddress}`);
  const { disc, slots } = swapLayout(p.swap);
  if (!slots) refuse(`swap instruction ${disc} is not a known route layout`);
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
  // Step 0 (T9, security scan): a destination is mandatory. Without one the output position went unchecked, so a lending leg that
  // reached the coin-swap path could be routed anywhere; every caller pins where the swap must deliver.
  if (!a.destination) refuse("no pinned destination: the swap's output position cannot be checked");
  checkOutput(p.swap, a.destination);
  // Task 11 review I1: the route must spend from `source` (the puller's USDC pull receiver), never another pooled float (its SKR, its wSOL).
  if (a.source !== undefined) {
    const at = (p.swap.accounts ?? [])[slots!.source]?.address as string | undefined;
    if (at !== a.source) refuse(`the swap spends from ${at}, not the puller's USDC account`);
  }
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

/**
 * An ExactOut quote's maximum against the slippage asked for (the SOL top-up): `otherAmountThreshold` is then the most input the route
 * may spend, so it must sit between inAmount and ceil(inAmount * (10_000 + slippageBps) / 10_000) + 1 (one raw unit for rounding).
 */
export function checkQuoteSlippageExactOut(q: Quote, slippageBps: number): void {
  let inn: bigint, max: bigint;
  try {
    inn = BigInt(q.inAmount);
    max = BigInt(q.otherAmountThreshold);
  } catch {
    return refuse(`quote amounts ${q.inAmount} / ${q.otherAmountThreshold} are not integers`);
  }
  const ceil = (inn * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n + 1n;
  if (inn <= 0n || max < inn || max > ceil) throw new Error(`Jupiter quote refused: maximum ${max} is outside ${inn}..${ceil} for ${slippageBps} bps`);
}

/** Jupiter answered 429 on every attempt. The planting run treats it as "busy", never as an outage. */
export class JupiterRateLimited extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JupiterRateLimited";
  }
}

/** Base waits before attempts 2 and 3; each is multiplied by a jitter in 0.5..1.5, and a Retry-After (seconds) wins, capped at 3 s. */
export const JUPITER_RETRY_MS: readonly number[] = [500, 1_500];
const RETRY_AFTER_CAP_MS = 3_000;

/**
 * Who is calling. Set with AsyncLocalStorage around a whole job, read by jupiterFetch; no store = a user-facing call (a price fallback,
 * the token search, a withdrawal's price).
 * 11-28 (Kimi Jupiter re-assessment fix 2; the free key allows 60 requests in any 60 s window, and the 11-27 40-a-minute run window
 * released its 40 in a burst): EVERY Jupiter call of the process, every attempt (a 429 retry too), takes a turn in ONE shared lane
 * (jupiterLaneTurn: a start at most every JUPITER_LANE_INTERVAL_MS, no bursts). A user or top-up call goes before a waiting run call;
 * nothing bypasses the lane.
 * - "run" (the planting runs, the cron's coin snapshot): a Retry-After honored up to JUPITER_RUN_RETRY_AFTER_CAP_MS, one more try
 *   after a window wait (JUPITER_RUN_WINDOW_WAIT_MS), and NO wait of any kind (a lane turn or a 429 wait) that would end past
 *   `deadlineMs` (the run's own "start no wallet" deadline): such a call fails at once as a rate limit ("jupiter busy").
 * - "topup" (the top-up build): JUPITER_TOPUP_RETRY_MS, all 429 waits together at most JUPITER_TOPUP_MAX_WAIT_MS; each lane turn at
 *   most JUPITER_USER_MAX_TURN_WAIT_MS away, else busy.
 * - no lane (user-facing): today's two retries; each lane turn at most JUPITER_USER_MAX_TURN_WAIT_MS away, else busy.
 */
export type JupiterLane = { kind: "run"; deadlineMs: number } | { kind: "topup" };
export const jupiterLane = new AsyncLocalStorage<JupiterLane>();
/** Runs `fn` with every Jupiter call in the run lane (lowest priority, deadline-bound waits). */
export const withJupiterRunLane = <T>(deadlineMs: number, fn: () => Promise<T>): Promise<T> => jupiterLane.run({ kind: "run", deadlineMs }, fn);
/** Runs `fn` with every Jupiter call on the top-up's longer 429 budget. */
export const withJupiterTopUpBudget = <T>(fn: () => Promise<T>): Promise<T> => jupiterLane.run({ kind: "topup" }, fn);

/** 11-28: the shared lane's spacing: about 55 starts a minute at most, under the key's 60 in any 60 s, with no burst. */
export const JUPITER_LANE_INTERVAL_MS = 1_100;
/** 11-28: a user-facing or top-up call whose lane turn is further away than this answers busy (a phone never waits on a long queue). */
export const JUPITER_USER_MAX_TURN_WAIT_MS = 8_000;
/** Run lane only: a Retry-After up to this is honored (it was cut to 3 s, shorter than any real window answer). */
export const JUPITER_RUN_RETRY_AFTER_CAP_MS = 20_000;
/** Run lane only: after the two short retries, one more try after a wait drawn evenly from this range (no Retry-After). */
export const JUPITER_RUN_WINDOW_WAIT_MS = [10_000, 20_000] as const;
/** Top-up lane: four retries, base waits jittered 0.5..1.5 like the default, all waits together cut to JUPITER_TOPUP_MAX_WAIT_MS. */
export const JUPITER_TOPUP_RETRY_MS: readonly number[] = [500, 1_500, 2_500, 3_000];
export const JUPITER_TOPUP_MAX_WAIT_MS = 8_000;

// The test suite runs without the process-wide lane (as rpc.ts's pace); the lane is tested by passing `pace` to jupiterFetch and in pace's own tests.
const sharedLane: Lane = createTokenLane({ intervalMs: process.env.VITEST ? 0 : JUPITER_LANE_INTERVAL_MS, label: "jupiter lane" });

export type JupiterFetchOptions = {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  /** The lane every attempt takes a turn in (default: the process-wide one). */
  pace?: Lane;
  /** The caller (default: the AsyncLocalStorage one). */
  lane?: JupiterLane;
};

export function isJupiterRateLimit(e: unknown): boolean {
  return e instanceof JupiterRateLimited || (e instanceof Error && /^Jupiter (quote|swap-instructions|price|token search) failed: 429\b/.test(e.message));
}

/** One Jupiter call, retried on 429 only. Any other status comes back to the caller, whose own error text stays as it was. */
export async function jupiterFetch(
  url: string, init: RequestInit, what: "quote" | "swap-instructions" | "price" | "token search",
  opts: JupiterFetchOptions | ((ms: number) => Promise<void>) = {},
): Promise<Response> {
  const o: JupiterFetchOptions = typeof opts === "function" ? { sleep: opts } : opts;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  const random = o.random ?? Math.random;
  const lane = o.lane ?? jupiterLane.getStore();
  const run = lane?.kind === "run" ? lane : null;
  const topup = lane?.kind === "topup";
  const schedule = topup ? JUPITER_TOPUP_RETRY_MS : JUPITER_RETRY_MS;
  const retries = schedule.length + (run ? 1 : 0);   // the run's one extra try after a window wait
  const raCap = run ? JUPITER_RUN_RETRY_AFTER_CAP_MS : RETRY_AFTER_CAP_MS;
  const pace = o.pace ?? sharedLane;
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    // Every attempt (a retry too) takes a turn in the shared lane; a turn past the caller's bound is never waited for.
    try {
      await pace(run ? { notAfterMs: run.deadlineMs, priority: "run" } : { notAfterMs: now() + JUPITER_USER_MAX_TURN_WAIT_MS, priority: "user" });
    } catch (e) {
      if (e instanceof PaceRefused) throw new JupiterRateLimited(`Jupiter ${what} failed: 429 not sent: the Jupiter lane has no turn ${run ? "before the run deadline" : "soon enough"}`);
      throw e;
    }
    const res = await fetch(url, { ...init, signal: timeout() });
    if (res.status !== 429) return res;
    const body = await res.text().catch(() => "");   // free the socket before waiting (an 8-worker burst would otherwise hold them until GC)
    if (attempt >= retries) throw new JupiterRateLimited(`Jupiter ${what} failed: 429 ${body.slice(0, 200)}`);
    const ra = Number(res.headers.get("retry-after"));
    let wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, raCap)
      : attempt < schedule.length ? Math.round(schedule[attempt] * (0.5 + random()))
      : Math.round(JUPITER_RUN_WINDOW_WAIT_MS[0] + random() * (JUPITER_RUN_WINDOW_WAIT_MS[1] - JUPITER_RUN_WINDOW_WAIT_MS[0]));
    if (topup) {
      wait = Math.min(wait, JUPITER_TOPUP_MAX_WAIT_MS - waited);
      if (wait <= 0) throw new JupiterRateLimited(`Jupiter ${what} failed: 429 ${body.slice(0, 200)}`);
    }
    if (run && now() + wait > run.deadlineMs) throw new JupiterRateLimited(`Jupiter ${what} failed: 429 (the next try would come after the run deadline) ${body.slice(0, 200)}`);
    waited += wait;
    await sleep(wait);
  }
}

export async function getQuote(a: {
  inputMint: Address; outputMint: Address; amountRaw: bigint; slippageBps?: number; maxAccounts?: number; onlyDirectRoutes?: boolean; platformFeeBps?: number;
  /** ExactOut: `amountRaw` is the output wanted (the SOL top-up); every planting leaves it unset (ExactIn). */
  swapMode?: "ExactIn" | "ExactOut";
  /** The SOL top-up only: route through these dexes alone (Jupiter labels), the ones the app can parse. Plantings leave it unset. */
  dexes?: readonly string[];
}): Promise<Quote> {
  const slippageBps = a.slippageBps ?? 100;
  const q = new URLSearchParams({
    inputMint: a.inputMint, outputMint: a.outputMint, amount: a.amountRaw.toString(), slippageBps: String(slippageBps),
    maxAccounts: String(a.maxAccounts ?? 24), onlyDirectRoutes: String(a.onlyDirectRoutes ?? false), restrictIntermediateTokens: "true",
    ...(a.platformFeeBps ? { platformFeeBps: String(a.platformFeeBps) } : {}),
    ...(a.swapMode === "ExactOut" ? { swapMode: "ExactOut" } : {}),
    ...(a.dexes?.length ? { dexes: a.dexes.join(",") } : {}),
  });
  const res = await jupiterFetch(`${BASE}/swap/v1/quote?${q}`, { headers: headers() }, "quote");
  if (!res.ok) throw new Error(`Jupiter quote failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const quote = (await res.json()) as Quote;
  // Every caller gets a quote whose minimum matches the slippage it asked for (R207 #4).
  if (a.swapMode === "ExactOut") checkQuoteSlippageExactOut(quote, slippageBps);
  else checkQuoteSlippage(quote, slippageBps);
  return quote;
}

/** The swap as separate instructions, so the pull and the stake can sit beside it in one transaction. */
export async function getSwapInstructions(a: {
  quote: Quote; userPublicKey: Address; destinationTokenAccount?: Address; feeAccount?: Address;
  /** The SOL top-up only: the user's own SOL is wrapped for the swap and the rest unwrapped after. Plantings keep it off. */
  wrapAndUnwrapSol?: boolean;
  /** The SOL top-up only: the priority fee's ceiling in lamports (Jupiter's "medium" level, capped). Plantings set their own. */
  maxPriorityLamports?: number;
  /** The SOL top-up only: Jupiter's shared-accounts route, so the AMMs swap through Jupiter's authority and never see the wallet. */
  useSharedAccounts?: boolean;
}) {
  const res = await jupiterFetch(`${BASE}/swap/v1/swap-instructions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      quoteResponse: a.quote, userPublicKey: a.userPublicKey, wrapAndUnwrapSol: a.wrapAndUnwrapSol ?? false, dynamicComputeUnitLimit: true,
      ...(a.maxPriorityLamports ? { prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: a.maxPriorityLamports, priorityLevel: "medium" } } } : {}),
      ...(a.destinationTokenAccount ? { destinationTokenAccount: a.destinationTokenAccount } : {}),
      ...(a.feeAccount ? { feeAccount: a.feeAccount } : {}),
      ...(a.useSharedAccounts !== undefined ? { useSharedAccounts: a.useSharedAccounts } : {}),
    }),
  }, "swap-instructions");
  if (!res.ok) throw new Error(`Jupiter swap-instructions failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return parseSwapInstructions((await res.json()) as SwapInstructionsResponse);
}

/** Current USD price of a mint from Jupiter's price API, or null when unknown. */
export async function priceUsd(mint: string): Promise<number | null> {
  try {
    // 11-23 (carousel day, a top-up refused on "Jupiter price failed: 429"): prices retry a 429 like quotes do.
    const res = await jupiterFetch(`${BASE}/price/v3?ids=${mint}`, { headers: headers() }, "price");
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, { usdPrice?: number } | undefined>;
    const p = j[mint]?.usdPrice;
    return typeof p === "number" && p > 0 ? p : null;
  } catch {
    return null;
  }
}

export type PriceInfo = { usdPrice: number; liquidity: number | null; priceChange24h: number | null; decimals: number | null };

/** Several mints' prices in one call (the top-up's price bound and its source list); a mint the API does not know is simply absent. Throws on a failed call; after three 429s it throws JupiterRateLimited (11-23). */
export async function pricesUsd(mints: string[]): Promise<Record<string, PriceInfo>> {
  // 11-23: a 429 is retried (jupiterFetch); after the last attempt it throws "Jupiter price failed: 429 ..." as before.
  const res = await jupiterFetch(`${BASE}/price/v3?ids=${mints.join(",")}`, { headers: headers() }, "price");
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

export type JupiterToken = { symbol: string; decimals: number; verified: boolean; tokenProgram: string };

/**
 * Jupiter's token search for one mint (Tokens API v2): its symbol, decimals, token program and whether Jupiter verified it; null when
 * Jupiter does not know it. Throws on a failed call. The any-coin top-up (Task 7) lists only verified coins of the classic Token program.
 */
export async function jupiterToken(mint: string): Promise<JupiterToken | null> {
  // 11-25 (server queue): through jupiterFetch, so a 429 is retried like every other Jupiter call on the top-up path.
  const res = await jupiterFetch(`${BASE}/tokens/v2/search?query=${encodeURIComponent(mint)}`, { headers: headers() }, "token search");
  if (!res.ok) throw new Error(`Jupiter token search failed: ${res.status}`);
  const list = (await res.json()) as { id?: unknown; symbol?: unknown; decimals?: unknown; isVerified?: unknown; tokenProgram?: unknown }[];
  const t = Array.isArray(list) ? list.find((x) => x?.id === mint) : undefined;
  if (!t || typeof t.symbol !== "string" || typeof t.decimals !== "number" || typeof t.tokenProgram !== "string") return null;
  return { symbol: t.symbol, decimals: t.decimals, verified: t.isVerified === true, tokenProgram: t.tokenProgram };
}
