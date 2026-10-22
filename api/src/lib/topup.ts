import { AccountRole, getBase64Encoder, type Address, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { checkQuoteMints, getQuote, getSwapInstructions, JUPITER_AGGREGATOR } from "./jupiter";
import { SYSTEM_PROGRAM, USDC_MINT, WSOL_MINT } from "./constants";
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
/** Kept in the wallet for network fees and rent after the top-up (about 0.01 SOL). */
export const SOL_RESERVE_LAMPORTS = 10_000_000n;
export const TOPUP_SLIPPAGE_BPS = 50;
/** The ceiling the app and this check accept on the slippage a top-up swap carries. */
export const TOPUP_MAX_SLIPPAGE_BPS = 100;
/** The priority fee asked of Jupiter, and the ceiling the check accepts (limit x price), in lamports. */
export const TOPUP_PRIORITY_LAMPORTS = 100_000;
export const TOPUP_MAX_PRIORITY_LAMPORTS = 1_000_000n;
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
 * The two Jupiter v6 ExactOut layouts (Anchor discriminators, as jupiter.ts OUTPUT_SLOTS): the account slots of the transfer authority,
 * the source (the user's wSOL), the output (plain: the custom slot when set, else the user slot; shared: one slot), and the two mints.
 * The data ends: out_amount u64, quoted_in_amount u64, slippage_bps u16, platform_fee_bps u8.
 */
const EXACT_OUT: Record<string, { authority: number; source: number; out: { user: number; custom: number } | { shared: number }; inMint: number; outMint: number }> = {
  d033ef977b2bed5c: { authority: 1, source: 2, out: { user: 3, custom: 4 }, inMint: 5, outMint: 6 }, // exact_out_route
  b0d169a89a7d453e: { authority: 2, source: 3, out: { shared: 6 }, inMint: 7, outMint: 8 }, // shared_accounts_exact_out_route
};

export type TopUpIx = { program: string; accounts: string[]; signers?: string[]; data: Uint8Array };
export type TopUpPlan = { outRaw: bigint; quotedInLamports: bigint; wrapLamports: bigint; slippageBps: number };

const no = (why: string): never => { throw new Error(`Top-up refused: ${why}`); };
const u16At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint16(at, true);
const u32At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(at, true);
const u64At = (d: Uint8Array, at: number) => new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(at, true);
const same = (ix: TopUpIx, expected: readonly string[]) => ix.accounts.length === expected.length && expected.every((e, i) => ix.accounts[i] === e);

export async function topUpAccounts(user: Address): Promise<{ wsolAta: string; usdcAta: string }> {
  const [[wsolAta], [usdcAta]] = await Promise.all([
    findAssociatedTokenPda({ owner: user, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS }),
    findAssociatedTokenPda({ owner: user, mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS }),
  ]);
  return { wsolAta, usdcAta };
}

/**
 * What a top-up transaction may hold, and nothing else (the app runs the same check before the wallet is asked, sign.ts 'topup'):
 * compute budget (a limit and a price, the priority fee at most 0.001 SOL); create the user's wSOL and USDC accounts (optional, paid by
 * the user); move SOL into the user's own wSOL account, then SyncNative; ONE Jupiter ExactOut swap from that wSOL account into the
 * user's USDC account, USDC out, no platform fee, slippage at most 1%, the wrap no larger than the swap's own maximum; then close the
 * wSOL account back to the user. The user is the only signer. `outRaw`, when given, is the USDC the screen promised.
 */
export function checkTopUp(ixs: TopUpIx[], a: { user: string; wsolAta: string; usdcAta: string; outRaw?: bigint }): TopUpPlan {
  const allowed = new Set([COMPUTE_BUDGET, ATA, SYSTEM, TOKEN, JUPITER_AGGREGATOR]);
  for (const ix of ixs) {
    if (!allowed.has(ix.program)) no(`program ${ix.program} is not used by a top-up`);
    for (const s of ix.signers ?? []) if (s !== a.user) no(`signer ${s} is not the wallet`);
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
  const disc = Buffer.from(swap.data.slice(0, 8)).toString("hex");
  const layout = EXACT_OUT[disc];
  if (!layout) no(`swap instruction ${disc} is not an ExactOut route`);
  const at = (k: number) => swap.accounts[k];
  const outSlot = "shared" in layout.out ? layout.out.shared : at(layout.out.custom) === JUPITER_AGGREGATOR ? layout.out.user : layout.out.custom;
  if (at(layout.authority) !== a.user) no("the swap's authority is not the wallet");
  if (at(layout.source) !== a.wsolAta) no("the swap does not spend from the wallet's wSOL account");
  if (at(outSlot) !== a.usdcAta) no("the swap does not deliver to the wallet's USDC account");
  if (at(layout.inMint) !== WSOL_MINT || at(layout.outMint) !== USDC_MINT) no("the swap is not SOL to USDC");
  const d = swap.data;
  if (d.length < 8 + 4 + 19) no("the swap data is too short");
  const n = d.length;
  const outRaw = u64At(d, n - 19), quotedIn = u64At(d, n - 11), slippageBps = u16At(d, n - 3), feeBps = d[n - 1];
  if (feeBps !== 0) no("the swap carries a platform fee");
  if (slippageBps > TOPUP_MAX_SLIPPAGE_BPS) no(`slippage ${slippageBps} bps is above ${TOPUP_MAX_SLIPPAGE_BPS}`);
  if (a.outRaw !== undefined ? outRaw !== a.outRaw : outRaw < BigInt(TOPUP_MIN_CENTS) * 10_000n || outRaw > BigInt(TOPUP_MAX_CENTS) * 10_000n) no(`the swap delivers ${outRaw}, not the amount asked`);
  const maxIn = (quotedIn * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n + 1n;
  if (quotedIn <= 0n || wrapLamports! > maxIn) no("the SOL wrapped is above the swap's maximum");
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
    quote = await getQuote({ inputMint: WSOL_MINT, outputMint: USDC_MINT, amountRaw: outRaw, slippageBps: TOPUP_SLIPPAGE_BPS, swapMode: "ExactOut", maxAccounts: 20 });
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
    parsed = await getSwapInstructions({ quote, userPublicKey: user, wrapAndUnwrapSol: true, maxPriorityLamports: TOPUP_PRIORITY_LAMPORTS });
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

