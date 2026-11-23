import { AccountRole, address, getBase64Encoder, getProgramDerivedAddress, isSolanaError, SOLANA_ERROR__JSON_RPC__INVALID_PARAMS, type Address, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { checkQuoteMints, getQuote, getSwapInstructions, JUPITER_AGGREGATOR, jupiterToken, pricesUsd, type JupiterToken } from "./jupiter";
import { SKR_MINT, SYSTEM_PROGRAM, USDC_MINT, WSOL_MINT } from "./constants";
import { COINS } from "@/domain/coins";
import { RECEIPT } from "./venues/addresses";
import { buildUserTransaction, userTransactionCompiler } from "./user-tx";
import { rpc } from "./rpc";
import { cached } from "./memo";
import { pullerSigner } from "./puller";
import type { Rules } from "@/domain/roundup";
import { ATA_RENT_LAMPORTS, fitSetup, MAX_CU_LIMIT, plannedSetup, SETUP_CU_PER_CREATE, takeSetupPrefix, TOPUP_SETUP_MAX } from "./user-setup";

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

/**
 * Task 7 (any coin): the offers a coin worth `valueCents` in this wallet covers, 3% kept back for the swap's slippage and price moves.
 * A rough gate only, as affordableTopUps: the build route quotes and checks the real amount.
 */
export function affordableTopUpsFor(valueCents: number): number[] {
  if (!(valueCents > 0)) return [];
  return TOPUP_OFFERS.filter((cents) => cents <= valueCents * 0.97);
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
/** A token top-up wraps nothing, so the wallet needs only the network fee and possibly its USDC account's rent (about 0.003 SOL). */
export const TOPUP_TOKEN_SOL_RESERVE_LAMPORTS = 3_000_000n;
/** At most this many coins beside SOL in /api/me/usdc topUpSources (the app shows at most 2 of them). */
const TOPUP_MAX_TOKEN_SOURCES = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Task 7 review: a negative answer (unknown coin, no route) is kept only this long, so a Jupiter hiccup never hides a coin for long. */
const NEGATIVE_TTL_MS = 10 * 60 * 1000;
/**
 * The phone's price bound for a token top-up (app sign.ts TOPUP_PRICE_MARGIN_BPS, checkTokenTopUp): the most the swap may spend, at the
 * coin's price, is at most the USDC out plus 3%. The API applies it too (Task 7 review), so it never lists or builds what the phone refuses.
 */
export const TOPUP_PRICE_MARGIN_BPS = 300n;
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
/** quotedIn and maxIn are in the source coin's base units (lamports for SOL); a token top-up wraps nothing (wrapLamports 0). */
export type TopUpPlan = { outRaw: bigint; quotedInLamports: bigint; quotedIn: bigint; maxIn: bigint; wrapLamports: bigint; slippageBps: number };
/** Jupiter's program authority for an id, and its own wSOL and USDC accounts (shared_accounts_exact_out_route slots 1, 4, 5). */
export type JupiterAuthority = { authority: string; wsol: string; usdc: string };
/** What checkTopUp compares against, all derived from the wallet alone (topUpAccounts). */
export type TopUpAccounts = { wsolAta: string; usdcAta: string; foreign: readonly string[]; authorities: readonly JupiterAuthority[] };
/**
 * The token top-up's source (topUpSourceAccounts): the coin, the wallet's classic account for it (the swap's slot 3, the only place it may
 * appear), its Token-2022 account for it (nowhere), and per Jupiter program authority that authority's own accounts for the coin and USDC.
 */
export type TopUpSourceAccounts = { mint: string; ata: string; token2022Ata: string; authorities: readonly { authority: string; source: string; usdc: string }[] };

const no = (why: string): never => { throw new Error(`Top-up refused: ${why}`); };
const u16At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(at, true);
const u32At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(at, true);
const u64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(at, true);
const same = (ix: TopUpIx, expected: readonly string[]) => ix.accounts.length === expected.length && expected.every((e, i) => ix.accounts[i] === e);

const ataOf = async (owner: Address, mint: Address, tokenProgram: Address = TOKEN_PROGRAM_ADDRESS) => (await findAssociatedTokenPda({ owner, mint, tokenProgram }))[0] as string;
/**
 * The mints whose accounts the wallet may hold beside SOL and USDC: the coins (live and retired) and the lending receipts. Kept equal to
 * the app's TOPUP_FOREIGN_MINTS (app/src/lib/sign.ts); tests/lib/topup.test.ts compares the two. None is ever a top-up source, but SKR
 * (controller ruling 11-19: planted SKR is staked, so liquid SKR in the wallet is the user's own): its classic account may then sit in
 * the swap's source slot of an SKR top-up, and nowhere else in any top-up.
 */
export const FOREIGN_MINTS: readonly Address[] = [
  ...Object.values(COINS).map((c) => c.mint).filter((m) => m !== USDC_MINT && m !== WSOL_MINT),
  ...Object.values(RECEIPT).flatMap((v) => Object.values(v).map((r) => r.mint)),
];
/** Whether `mint` may be a token top-up's source: not USDC, not wSOL (that is the SOL top-up), no garden coin or receipt but SKR. */
export const isTopUpSource = (mint: string): boolean =>
  mint !== USDC_MINT && mint !== WSOL_MINT && (mint === SKR_MINT || !(FOREIGN_MINTS as readonly string[]).includes(mint));
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

/** A token top-up's source accounts for `user` and `mint` (see TopUpSourceAccounts). Throws for USDC, wSOL, a garden coin or a receipt. */
export async function topUpSourceAccounts(user: Address, mint: Address): Promise<TopUpSourceAccounts> {
  if (!isTopUpSource(mint)) no(`${mint} is not a top-up source`);
  const [ata, token2022Ata, auth] = await Promise.all([ataOf(user, mint), ataOf(user, mint, TOKEN_2022_PROGRAM_ADDRESS), jupiterAuthorities()]);
  const per = await Promise.all(auth.map(async (x) => ({ authority: x.authority, source: await ataOf(address(x.authority), mint), usdc: x.usdc })));
  return { mint, ata, token2022Ata, authorities: per };
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

/** Every top-up: only its five programs, the wallet the only signer, none of `foreign` in any instruction. */
function screen(ixs: TopUpIx[], user: string, foreign: ReadonlySet<string>): void {
  const allowed = new Set([COMPUTE_BUDGET, ATA, SYSTEM, TOKEN, JUPITER_AGGREGATOR]);
  for (const ix of ixs) {
    if (!allowed.has(ix.program)) no(`program ${ix.program} is not used by a top-up`);
    for (const s of ix.signers ?? []) if (s !== user) no(`signer ${s} is not the wallet`);
    for (const acc of ix.accounts) if (foreign.has(acc)) no(`the wallet's other token account ${acc} is in the transaction`);
  }
}

/** Every top-up's leading compute budget: at most one limit and one price, no accounts, the priority fee at most 0.001 SOL. Returns the next index. */
function computeBudget(ixs: TopUpIx[]): number {
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
  return i;
}

/** The swap's amounts, as both top-ups hold them: no platform fee, slippage at most 1%, the USDC asked (or $2 to $25), a positive input. */
function checkAmounts(route: ReturnType<typeof parseSharedExactOut>, outRawAsked: bigint | undefined): bigint {
  const { outAmount: outRaw, quotedIn, slippageBps, feeBps } = route;
  if (feeBps !== 0) no("the swap carries a platform fee");
  if (slippageBps > TOPUP_MAX_SLIPPAGE_BPS) no(`slippage ${slippageBps} bps is above ${TOPUP_MAX_SLIPPAGE_BPS}`);
  if (outRawAsked !== undefined ? outRaw !== outRawAsked : outRaw < BigInt(TOPUP_MIN_CENTS) * 10_000n || outRaw > BigInt(TOPUP_MAX_CENTS) * 10_000n) no(`the swap delivers ${outRaw}, not the amount asked`);
  if (quotedIn <= 0n) no("the swap quotes no input");
  return (quotedIn * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n + 1n;
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
export function checkTopUp(ixs: TopUpIx[], a: TopUpAccounts & { user: string; outRaw?: bigint; source?: TopUpSourceAccounts }): TopUpPlan {
  if (a.source) return checkTokenTopUp(ixs, a, a.source);
  screen(ixs, a.user, new Set(a.foreign));
  let i = computeBudget(ixs);
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
  const maxIn = checkAmounts(route, a.outRaw);
  const { outAmount: outRaw, quotedIn, slippageBps } = route;
  if (wrapLamports! > maxIn) no("the SOL wrapped is above the swap's maximum");
  if (maxIn > TOPUP_MAX_LAMPORTS) no("the swap may spend more than 1 SOL");
  const close = ixs[i++];
  if (!close || close.program !== TOKEN || close.data.length !== 1 || close.data[0] !== CLOSE_ACCOUNT || !same(close, [a.wsolAta, a.user, a.user])) no("the wSOL account is not closed back to the wallet after the swap");
  if (i !== ixs.length) no("an instruction after the unwrap");
  return { outRaw, quotedInLamports: quotedIn, quotedIn, maxIn, wrapLamports: wrapLamports!, slippageBps };
}

/**
 * The token top-up (Task 7; the app runs the same check, sign.ts checkTokenTopUp): the wallet's own `source.mint` swapped to USDC, in
 * this order and nothing else: compute budget (as the SOL top-up); [create the wallet's own USDC account]; ONE Jupiter
 * shared_accounts_exact_out_route, its data parsed in full, its 13 fixed accounts pinned (the program authority for the data's id and that
 * authority's own source-coin and USDC accounts, the wallet as transfer authority, its classic source account as the source, its USDC
 * account as the destination, the source mint, no platform fee or Token-2022 account), the wallet and its source, wSOL and USDC accounts
 * nowhere in the route accounts, USDC out, no platform fee, slippage at most 1%; no SOL transfer, no SyncNative, no close, nothing after.
 * Refused outright: a source that is USDC, wSOL or a garden coin or receipt but SKR (isTopUpSource); the wallet's Token-2022 account for
 * the source coin and its accounts for every other FOREIGN_MINTS mint anywhere. The coin's price bound is the app's alone.
 */
function checkTokenTopUp(ixs: TopUpIx[], a: TopUpAccounts & { user: string; outRaw?: bigint }, source: TopUpSourceAccounts): TopUpPlan {
  if (!isTopUpSource(source.mint)) no(`${source.mint} is not a top-up source`);
  screen(ixs, a.user, new Set([...a.foreign.filter((x) => x !== source.ata), source.token2022Ata]));
  let i = computeBudget(ixs);
  let usdcCreate = false;
  for (; i < ixs.length && ixs[i].program !== JUPITER_AGGREGATOR; i++) {
    const ix = ixs[i];
    if (ix.program !== ATA) no(`a ${ix.program} instruction before the swap`);
    if (ix.data.length !== 1 || ix.data[0] !== ATA_CREATE_IDEMPOTENT) no("an account instruction that is not CreateIdempotent");
    if (usdcCreate || !same(ix, [a.user, a.usdcAta, a.user, USDC_MINT, SYSTEM, TOKEN])) no("an account creation other than the wallet's own USDC account");
    usdcCreate = true;
  }
  const swap = ixs[i++];
  if (!swap || swap.program !== JUPITER_AGGREGATOR) no("no Jupiter swap");
  const route = parseSharedExactOut(swap.data);
  const auth = source.authorities[route.id];
  if (!auth) no(`no Jupiter program authority for id ${route.id}`);
  const fixed = [TOKEN, auth.authority, a.user, source.ata, auth.source, auth.usdc, a.usdcAta, source.mint, USDC_MINT, JUPITER_AGGREGATOR, JUPITER_AGGREGATOR, JUPITER_EVENT_AUTHORITY, JUPITER_AGGREGATOR] as string[];
  if (swap.accounts.length <= fixed.length) no("the swap has no route accounts");
  fixed.forEach((want, k) => {
    if (swap.accounts[k] !== want) no(`the swap's account ${k} is ${swap.accounts[k]}, not ${want}`);
  });
  const mine = new Set([a.user, source.ata, a.wsolAta, a.usdcAta]);
  if (swap.accounts.slice(fixed.length).some((acc) => mine.has(acc))) no("the wallet or its own token accounts are in the route accounts");
  const maxIn = checkAmounts(route, a.outRaw);
  if (i !== ixs.length) no("an instruction after the swap");
  return { outRaw: route.outAmount, quotedInLamports: route.quotedIn, quotedIn: route.quotedIn, maxIn, wrapLamports: 0n, slippageBps: route.slippageBps };
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
  // 11-23: a route problem, said as one (it used to say "price"). SOL itself has no other coin to suggest.
  noRouteFor: (symbol: string) =>
    `Sprouts can't swap ${symbol} to USDC right now. Nothing was asked of your wallet. ${symbol === "SOL" ? "Try again in a few minutes." : "Try SOL, or try again later."}`,
  noPriceFor: (symbol: string) => `Sprouts couldn't get a ${symbol} price just now. Nothing was asked of your wallet. Try again in a minute.`,
  noToken: (symbol: string, cents: number) => `Not enough ${symbol}. Adding ${dollars(cents)} of USDC needs more than this wallet holds.`,
  noSolForFee: (symbol: string) => `Not enough SOL for the network fee. Adding USDC from ${symbol} needs about ${sol(TOPUP_TOKEN_SOL_RESERVE_LAMPORTS)} SOL in this wallet.`,
  notSource: "Sprouts cannot add USDC from this coin. Pick another coin.",
  notNow: "Sprouts could not build the top-up just now. Nothing was asked of your wallet. Try again in a minute.",
  noneHeld: "This wallet holds none of this coin. Pick another coin.",
  noFairPrice: (symbol: string) => `Sprouts could not get a fair ${symbol} to USDC price right now. Nothing was asked of your wallet. Try again later.`,
  tooBig: "Sprouts could not fit this swap in one transaction just now. Nothing was asked of your wallet. Try again in a minute.",
  wouldFail: "This top-up would fail on chain, so nothing was asked of your wallet. Try again in a minute.",
} as const;

/** The confirm route's answers (api/topup/confirm). */
export const TOPUP_CONFIRM = {
  notTopUp: "This is not a Sprouts top-up, so nothing was sent.",
  notMarked: "Could not start the top-up. Nothing moved. Try again.",
  failed: "The swap failed on chain. Your SOL stayed in your wallet, less the network fee.",
  failedToken: "The swap failed on chain. Your coins stayed in your wallet, less the network fee.",
  expired: "The top-up did not go through. Nothing moved. Try again.",
  pending: "Your top-up was sent but is not confirmed yet. Check Home in a minute before you try again.",
} as const;

export type BuiltTopUp = { transaction: string; usdcRaw: string; maxLamports?: string; inputMint: string; maxInRaw: string };

/**
 * The unsigned top-up (see buildSolTopUp and buildTokenTopUp). No `inputMint`, or the wSOL mint: today's SOL top-up exactly (the
 * answer adds inputMint = wSOL and maxInRaw = maxLamports; 0.1.11 reads neither). Any other coin: the token top-up.
 */
export async function buildTopUp(user: Address, cents: number, inputMint?: Address, setup: TopUpSetupAsk = NO_SETUP): Promise<BuiltTopUp> {
  if (inputMint === undefined || inputMint === WSOL_MINT) {
    const built = await buildSolTopUp(user, cents, setup);
    return { ...built, inputMint: WSOL_MINT, maxInRaw: built.maxLamports };
  }
  return buildTokenTopUp(user, cents, inputMint, setup);
}

/** A coin Jupiter verified, of the classic Token program (the swap's fixed token program), and allowed as a source. */
const usableToken = (mint: string, t: JupiterToken | null): t is JupiterToken => !!t && t.verified && t.tokenProgram === TOKEN && isTopUpSource(mint);
/**
 * Jupiter's word on a coin (symbol, decimals, verified, token program): a usable coin kept a day, any other answer NEGATIVE_TTL_MS.
 * Callers reach it only for a coin the wallet holds (the memo is capped too, memo.ts MEMO_MAX_ENTRIES).
 */
const topUpToken = (mint: string): Promise<JupiterToken | null> =>
  cached(`topup-token:${mint}`, () => jupiterToken(mint), () => true, (t) => (usableToken(mint, t) ? DAY_MS : NEGATIVE_TTL_MS));
/**
 * The most a $5 ExactOut route from `mint` to USDC through TOPUP_DEXES may spend (the quote's maximum, base units), null when there is
 * no route: the same for every user, kept an hour (no route: NEGATIVE_TTL_MS).
 */
const TOPUP_PROBE_RAW = BigInt(TOPUP_DEFAULT_CENTS) * 10_000n;
const topUpRouteMax = (mint: Address): Promise<bigint | null> =>
  cached(`topup-route:${mint}`, () => probeTopUpRoute(mint), () => true, (v) => (v === null ? NEGATIVE_TTL_MS : HOUR_MS));

/**
 * 11-23 (carousel day: SKR was offered, then every SKR top-up refused on swap variant 47): the probe is "the route BUILDS", not only "it
 * quotes". The $5 quote, then Jupiter's swap instructions asked exactly as the real token build asks them, then the swap data read by
 * the same parser the real build uses (parseSharedExactOut): a variant the top-up may not carry means the coin is not offered. The
 * route's variants come from pool liquidity, not the wallet (Kimi), so the puller's public address stands in for the user.
 */
export async function probeTopUpRoute(mint: Address): Promise<bigint | null> {
  try {
    const quote = await getQuote({ inputMint: mint, outputMint: USDC_MINT, amountRaw: TOPUP_PROBE_RAW, slippageBps: TOPUP_SLIPPAGE_BPS, swapMode: "ExactOut", maxAccounts: 20, dexes: TOPUP_DEXES });
    const probeUser = (await pullerSigner()).address;
    const parsed = await getSwapInstructions({ quote, userPublicKey: probeUser, wrapAndUnwrapSol: false, maxPriorityLamports: TOPUP_PRIORITY_LAMPORTS, useSharedAccounts: true });
    parseSharedExactOut(parsed.swap.data as Uint8Array);
    return BigInt(quote.otherAmountThreshold);
  } catch (e) {
    console.error(`topup: ${mint} is not offered as a source (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}

/**
 * The phone's bound (app sign.ts checkTokenTopUp), in integers: maxIn x usd / 10^decimals <= usdcRaw / 1e6 x 1.03, the price in 1e-12 USD
 * per whole coin. A price that is not sane fails it.
 */
export function withinTopUpPriceBound(maxIn: bigint, usdcRaw: bigint, usd: number, decimals: number): boolean {
  const sane = typeof usd === "number" && Number.isFinite(usd) && usd > 0 && usd < 10_000_000 && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18;
  const pico = sane ? BigInt(Math.round(usd * 1e12)) : 0n;
  if (pico <= 0n) return false;
  return maxIn * pico * 10_000n <= usdcRaw * 1_000_000n * 10n ** BigInt(decimals) * (10_000n + TOPUP_PRICE_MARGIN_BPS);
}

/** A token account's balance and decimals; an account that does not exist yet reads as none held. Any other failure throws. */
async function tokenBalance(ata: Address): Promise<{ raw: bigint; decimals: number | null }> {
  try {
    const { value } = await rpc().getTokenAccountBalance(ata, { commitment: "confirmed" }).send();
    return { raw: BigInt(value.amount), decimals: value.decimals };
  } catch (e) {
    if (isSolanaError(e, SOLANA_ERROR__JSON_RPC__INVALID_PARAMS) || /could not find account/i.test(e instanceof Error ? e.message : String(e))) return { raw: 0n, decimals: null };
    throw e;
  }
}

/** Compiled with no lookup table, held to the wire limit, and simulated; throws TopUpRefused with the sentence to show. */
async function compileAndSimulate(user: Address, ixs: Instruction[], compile?: (ixs: readonly Instruction[]) => string): Promise<string> {
  // Static accounts only (the app refuses a lookup table it cannot read): the route was asked for at most 20 accounts.
  // `compile` (Task 17a review): the setup path's own compiler, so a fallback reuses its one blockhash; absent = today's build.
  const transaction = compile ? compile(ixs) : await buildUserTransaction(user, ixs);
  if (getBase64Encoder().encode(transaction).length > MAX_WIRE_BYTES) throw new TopUpRefused(TOPUP_COPY.tooBig, 503);
  const sim = await rpc().simulateTransaction(transaction as Parameters<ReturnType<typeof rpc>["simulateTransaction"]>[0], { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
  if (sim.value.err) {
    console.error(`topup: simulation failed for ${user}: ${JSON.stringify(sim.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    throw new TopUpRefused(TOPUP_COPY.wouldFail, 400);
  }
  return transaction;
}

/**
 * Task 17a (user rent): the app's opt-in for a top-up, `setupMax` 0..TOPUP_SETUP_MAX (0 or absent: today's bytes), and the user's rules
 * (read only when asked) for which coins are switched on.
 */
export type TopUpSetupAsk = { max: number; rules: () => Promise<Pick<Rules, "allocation" | "pins" | "managed" | "stop">> };

/**
 * Jupiter's checked instructions with `creates` LEADING (before the compute budget: the app peels a leading run only) and Jupiter's own
 * SetComputeUnitLimit rewritten IN PLACE, + SETUP_CU_PER_CREATE per create, at most MAX_CU_LIMIT (Kimi: a second limit is refused).
 */
export function withSetupCreates(ixs: readonly Instruction[], creates: readonly Instruction[]): Instruction[] {
  if (creates.length === 0) return [...ixs];
  const bumped = ixs.map((ix) => {
    const d = ix.data;
    if (ix.programAddress !== COMPUTE_BUDGET || !d || d.length !== 5 || d[0] !== 2) return ix;
    const limit = Math.min(u32At(new Uint8Array(d), 1) + SETUP_CU_PER_CREATE * creates.length, MAX_CU_LIMIT);
    const data = new Uint8Array(5);
    data[0] = 2;
    new DataView(data.buffer).setUint32(1, limit, true);
    return { ...ix, data };
  });
  return [...creates, ...bumped];
}

/**
 * compileAndSimulate with the setup (design 3, 5): `creates` dropped from the end until the wire fits, then held to what the confirm will
 * check (the server's takeSetupPrefix, then `verify`, the flow's own checkTopUp, on the rest), then simulated. Any failure on that path,
 * and none to add, is today's top-up exactly: compileAndSimulate(ixs), whose failure is the one the user hears.
 */
async function compileWithSetup(user: Address, ixs: Instruction[], creates: readonly Instruction[], verify: (rest: TopUpIx[]) => void): Promise<string> {
  let compile: ((ixs: readonly Instruction[]) => string) | undefined;
  if (creates.length > 0) {
    try {
      // One blockhash for the whole build: the setup sizes tried and the plain fallback below all compile locally.
      compile = await userTransactionCompiler(user);
      const c = compile;
      const fit = await fitSetup((k) => c(withSetupCreates(ixs, k)), creates, MAX_WIRE_BYTES);
      if (fit.transaction !== null) {
        verify(await takeSetupPrefix(withSetupCreates(ixs, creates.slice(0, fit.used)).map(toTopUpIx), user, TOPUP_SETUP_MAX));
        const sim = await rpc().simulateTransaction(fit.transaction as Parameters<ReturnType<typeof rpc>["simulateTransaction"]>[0], { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }).send();
        if (!sim.value.err) return fit.transaction;
        console.error(`topup: the top-up with ${fit.used} setup creates would fail for ${user}; built without them`);
      }
    } catch (e) {
      console.error(`topup: no setup for ${user} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return compileAndSimulate(user, ixs, compile);
}

const NO_SETUP: TopUpSetupAsk = { max: 0, rules: async () => { throw new Error("no setup asked"); } };
const RENT = BigInt(ATA_RENT_LAMPORTS);

/**
 * The token top-up for `user` (Task 7): refused 400 before any quote for USDC, a garden coin or receipt (SKR allowed); 409 before any
 * Jupiter call when the wallet holds none of the coin in its classic account; 400 for a coin Jupiter has not verified or one outside the
 * classic Token program; then a Jupiter ExactOut quote coin to USDC for `cents` through TOPUP_DEXES, the balance check (the coin covers
 * the quote's maximum, and TOPUP_TOKEN_SOL_RESERVE_LAMPORTS of SOL for the fee and a USDC account), the phone's price bound
 * (withinTopUpPriceBound at Jupiter's price), Jupiter's instructions (no wrap, shared accounts) checked with the token rules, compiled with no lookup table, and simulated.
 */
async function buildTokenTopUp(user: Address, cents: number, inputMint: Address, setup: TopUpSetupAsk): Promise<BuiltTopUp> {
  const outRaw = BigInt(cents) * 10_000n;
  let source: TopUpSourceAccounts;
  try {
    source = await topUpSourceAccounts(user, inputMint);
  } catch {
    throw new TopUpRefused(TOPUP_COPY.notSource, 400);
  }
  // Task 7 review (security): the chain first, so a coin this wallet does not hold never reaches Jupiter or the memo.
  let lamports: bigint, held: { raw: bigint; decimals: number | null };
  try {
    [lamports, held] = await Promise.all([
      rpc().getBalance(user, { commitment: "confirmed" }).send().then((r) => BigInt(r.value)),
      tokenBalance(address(source.ata)),
    ]);
  } catch (e) {
    console.error(`topup: the balances could not be read for ${user} (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.notNow, 503);
  }
  if (held.raw <= 0n || held.decimals === null) throw new TopUpRefused(TOPUP_COPY.noneHeld, 409);
  let token: JupiterToken | null;
  try {
    token = await topUpToken(inputMint);
  } catch (e) {
    console.error(`topup: no token info for ${inputMint} (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.notNow, 503);
  }
  if (!usableToken(inputMint, token)) throw new TopUpRefused(TOPUP_COPY.notSource, 400);
  const accounts = await topUpAccounts(user);
  let quote;
  try {
    quote = await getQuote({ inputMint, outputMint: USDC_MINT, amountRaw: outRaw, slippageBps: TOPUP_SLIPPAGE_BPS, swapMode: "ExactOut", maxAccounts: 20, dexes: TOPUP_DEXES });
    checkQuoteMints(quote, { inputMint, outputMint: USDC_MINT });
  } catch (e) {
    console.error(`topup: no ${token.symbol} quote for ${user} (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.noRouteFor(token.symbol), 503);
  }
  const maxIn = BigInt(quote.otherAmountThreshold);
  if (held.raw < maxIn) throw new TopUpRefused(TOPUP_COPY.noToken(token.symbol, cents), 409);
  if (lamports < TOPUP_TOKEN_SOL_RESERVE_LAMPORTS) throw new TopUpRefused(TOPUP_COPY.noSolForFee(token.symbol), 409);
  let price: number | undefined;
  try {
    price = (await pricesUsd([inputMint]))[inputMint]?.usdPrice;
  } catch (e) {
    console.error(`topup: no ${token.symbol} price (${e instanceof Error ? e.message : String(e)})`);
  }
  if (price === undefined) throw new TopUpRefused(TOPUP_COPY.noPriceFor(token.symbol), 503);   // 11-23: its own line (Kimi)
  if (!withinTopUpPriceBound(maxIn, outRaw, price, held.decimals)) {
    console.error(`topup: ${token.symbol} quote for ${user} above the price bound (max ${maxIn} at $${price})`);
    throw new TopUpRefused(TOPUP_COPY.noFairPrice(token.symbol), 503);
  }
  let parsed;
  try {
    parsed = await getSwapInstructions({ quote, userPublicKey: user, wrapAndUnwrapSol: false, maxPriorityLamports: TOPUP_PRIORITY_LAMPORTS, useSharedAccounts: true });
  } catch (e) {
    console.error(`topup: no ${token.symbol} swap instructions for ${user} (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.noRouteFor(token.symbol), 503);
  }
  const ixs = [...parsed.computeBudget, ...parsed.setup, parsed.swap, ...(parsed.cleanup ? [parsed.cleanup] : [])];
  let plan: TopUpPlan;
  try {
    plan = checkTopUp(ixs.map(toTopUpIx), { user, ...accounts, outRaw, source });
  } catch (e) {
    console.error(`topup: Jupiter's ${token.symbol} answer for ${user} refused (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.noRouteFor(token.symbol), 503);
  }
  // Kimi review (Task 7, 1a): the bound again on the maximum the built swap really carries (it can differ from the quote's by rounding).
  if (!withinTopUpPriceBound(plan.maxIn, outRaw, price, held.decimals)) {
    console.error(`topup: ${token.symbol} swap for ${user} above the price bound (max ${plan.maxIn} at $${price})`);
    throw new TopUpRefused(TOPUP_COPY.noFairPrice(token.symbol), 503);
  }
  // Task 17a: the token rule, all or none: the fee reserve + n x rent + 0.01 SOL kept.
  const creates = await plannedSetup(user, setup.rules, Math.min(setup.max, TOPUP_SETUP_MAX), (n) => lamports >= TOPUP_TOKEN_SOL_RESERVE_LAMPORTS + BigInt(n) * RENT + 10_000_000n);
  // Narrowed above (a null decimals refused before any build), held as a const so the check below needs no assertion.
  const decimals = held.decimals;
  const transaction = await compileWithSetup(user, ixs, creates, (rest) => {
    const again = checkTopUp(rest, { user, ...accounts, outRaw, source });
    if (!withinTopUpPriceBound(again.maxIn, outRaw, price, decimals)) throw new Error("Top-up refused: above the price bound with the setup");
  });
  return { transaction, usdcRaw: outRaw.toString(), inputMint, maxInRaw: maxIn.toString() };
}

export type TopUpSourceOffer = { mint: string; symbol: string; decimals: number; valueCents: number; offers: number[] };

/**
 * GET /api/me/usdc topUpSources (Task 7): SOL first (its `offers` = topUpCents), then at most TOPUP_MAX_TOKEN_SOURCES coins by value
 * that this wallet holds in its classic Token account, that may be a source (isTopUpSource), that Jupiter verified, whose value covers
 * an offer (affordableTopUpsFor) and that route to USDC through TOPUP_DEXES within the phone's price bound at today's price (a $5
 * probe, withinTopUpPriceBound). Computed only when the app asks (/api/me/usdc?sources=1). Coins only when the wallet keeps the SOL a token top-up
 * needs. Null when the SOL, its price, the balances or the prices could not be read.
 */
export async function topUpSources(user: Address, solLamports: bigint | null, solUsd: number | null, solOffers: number[] | null): Promise<TopUpSourceOffer[] | null> {
  if (solLamports === null || solUsd === null || solOffers === null) return null;
  const sol: TopUpSourceOffer = { mint: WSOL_MINT, symbol: "SOL", decimals: 9, valueCents: Math.floor((Number(solLamports) * solUsd) / 1e7), offers: solOffers };
  let held: { mint: Address; raw: bigint; decimals: number }[];
  try {
    const { value } = await rpc().getTokenAccountsByOwner(user, { programId: TOKEN_PROGRAM_ADDRESS }, { encoding: "jsonParsed", commitment: "confirmed" }).send();
    const rows = value.map((v) => {
      const info = (v.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } }).parsed?.info;
      return { pubkey: v.pubkey as string, mint: info?.mint, amount: info?.tokenAmount?.amount, decimals: info?.tokenAmount?.decimals };
    });
    const eligible = rows.filter((r): r is { pubkey: string; mint: string; amount: string; decimals: number } =>
      typeof r.mint === "string" && typeof r.amount === "string" && typeof r.decimals === "number" && isTopUpSource(r.mint) && BigInt(r.amount) > 0n);
    // Only the wallet's own associated account: the one the swap spends from.
    const atas = await Promise.all(eligible.map((r) => ataOf(user, address(r.mint))));
    held = eligible.filter((r, k) => r.pubkey === atas[k]).map((r) => ({ mint: address(r.mint), raw: BigInt(r.amount), decimals: r.decimals }));
  } catch (e) {
    console.error(`topup: the token balances could not be read (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
  if (held.length === 0 || solLamports < TOPUP_TOKEN_SOL_RESERVE_LAMPORTS) return [sol];
  let prices: Awaited<ReturnType<typeof pricesUsd>>;
  try {
    prices = await pricesUsd(held.map((h) => h.mint));
  } catch (e) {
    console.error(`topup: the token prices could not be read (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
  const valued = held
    .map((h) => ({ ...h, valueCents: prices[h.mint] ? Math.floor((Number(h.raw) / 10 ** h.decimals) * prices[h.mint].usdPrice * 100 + 1e-6) : 0 }))
    .filter((h) => affordableTopUpsFor(h.valueCents).length > 0)
    .sort((x, y) => y.valueCents - x.valueCents)
    .slice(0, TOPUP_MAX_TOKEN_SOURCES * 2);
  const checked = await Promise.all(
    valued.map(async (h) => {
      try {
        const t = await topUpToken(h.mint);
        if (!usableToken(h.mint, t)) return null;
        const max = await topUpRouteMax(h.mint);
        if (max === null || !withinTopUpPriceBound(max, TOPUP_PROBE_RAW, prices[h.mint].usdPrice, h.decimals)) return null;
        return { mint: h.mint as string, symbol: t.symbol, decimals: h.decimals, valueCents: h.valueCents, offers: affordableTopUpsFor(h.valueCents) };
      } catch {
        return null;
      }
    }),
  );
  return [sol, ...checked.filter((x): x is TopUpSourceOffer => x !== null).slice(0, TOPUP_MAX_TOKEN_SOURCES)];
}

/**
 * The unsigned SOL top-up for `user` (the Seed Vault wallet, fee payer and only signer): a Jupiter ExactOut quote SOL to USDC for `cents`,
 * the balance check (the quote's maximum SOL plus SOL_RESERVE_LAMPORTS), Jupiter's instructions checked (checkTopUp), compiled with no
 * lookup table, and simulated. Throws TopUpRefused with the sentence to show.
 */
async function buildSolTopUp(user: Address, cents: number, setup: TopUpSetupAsk): Promise<{ transaction: string; usdcRaw: string; maxLamports: string }> {
  const outRaw = BigInt(cents) * 10_000n;
  const accounts = await topUpAccounts(user);
  let quote;
  try {
    quote = await getQuote({ inputMint: WSOL_MINT, outputMint: USDC_MINT, amountRaw: outRaw, slippageBps: TOPUP_SLIPPAGE_BPS, swapMode: "ExactOut", maxAccounts: 20, dexes: TOPUP_DEXES });
    checkQuoteMints(quote, { inputMint: WSOL_MINT, outputMint: USDC_MINT });
  } catch (e) {
    console.error(`topup: no quote for ${user} (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.noRouteFor("SOL"), 503);
  }
  const maxIn = BigInt(quote.otherAmountThreshold);
  const { value: balance } = await rpc().getBalance(user, { commitment: "confirmed" }).send();
  if (BigInt(balance) < maxIn + SOL_RESERVE_LAMPORTS) throw new TopUpRefused(TOPUP_COPY.noSol(cents, maxIn, BigInt(balance)), 409);
  let parsed;
  try {
    parsed = await getSwapInstructions({ quote, userPublicKey: user, wrapAndUnwrapSol: true, maxPriorityLamports: TOPUP_PRIORITY_LAMPORTS, useSharedAccounts: true });
  } catch (e) {
    console.error(`topup: no swap instructions for ${user} (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.noRouteFor("SOL"), 503);
  }
  const ixs = [...parsed.computeBudget, ...parsed.setup, parsed.swap, ...(parsed.cleanup ? [parsed.cleanup] : [])];
  try {
    const plan = checkTopUp(ixs.map(toTopUpIx), { user, ...accounts, outRaw });
    if (plan.wrapLamports > maxIn) throw new Error("Top-up refused: the wrap is above the quote's maximum");
  } catch (e) {
    console.error(`topup: Jupiter's answer for ${user} refused (${e instanceof Error ? e.message : String(e)})`);
    throw new TopUpRefused(TOPUP_COPY.noRouteFor("SOL"), 503);
  }
  // Task 17a: the SOL rule, all or none: the swap's maximum + n x rent + SOL_RESERVE_LAMPORTS + 0.001 SOL.
  const creates = await plannedSetup(user, setup.rules, Math.min(setup.max, TOPUP_SETUP_MAX), (n) => BigInt(balance) >= maxIn + BigInt(n) * RENT + SOL_RESERVE_LAMPORTS + 1_000_000n);
  const transaction = await compileWithSetup(user, ixs, creates, (rest) => {
    if (checkTopUp(rest, { user, ...accounts, outRaw }).wrapLamports > maxIn) throw new Error("Top-up refused: the wrap is above the quote's maximum");
  });
  return { transaction, usdcRaw: outRaw.toString(), maxLamports: maxIn.toString() };
}

