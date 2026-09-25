import {
  getProgramDerivedAddress, getAddressEncoder, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, signTransactionMessageWithSigners,
  assertIsTransactionWithBlockhashLifetime, sendAndConfirmTransactionFactory, createSolanaRpcSubscriptions, getSignatureFromTransaction,
  type Address, type Instruction, type TransactionSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getStakeInstructionAsync, getWithdrawInstructionAsync, fetchMaybeUserStake, fetchStakeConfig } from "@/generated/staking";
import { SKR_STAKING_PROGRAM, STAKE_CONFIG, STAKE_VAULT, GUARDIAN_POOL, SKR_MINT } from "./constants";
import { rpc } from "./rpc";
import { pullerSigner } from "./puller";
import { config } from "./config";

const enc = getAddressEncoder();

/** The staked position keyed by the user (the Seed Vault key): seeds ["user_stake", stake_config, user, guardian_pool]. */
export async function userStakePda(user: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: SKR_STAKING_PROGRAM,
    seeds: ["user_stake", enc.encode(STAKE_CONFIG), enc.encode(user), enc.encode(GUARDIAN_POOL)],
  });
  return pda;
}

export async function skrAta(owner: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: SKR_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

/** stake(amount): only `payer` signs; `user` is the beneficiary and never signs. SKR leaves the payer's token account. */
export async function buildStakeIx(a: { payer: TransactionSigner; user: Address; amountRaw: bigint }): Promise<Instruction> {
  return getStakeInstructionAsync({
    stakeConfig: STAKE_CONFIG,
    guardianPool: GUARDIAN_POOL,
    payer: a.payer,
    user: a.user,
    userStake: await userStakePda(a.user),
    userTokenAccount: await skrAta(a.payer.address),
    stakeVault: STAKE_VAULT,
    mint: SKR_MINT,
    program: SKR_STAKING_PROGRAM,
    amount: a.amountRaw,
  });
}

/** withdraw: permissionless after the 48-hour cooldown; pays out to the user's SKR token account. */
export async function buildWithdrawIx(a: { user: Address }): Promise<Instruction> {
  return getWithdrawInstructionAsync({
    userStake: await userStakePda(a.user),
    stakeConfig: STAKE_CONFIG,
    user: a.user,
    stakeVault: STAKE_VAULT,
    userTokenAccount: await skrAta(a.user),
    program: SKR_STAKING_PROGRAM,
  });
}

/** The permissionless withdraw after the cooldown, sent by the puller as fee payer. Returns the signature. */
export async function crankWithdraw(user: Address): Promise<string> {
  const puller = await pullerSigner();
  const { value: { blockhash, lastValidBlockHeight } } = await rpc().getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(puller, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight }, m),
    (m) => appendTransactionMessageInstructions([], m),
  );
  const withIx = appendTransactionMessageInstructions([await buildWithdrawIx({ user })], message);
  const tx = await signTransactionMessageWithSigners(withIx);
  assertIsTransactionWithBlockhashLifetime(tx);
  const send = sendAndConfirmTransactionFactory({ rpc: rpc(), rpcSubscriptions: createSolanaRpcSubscriptions(config().heliusRpcUrl.replace("https://", "wss://")) });
  await send(tx, { commitment: "confirmed" });
  return getSignatureFromTransaction(tx);
}

export type Position = { shares: bigint; stakedRaw: bigint; unstakingRaw: bigint; unstakeTs: bigint | null };

/** Read live from chain: staked amount = shares times the share price (9 decimals of scale). */
export async function readPosition(user: Address): Promise<Position> {
  const [maybe, cfg] = await Promise.all([fetchMaybeUserStake(rpc(), await userStakePda(user)), fetchStakeConfig(rpc(), STAKE_CONFIG)]);
  if (!maybe.exists) return { shares: 0n, stakedRaw: 0n, unstakingRaw: 0n, unstakeTs: null };
  const shares = BigInt(maybe.data.shares);
  return {
    shares,
    stakedRaw: (shares * BigInt(cfg.data.sharePrice)) / 1_000_000_000n,
    unstakingRaw: BigInt(maybe.data.unstakingAmount),
    unstakeTs: maybe.data.unstakeTimestamp ? BigInt(maybe.data.unstakeTimestamp) : null,
  };
}
