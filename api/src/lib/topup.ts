import { AccountRole, address, getBase64Encoder, getProgramDerivedAddress, type Address, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { checkQuoteMints, getQuote, getSwapInstructions, JUPITER_AGGREGATOR } from "./jupiter";
import { SYSTEM_PROGRAM, USDC_MINT, WSOL_MINT } from "./constants";
import { COINS } from "@/domain/coins";
import { RECEIPT } from "./venues/addresses";
import { buildUserTransaction } from "./user-tx";
import { rpc } from "./rpc";

/**
 * The SOL top-up (10-22, owner-approved): round-ups are pulled only as USDC, and most Seeker wallets hold SOL, so a wallet the daily run
 * paused for want of USDC can swap some of its own SOL to USDC in one signature. The user signs and pays; Sprouts takes no fee, holds
 * nothing and moves nothing on its own. ExactOut: the user asked for "$5 of USDC", so the swap delivers exactly that many USDC base units
 * and spends at most the quote's maximum SOL (the wrap), the rest unwrapped back in the same transaction.
 */
export const TOPUP_DEFAULT_CENTS = 500;
export const TOPUP_MIN_CENTS = 200;
export const TOPUP_MAX_CENTS = 2_500;
/** The amounts the app offers (app/src/lib/topup.ts TOPUP_CHOICES), in cents. */
export const TOPUP_OFFERS = [500, 1_000, 2_500] as const;
/**
 * 10-27 (his ruling: one "Add USDC" button; SOL is never the user's problem): which offers this wallet's SOL covers, at `solUsd`, with
 * the swap's 1% slippage, the 0.001 SOL priority fee and SOL_RESERVE_LAMPORTS kept back, never past TOPUP_MAX_LAMPORTS. Empty: the app
 * shows the wallet's address to send USDC to instead. A rough gate only: the build route quotes and checks the real amount.
 */
export function affordableTopUps(solLamports: bigint, solUsd: number): number[] {
  if (!(solUsd > 0)) return [];
  const spare = solLamports - SOL_RESERVE_LAMPORTS - TOPUP_MAX_PRIORITY_LAMPORTS;
  return TOPUP_OFFERS.filter((cents) => {
    const need = BigInt(Math.ceil(((cents / 100) / solUsd) * 1e9 * (1 + TOPUP_MAX_SLIPPAGE_BPS / 10_000)));
    return need <= spare && need <= TOPUP_MAX_LAMPORTS;
  });
}

/** Kept in the wallet for network fees and rent after the top-up (about 0.01 SOL). */
export const SOL_RESERVE_LAMPORTS = 10_000_000n;
export const TOPUP_SLIPPAGE_BPS = 50;
/** The ceiling the app and this check accept on the slippage a top-up swap carries. */
export const TOPUP_MAX_SLIPPAGE_BPS = 100;
/** The priority fee asked of Jupiter, and the ceiling the check accepts (limit x price), in lamports. */
export const TOPUP_PRIORITY_LAMPORTS = 100_000;
export const TOPUP_MAX_PRIORITY_LAMPORTS = 1_000_000n;
/** Never more than 1 SOL leaves the wallet in a top-up (the app holds the same ceiling, sign.ts TOPUP_MAX_LAMPORTS). */
export const TOPUP_MAX_LAMPORTS = 1_000_000_000n;
/**
 * The dexes a top-up quote may route through: the ones whose Swap variant the app can parse (sign.ts SWAP_VARIANTS). Meteora DLMM has
 * no ExactOut route; Raydium AMM v4 is a variant (105 today) past the IDL the app pins.
 */
export const TOPUP_DEXES = ["Raydium CLMM", "Whirlpool"] as const;
/** A v0 transaction's wire limit; the top-up is compiled without a lookup table (the app refuses one), so the route must fit. */
const MAX_WIRE_BYTES = 1232;

export const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const TOKEN = TOKEN_PROGRAM_ADDRESS as string;
const ATA = ASSOCIATED_TOKEN_PROGRAM_ADDRESS as string;
const SYSTEM = SYSTEM_PROGRAM as string;
const ATA_CREATE_IDEMPOTENT = 1;
const SYNC_NATIVE = 17;
const CLOSE_ACCOUNT = 9;
const SYSTEM_TRANSFER = 2;
const DEFAULT_CU_LIMIT = 1_400_000n;

/**
 * Jupiter v6 shared_accounts_exact_out_route, the only swap a top-up may carry (the API asks useSharedAccounts): the AMMs swap through
 * Jupiter's program authority, so the wallet and its token accounts sit only in the fixed slots. Data, Borsh (Jupiter v6 IDL):
 * discriminator, id u8, route_plan Vec<RoutePlanStep { swap: Swap, percent u8, input_index u8, output_index u8 }>, out_amount u64,
 * quoted_in_amount u64, slippage_bps u16, platform_fee_bps u8, nothing after. Swap variants: only those whose payload size is pinned
 * (Whirlpool { a_to_b: bool } 17, RaydiumClmm 26, RaydiumClmmV2 40), as the app (sign.ts parseSharedExactOut).
 */
const SHARED_EXACT_OUT = "b0d169a89a7d453e";
const SWAP_VARIANTS: Readonly<Record<number, number>> = Object.freeze({ 17: 1, 26: 0, 40: 0 });
const JUPITER_AUTHORITIES = 8;
const MAX_ROUTE_STEPS = 4;
const JUPITER_EVENT_AUTHORITY = "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf";

export type TopUpIx = { program: string; accounts: string[]; signers?: string[]; data: Uint8Array };
export type TopUpPlan = { outRaw: bigint; quotedInLamports: bigint; wrapLamports: bigint; slippageBps: number };
/** Jupiter's program authority for an id, and its own wSOL and USDC accounts (shared_accounts_exact_out_route slots 1, 4, 5). */
export type JupiterAuthority = { authority: string; wsol: string; usdc: string };
/** What checkTopUp compares against, all derived from the wallet alone (topUpAccounts). */
export type TopUpAccounts = { wsolAta: string; usdcAta: string; foreign: readonly string[]; authorities: readonly JupiterAuthority[] };

const no = (why: string): never => { throw new Error(`Top-up refused: ${why}`); };
const u16At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(at, true);
const u32At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(at, true);
const u64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(at, true);
const same = (ix: TopUpIx, expected: readonly string[]) => ix.accounts.length === expected.length && expected.every((e, i) => ix.accounts[i] === e);

const ataOf = async (owner: Address, mint: Address, tokenProgram: Address = TOKEN_PROGRAM_ADDRESS) => (await findAssociatedTokenPda({ owner, mint, tokenProgram }))[0] as string;
/** The mints whose accounts the wallet may hold beside SOL and USDC: the coins (live and retired) and the lending receipts. */
const FOREIGN_MINTS: readonly Address[] = [
  ...Object.values(COINS).map((c) => c.mint).filter((m) => m !== USDC_MINT && m !== WSOL_MINT),
  ...Object.values(RECEIPT).flatMap((v) => Object.values(v).map((r) => r.mint)),
];
let authorities: Promise<JupiterAuthority[]> | null = null;
const jupiterAuthorities = () =>
  (authorities ??= Promise.all(
    Array.from({ length: JUPITER_AUTHORITIES }, async (_, id) => {
      const [authority] = await getProgramDerivedAddress({ programAddress: address(JUPITER_AGGREGATOR), seeds: ["authority", new Uint8Array([id])] });
      return { authority, wsol: await ataOf(authority, WSOL_MINT), usdc: await ataOf(authority, USDC_MINT) };
    }),
  ));

export async function topUpAccounts(user: Address): Promise<TopUpAccounts> {
  const [wsolAta, usdcAta, foreign, auth] = await Promise.all([
    ataOf(user, WSOL_MINT),
    ataOf(user, USDC_MINT),
    Promise.all([
      ...FOREIGN_MINTS.flatMap((m) => [ataOf(user, m), ataOf(user, m, TOKEN_2022_PROGRAM_ADDRESS)]),
      ataOf(user, WSOL_MINT, TOKEN_2022_PROGRAM_ADDRESS),
      ataOf(user, USDC_MINT, TOKEN_2022_PROGRAM_ADDRESS),
    ]),
    jupiterAuthorities(),
  ]);
  return { wsolAta, usdcAta, foreign, authorities: auth };
}

/** The swap's data read the way Jupiter's program reads it; anything it cannot read in full, or with bytes left over, refuses. */
export function parseSharedExactOut(d: Uint8Array): { id: number; outAmount: bigint; quotedIn: bigint; slippageBps: number; feeBps: number } {
  if (d.length < 13 || Buffer.from(d.slice(0, 8)).toString("hex") !== SHARED_EXACT_OUT) no("the swap is not Jupiter's shared-accounts ExactOut route");
  const id = d[8], steps = u32At(d, 9);
  if (id >= JUPITER_AUTHORITIES || steps < 1 || steps > MAX_ROUTE_STEPS) no(`the swap's id ${id} or route length ${steps} is not one Jupiter builds`);
  let at = 13;
  for (let s = 0; s < steps; s++) {
    if (at >= d.length) no("the route plan is cut short");
    const payload = SWAP_VARIANTS[d[at]];
    if (payload === undefined) no(`swap variant ${d[at]} is not one a top-up may use`);
    at++;
    if (at + payload + 3 > d.length) no("the route plan is cut short");
    for (let b = 0; b < payload; b++) if (d[at + b] > 1) no("a route step's flag is not a bool");
    at += payload;
    if (d[at] < 1 || d[at] > 100) no(`a route step's percent ${d[at]} is out of range`);
    at += 3;
  }
  if (d.length - at !== 19) no(`the swap data has ${d.length - at} bytes after the route plan, not 19`);
  return { id, outAmount: u64At(d, at), quotedIn: u64At(d, at + 8), slippageBps: u16At(d, at + 16), feeBps: d[at + 18] };
}

/**
 * What a top-up transaction may hold, and nothing else (the app runs the same check before the wallet is asked, sign.ts 'topup'):
 * compute budget (a limit and a price, the priority fee at most 0.001 SOL); create the user's wSOL and USDC accounts (optional, paid by
 * the user); move SOL into the user's own wSOL account, then SyncNative; ONE Jupiter shared_accounts_exact_out_route (its data parsed
 * in full, its 13 fixed accounts pinned, the wallet and its token accounts nowhere in the route accounts) from that wSOL account into the
 * user's USDC account, USDC out, no platform fee, slippage at most 1%, the wrap no larger than the swap's own maximum, at most 1 SOL; then
 * close the wSOL account back to the user. The user is the only signer; none of its other token accounts appears anywhere. `outRaw`,
 * when given, is the USDC the screen promised. The SOL price bound is the app's alone (sign.ts): it reads a price this API never touches.
 */
export function checkTopUp(ixs: TopUpIx[], a: TopUpAccounts & { user: string; outRaw?: bigint }): TopUpPlan {
  const allowed = new Set([COMPUTE_BUDGET, ATA, SYSTEM, TOKEN, JUPITER_AGGREGATOR]);
  const foreign = new Set(a.foreign);
  for (const ix of ixs) {
    if (!allowed.has(ix.program)) no(`program ${ix.program} is not used by a top-up`);
    for (const s of ix.signers ?? []) if (s !== a.user) no(`signer ${s} is not the wallet`);
    for (const acc of ix.accounts) if (foreign.has(acc)) no(`the wallet's other token account ${acc} is in the transaction`);
  }
  let i = 0;
  let cuLimit: bigint | null = null, cuPrice: bigint | null = null;
  for (; i < ixs.length && ixs[i].program === COMPUTE_BUDGET; i++) {
    const d = ixs[i].data;
    if (ixs[i].accounts.length !== 0) no("a compute budget instruction carries accounts");
    if (d.length === 5 && d[0] === 2 && cuLimit === null) cuLimit = BigInt(u32At(d, 1));
    else if (d.length === 9 && d[0] === 3 && cuPrice === null) cuPrice = u64At(d, 1);
    else no("a compute budget instruction other than one limit and one price");
  }
  if (((cuLimit ?? DEFAULT_CU_LIMIT) * (cuPrice ?? 0n) + 999_999n) / 1_000_000n > TOPUP_MAX_PRIORITY_LAMPORTS) no("the priority fee is above 0.001 SOL");
  let wsolCreate = false, usdcCreate = false, wrapLamports: bigint | null = null, synced = false;
  for (; i < ixs.length && ixs[i].program !== JUPITER_AGGREGATOR; i++) {
    const ix = ixs[i];
    if (ix.program === ATA) {
      if (ix.data.length !== 1 || ix.data[0] !== ATA_CREATE_IDEMPOTENT) no("an account instruction that is not CreateIdempotent");
      if (!wsolCreate && wrapLamports === null && same(ix, [a.user, a.wsolAta, a.user, WSOL_MINT, SYSTEM, TOKEN])) wsolCreate = true;
      else if (!usdcCreate && same(ix, [a.user, a.usdcAta, a.user, USDC_MINT, SYSTEM, TOKEN])) usdcCreate = true;
      else no("an account creation other than the wallet's own wSOL or USDC account");
    } else if (ix.program === SYSTEM) {
      if (wrapLamports !== null || ix.data.length !== 12 || u32At(ix.data, 0) !== SYSTEM_TRANSFER || !same(ix, [a.user, a.wsolAta])) no("a SOL transfer other than one into the wallet's own wSOL account");
      wrapLamports = u64At(ix.data, 4);
    } else if (ix.program === TOKEN) {
      if (synced || wrapLamports === null || ix.data.length !== 1 || ix.data[0] !== SYNC_NATIVE || !same(ix, [a.wsolAta])) no("a token instruction before the swap other than one SyncNative of the wSOL account");
      synced = true;
    } else no(`a ${ix.program} instruction before the swap`);
  }
  if (wrapLamports === null || !synced) no("the SOL is not wrapped before the swap");
  const swap = ixs[i++];
  if (!swap || swap.program !== JUPITER_AGGREGATOR) no("no Jupiter swap");
  const route = parseSharedExactOut(swap.data);
  const auth = a.authorities[route.id];
  if (!auth) no(`no Jupiter program authority for id ${route.id}`);
  // The 13 fixed accounts (IDL order): token program, program authority, transfer authority, source, program source, program
  // destination, destination, source mint, destination mint, platform fee (None), token-2022 (None), event authority, program.
  const fixed = [TOKEN, auth.authority, a.user, a.wsolAta, auth.wsol, auth.usdc, a.usdcAta, WSOL_MINT, USDC_MINT, JUPITER_AGGREGATOR, JUPITER_AGGREGATOR, JUPITER_EVENT_AUTHORITY, JUPITER_AGGREGATOR] as string[];
  if (swap.accounts.length <= fixed.length) no("the swap has no route accounts");
  fixed.forEach((want, k) => {
    if (swap.accounts[k] !== want) no(`the swap's account ${k} is ${swap.accounts[k]}, not ${want}`);
  });
  const mine = new Set([a.user, a.wsolAta, a.usdcAta]);
  if (swap.accounts.slice(fixed.length).some((acc) => mine.has(acc))) no("the wallet or its own token accounts are in the route accounts");
  const { outAmount: outRaw, quotedIn, slippageBps, feeBps } = route;
  if (feeBps !== 0) no("the swap carries a platform fee");
  if (slippageBps > TOPUP_MAX_SLIPPAGE_BPS) no(`slippage ${slippageBps} bps is above ${TOPUP_MAX_SLIPPAGE_BPS}`);
  if (a.outRaw !== undefined ? outRaw !== a.outRaw : outRaw < BigInt(TOPUP_MIN_CENTS) * 10_000n || outRaw > BigInt(TOPUP_MAX_CENTS) * 10_000n) no(`the swap delivers ${outRaw}, not the amount asked`);
  const maxIn = (quotedIn * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n + 1n;
  if (quotedIn <= 0n || wrapLamports! > maxIn) no("the SOL wrapped is above the swap's maximum");
  if (maxIn > TOPUP_MAX_LAMPORTS) no("the swap may spend more than 1 SOL");
  const close = ixs[i++];
  if (!close || close.program !== TOKEN || close.data.length !== 1 || close.data[0] !== CLOSE_ACCOUNT || !same(close, [a.wsolAta, a.user, a.user])) no("the wSOL account is not closed back to the wallet after the swap");
  if (i !== ixs.length) no("an instruction after the unwrap");
  return { outRaw, quotedInLamports: quotedIn, wrapLamports: wrapLamports!, slippageBps };
}

/** kit's instruction as the check reads it (signers from the roles). */
export function toTopUpIx(ix: Instruction): TopUpIx {
  const accounts = (ix.accounts ?? []) as readonly { address: string; role: AccountRole }[];
  return {
    program: ix.programAddress as string,
    accounts: accounts.map((x) => x.address),
    signers: accounts.filter((x) => x.role === AccountRole.READONLY_SIGNER || x.role === AccountRole.WRITABLE_SIGNER).map((x) => x.address),
    data: new Uint8Array(ix.data ?? []),
  };
}

const sol = (lamports: bigint) => (Number(lamports) / 1e9).toFixed(3);
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** A refusal the app shows as it is (status 400 or 409), never a transaction. */
export class TopUpRefused extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "TopUpRefused";
  }
}

export const TOPUP_COPY = {
  noSol: (cents: number, needLamports: bigint, haveLamports: bigint) =>
    `Not enough SOL. Adding ${dollars(cents)} of USDC needs about ${sol(needLamports)} SOL plus 0.01 SOL kept for fees, and this wallet has ${sol(haveLamports)} SOL.`,
  noRoute: "Sprouts could not get a SOL to USDC price just now. Nothing was asked of your wallet. Try again in a minute.",
  tooBig: "Sprouts could not fit this swap in one transaction just now. Nothing was asked of your wallet. Try again in a minute.",
  wouldFail: "This top-up would fail on chain, so nothing was asked of your wallet. Try again in a minute.",
} as const;

/** The confirm route's answers (api/topup/confirm). */
export const TOPUP_CONFIRM = {
  notTopUp: "This is not a Sprouts top-up, so nothing was sent.",
  notMarked: "Could not start the top-up. Nothing moved. Try again.",
  failed: "The swap failed on chain. Your SOL stayed in your wallet, less the network fee.",
  expired: "The top-up did not go through. Nothing moved. Try again.",
  pending: "Your top-up was sent but is not confirmed yet. Check Home in a minute before you try again.",
} as const;

/**
 * The unsigned top-up for `user` (the Seed Vault wallet, fee payer and only signer): a Jupiter ExactOut quote SOL to USDC for `cents`,
 * the balance check (the quote's maximum SOL plus SOL_RESERVE_LAMPORTS), Jupiter's instructions checked (checkTopUp), compiled with no
 * lookup table, and simulated. Throws TopUpRefused with the sentence to show.
 */
export async function buildTopUp(user: Address, cents: number): Promise<{ transaction: string; usdcRaw: string; maxLamports: string }> {
  const outRaw = BigInt(cents) * 10_000n;
  const accounts = await topUpAccounts(user);
  let quote;
  try {
    quote = await getQuote({ inputMint: WSOL_MINT, outputMint: USDC_MINT, amountRaw: outRaw, slippageBps: TOPUP_SLIPPAGE_BPS, swapMode: "ExactOut", maxAccounts: 20, dexes: TOPUP_DEXES });
    checkQuoteMints(quote, { inputMint: WSOL_MINT, outputMint: USDC_MINT });
  } catch (e) {
    console.error(`topup: no quote for ${user} (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.noRoute, 503);
  }
  const maxIn = BigInt(quote.otherAmountThreshold);
  const { value: balance } = await rpc().getBalance(user, { commitment: "confirmed" }).send();
  if (BigInt(balance) < maxIn + SOL_RESERVE_LAMPORTS) throw new TopUpRefused(TOPUP_COPY.noSol(cents, maxIn, BigInt(balance)), 409);
  let parsed;
  try {
    parsed = await getSwapInstructions({ quote, userPublicKey: user, wrapAndUnwrapSol: true, maxPriorityLamports: TOPUP_PRIORITY_LAMPORTS, useSharedAccounts: true });
  } catch (e) {
    console.error(`topup: no swap instructions for ${user} (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.noRoute, 503);
  }
  const ixs = [...parsed.computeBudget, ...parsed.setup, parsed.swap, ...(parsed.cleanup ? [parsed.cleanup] : [])];
  try {
    const plan = checkTopUp(ixs.map(toTopUpIx), { user, ...accounts, outRaw });
    if (plan.wrapLamports > maxIn) throw new Error("Top-up refused: the wrap is above the quote's maximum");
  } catch (e) {
    console.error(`topup: Jupiter's answer for ${user} refused (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.noRoute, 503);
  }
  // Static accounts only (the app refuses a lookup table it cannot read): the route was asked for at most 20 accounts.
  const transaction = await buildUserTransaction(user, ixs);
  if (getBase64Encoder().encode(transaction).length > MAX_WIRE_BYTES) throw new TopUpRefused(TOPUP_COPY.tooBig, 503);
  const sim = await rpc().simulateTransaction(transaction as Parameters<ReturnType<typeof rpc>["simulateTransaction"]>[0], { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
  if (sim.value.err) {
    console.error(`topup: simulation failed for ${user}: ${JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    throw new TopUpRefused(TOPUP_COPY.wouldFail, 400);
  }
  return { transaction, usdcRaw: outRaw.toString(), maxLamports: maxIn.toString() };
}

