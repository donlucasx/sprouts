import {
  address, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, compressTransactionMessageUsingAddressLookupTables, signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, fetchAddressesForLookupTables, sendAndConfirmTransactionFactory,
  createSolanaRpcSubscriptions, assertIsTransactionWithBlockhashLifetime, type Address, type Instruction, type TransactionSigner,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token";
import { getQuote, getSwapInstructions, checkSwapInstructions, checkQuoteMints } from "./jupiter";
import { buildTransferRecurringIx } from "./subscriptions";
import { buildStakeIx, skrAta } from "./staking";
import { pullerSigner } from "./puller";
import { rpc } from "./rpc";
import { config } from "./config";
import { USDC_MINT, SKR_MINT, WSOL_MINT } from "./constants";
import { COINS, type Asset, type LiveAsset } from "@/domain/coins";


export type BuiltPlanting = {
  tx: Awaited<ReturnType<typeof signTransactionMessageWithSigners>>;
  /** Known as soon as the puller signs, so it is recorded before the send. */
  signature: string;
  expectedOutRaw: bigint;
  minOutRaw: bigint;
  lookupTables: Address[];
  lastValidBlockHeight: bigint;
  /** Where the planting delivers: the puller's own SKR account for SKR, the user's token account for a wallet coin; the simulation reports its balance before and after [R207 review]. */
  deliveryAccount: Address;
};

/**
 * The account a wallet-held coin needs before the swap: the user's own token account for that mint, created if missing
 * (Jupiter assumes a custom destination exists). Idempotent, so an existing account is not an error; the puller pays the rent,
 * about 0.002 SOL, once per user per coin. An SKR leg needs nothing: it is staked from the puller's own account.
 */
export async function coinAccountInstructions(a: { asset: Asset; payer: TransactionSigner; user: Address }): Promise<Instruction[]> {
  const coin = COINS[a.asset];
  if (coin.held !== "wallet") return [];
  const [ata] = await findAssociatedTokenPda({ owner: a.user, mint: coin.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return [getCreateAssociatedTokenIdempotentInstruction({ payer: a.payer, ata, owner: a.user, mint: coin.mint })];
}

/**
 * R266, contracts 3.2: the 0.5% rides only on the four coin legs. A lending leg's quote carries no platformFeeBps and its swap no
 * feeAccount: Jupiter answers 400 "platformFee must be greater than 0 when feeAccount is set" (Claude audit F1), which the run
 * used to turn into a charged SKR planting.
 */
export async function swapFeeParams(asset: LiveAsset): Promise<{ platformFeeBps?: number; feeAccount?: Address }> {
  const bps = COINS[asset].feeBps;
  if (bps === 0) return {};
  const [feeAccount] = await findAssociatedTokenPda({ owner: address(config().feeWallet), mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return { platformFeeBps: bps, feeAccount };
}

/**
 * The planting: one versioned transaction the puller signs alone. Pull USDC from the trading wallet, swap it on Jupiter with the
 * 0.5% fee taken in USDC on the input side (R105), deliver the coin (SKR into the puller's account and then the stake keyed by
 * the Seed Vault key; every other coin straight into the user's own token account). If any step fails, nothing moves.
 * The SKR stake takes the quote's minimum plus `skrCarryRaw`, the same user's slippage remainder from earlier SKR plantings that
 * still sits in the puller's account (spec 3.2 step 4; security audit R207 #2); the run decides it, the ledger is in plant-run.
 */
export async function buildPlantingTx(a: { delegator: Address; user: Address; asset: LiveAsset; pullRaw: bigint; delegationPda: Address; skrCarryRaw?: bigint }): Promise<BuiltPlanting> {
  const coin = COINS[a.asset];
  // Step 0 (T9, security scan = T1 review I2): this is the coin-swap path. A lending leg has no pinned destination here (its output
  // is a venue receipt, not a swap delivery), so it is refused before any quote is asked or anything is signed.
  if (coin.kind === "lend" || coin.held === "venue") throw new Error(`${a.asset} is a lending leg: the coin-swap planting refuses it`);
  const puller = await pullerSigner();
  const fee = await swapFeeParams(a.asset);
  // Direct routes only for SKR (one hop); the other coins route through two pools.
  const quote = await getQuote({ inputMint: USDC_MINT, outputMint: coin.mint, amountRaw: a.pullRaw, maxAccounts: 24, onlyDirectRoutes: a.asset === "SKR", ...(fee.platformFeeBps ? { platformFeeBps: fee.platformFeeBps } : {}) });
  checkQuoteMints(quote, { inputMint: USDC_MINT, outputMint: coin.mint });
  const [userAta] = await findAssociatedTokenPda({ owner: a.user, mint: coin.mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const destination = coin.held === "wallet" ? userAta : undefined;
  const swap = await getSwapInstructions({ quote, userPublicKey: puller.address, ...(fee.feeAccount ? { feeAccount: fee.feeAccount } : {}), ...(destination ? { destinationTokenAccount: destination } : {}) });
  // Nothing from the network is signed unchecked: the aggregator, each decoded helper instruction, the signers, the fee account,
  // and where the swap delivers (R207 #4): the user's token account for a wallet coin, the puller's own SKR account for SKR.
  const [wsolAccount] = await findAssociatedTokenPda({ owner: puller.address, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const delivers = destination ?? (coin.held === "staked" ? await skrAta(puller.address) : undefined);
  if (!delivers) throw new Error(`${a.asset}: no pinned destination for the swap`);
  checkSwapInstructions(swap, { puller: puller.address, ...(fee.feeAccount ? { feeAccount: fee.feeAccount } : {}), wsolAccount, destination: delivers, ...(destination ? { destinationOwner: a.user } : {}) });
  const minOutRaw = BigInt(quote.otherAmountThreshold);

  const ixs: Instruction[] = [
    getSetComputeUnitLimitInstruction({ units: 400_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1_000n }),
    ...(await coinAccountInstructions({ asset: a.asset, payer: puller, user: a.user })),
    await buildTransferRecurringIx({ delegator: a.delegator, delegatee: puller, delegationPda: a.delegationPda, amountRaw: a.pullRaw }),
    ...swap.setup,
    swap.swap,
    ...(swap.cleanup ? [swap.cleanup] : []),
    // The one line Radiants ticket 367 may change: today SKR is staked into the position keyed by the Seed Vault key.
    ...(coin.held === "staked" ? [await buildStakeIx({ payer: puller, user: a.user, amountRaw: minOutRaw + (a.skrCarryRaw ?? 0n) })] : []),
  ];
  const tables = await fetchAddressesForLookupTables(swap.lookupTables, rpc());
  const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(puller, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
    (m) => compressTransactionMessageUsingAddressLookupTables(m, tables),
  );
  const tx = await signTransactionMessageWithSigners(message);
  return { tx, signature: getSignatureFromTransaction(tx), expectedOutRaw: BigInt(quote.outAmount), minOutRaw, lookupTables: swap.lookupTables, lastValidBlockHeight, deliveryAccount: delivers };
}

type TokenBalance = { mint: string; owner?: string; uiTokenAmount: { amount: string } };

/**
 * What one confirmed transaction changed in `owner`'s SKR holdings, from its own pre and post token balances (R207 #2). Read by
 * signature, so other users' plantings landing at the same time in the same puller account cannot leak into it. Throws when the
 * owner has no SKR account in the transaction at all: an SKR planting always touches it (the swap fills it, the stake drains it).
 */
export function skrChangeFromMeta(meta: { preTokenBalances?: readonly TokenBalance[] | null; postTokenBalances?: readonly TokenBalance[] | null }, owner: string): bigint {
  const mine = (list: readonly TokenBalance[] | null | undefined) => (list ?? []).filter((b) => b.mint === SKR_MINT && b.owner === owner);
  const pre = mine(meta.preTokenBalances);
  const post = mine(meta.postTokenBalances);
  if (!pre.length && !post.length) throw new Error(`no SKR account of ${owner} in the transaction`);
  const sum = (l: TokenBalance[]) => l.reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  return sum(post) - sum(pre);
}

/** The puller's SKR change in a confirmed planting: what the swap delivered minus what the stake took (R207 #2). */
export async function pullerSkrChangeRaw(signature: string): Promise<bigint> {
  const puller = await pullerSigner();
  const tx = await rpc().getTransaction(signature as Parameters<ReturnType<typeof rpc>["getTransaction"]>[0], { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }).send();
  if (!tx?.meta) throw new Error(`transaction ${signature} not found`);
  return skrChangeFromMeta(tx.meta as Parameters<typeof skrChangeFromMeta>[0], puller.address);
}

/** An SPL token account's amount (u64 little-endian at byte 64); no account is zero. */
export function tokenAmountOf(data: Uint8Array | null): bigint {
  if (!data) return 0n;
  if (data.length < 72) throw new Error(`not a token account (${data.length} bytes)`);
  return Buffer.from(data).readBigUInt64LE(64);
}

/**
 * Mainnet simulation, no side effects: signature verification off, blockhash replaced. It also returns the delivery account's
 * balance read right before and as the simulation leaves it (R207 review), so the run can require the swap really delivered.
 * One extra read per planting. A concurrent planting landing between the two can move the pooled SKR account; the check then
 * errs mostly toward refusing, and the next run retries.
 */
export async function simulatePlanting(b: BuiltPlanting): Promise<{ ok: boolean; err: unknown; logs: string[]; units: number; delivery?: { pre: bigint; post: bigint } }> {
  const before = await rpc().getAccountInfo(b.deliveryAccount, { encoding: "base64", commitment: "confirmed" }).send();
  const pre = tokenAmountOf(before.value ? new Uint8Array(Buffer.from(before.value.data[0], "base64")) : null);
  const res = await rpc().simulateTransaction(getBase64EncodedWireTransaction(b.tx), {
    encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed",
    accounts: { encoding: "base64", addresses: [b.deliveryAccount] },
  }).send();
  const after = res.value.accounts?.[0];
  const ok = !res.value.err;
  const delivery = ok ? { pre, post: tokenAmountOf(after ? new Uint8Array(Buffer.from(after.data[0], "base64")) : null) } : undefined;
  return { ok, err: res.value.err, logs: [...(res.value.logs ?? [])], units: Number(res.value.unitsConsumed ?? 0), ...(delivery ? { delivery } : {}) };
}

/** Send and wait for confirmation. May throw after the transaction landed (a dropped websocket): the caller asks the chain. */
export async function sendPlanting(b: BuiltPlanting): Promise<void> {
  const tx = b.tx;
  assertIsTransactionWithBlockhashLifetime(tx);
  const send = sendAndConfirmTransactionFactory({ rpc: rpc(), rpcSubscriptions: createSolanaRpcSubscriptions(config().heliusRpcUrl.replace("https://", "wss://")) });
  await send(tx, { commitment: "confirmed" });
}

/** What the chain says about a signature: landed, landed and failed, or not seen (still in flight or never sent). */
export async function signatureStatus(sig: string): Promise<"confirmed" | "failed" | "pending"> {
  const { value } = await rpc().getSignatureStatuses([sig as Parameters<ReturnType<typeof rpc>["getSignatureStatuses"]>[0][number]], { searchTransactionHistory: true }).send();
  const s = value[0];
  if (!s) return "pending";
  if (s.err) return "failed";
  return s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized" ? "confirmed" : "pending";
}
