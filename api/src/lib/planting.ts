import {
  address, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, compressTransactionMessageUsingAddressLookupTables, signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction, getSignatureFromTransaction, fetchAddressesForLookupTables, sendAndConfirmTransactionFactory,
  createSolanaRpcSubscriptions, assertIsTransactionWithBlockhashLifetime, type Address, type Instruction,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getQuote, getSwapInstructions } from "./jupiter";
import { buildTransferRecurringIx } from "./subscriptions";
import { buildStakeIx } from "./staking";
import { pullerSigner } from "./puller";
import { rpc } from "./rpc";
import { config } from "./config";
import { USDC_MINT, SKR_MINT, STORE_MINT } from "./constants";
import type { Asset } from "@/domain/allocation";

export type BuiltPlanting = {
  tx: Awaited<ReturnType<typeof signTransactionMessageWithSigners>>;
  expectedOutRaw: bigint;
  minOutRaw: bigint;
  lookupTables: Address[];
  lastValidBlockHeight: bigint;
};

/**
 * The planting: one versioned transaction the puller signs alone. Pull USDC from the trading wallet, swap it on Jupiter
 * (SKR into the puller's account, or stORE straight into the Seed Vault's account), and for SKR stake the quoted minimum
 * into the position keyed by the Seed Vault key. If any step fails, nothing moves.
 */
export async function buildPlantingTx(a: { delegator: Address; user: Address; asset: Asset; pullRaw: bigint; feeBps: number; delegationPda: Address }): Promise<BuiltPlanting> {
  const puller = await pullerSigner();
  const outputMint = a.asset === "SKR" ? SKR_MINT : STORE_MINT;
  const feeWallet = address(config().feeWallet);
  const [feeAccount] = await findAssociatedTokenPda({ owner: feeWallet, mint: outputMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  // Direct routes only for SKR (one hop); stORE routes through two pools.
  const quote = await getQuote({ inputMint: USDC_MINT, outputMint, amountRaw: a.pullRaw, platformFeeBps: a.feeBps, maxAccounts: 24, onlyDirectRoutes: a.asset === "SKR" });
  const [userStoreAta] = await findAssociatedTokenPda({ owner: a.user, mint: STORE_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const swap = await getSwapInstructions({ quote, userPublicKey: puller.address, feeAccount, ...(a.asset === "stORE" ? { destinationTokenAccount: userStoreAta } : {}) });
  // Spike 2 confirms whether the threshold is quoted net of the platform fee; the stake uses the post-fee minimum.
  const minOutRaw = BigInt(quote.otherAmountThreshold);

  const ixs: Instruction[] = [
    getSetComputeUnitLimitInstruction({ units: 400_000 }),
    getSetComputeUnitPriceInstruction({ microLamports: 1_000n }),
    await buildTransferRecurringIx({ delegator: a.delegator, delegatee: puller, delegationPda: a.delegationPda, amountRaw: a.pullRaw }),
    ...swap.setup,
    swap.swap,
    ...(swap.cleanup ? [swap.cleanup] : []),
    ...(a.asset === "SKR" ? [await buildStakeIx({ payer: puller, user: a.user, amountRaw: minOutRaw })] : []),
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
  return { tx, expectedOutRaw: BigInt(quote.outAmount), minOutRaw, lookupTables: swap.lookupTables, lastValidBlockHeight };
}

/** Mainnet simulation, no side effects: signature verification off, blockhash replaced. */
export async function simulatePlanting(b: BuiltPlanting): Promise<{ ok: boolean; err: unknown; logs: string[]; units: number }> {
  const res = await rpc().simulateTransaction(getBase64EncodedWireTransaction(b.tx), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true }).send();
  return { ok: !res.value.err, err: res.value.err, logs: [...(res.value.logs ?? [])], units: Number(res.value.unitsConsumed ?? 0) };
}

/** Send and wait for confirmation; returns the signature. */
export async function sendPlanting(b: BuiltPlanting): Promise<string> {
  const tx = b.tx;
  assertIsTransactionWithBlockhashLifetime(tx);
  const send = sendAndConfirmTransactionFactory({ rpc: rpc(), rpcSubscriptions: createSolanaRpcSubscriptions(config().heliusRpcUrl.replace("https://", "wss://")) });
  await send(tx, { commitment: "confirmed" });
  return getSignatureFromTransaction(tx);
}
