import { createNoopSigner, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getInitSubscriptionAuthorityOverlayInstructionAsync,
  getCreateRecurringDelegationOverlayInstructionAsync,
  getTransferRecurringOverlayInstructionAsync,
  getRevokeDelegationOverlayInstruction,
  getRevokeSubscriptionAuthorityOverlayInstructionAsync,
  findSubscriptionAuthorityPda,
  findRecurringDelegationPda,
  fetchMaybeRecurringDelegation,
  UNKNOWN_INIT_ID,
} from "@solana/subscriptions";
import { USDC_MINT } from "./constants";
import { rpc } from "./rpc";

const DAY = 86_400n;
const now = () => BigInt(Math.floor(Date.now() / 1000));

export async function usdcAta(owner: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

/**
 * Approve once: the trading wallet signs two instructions in one transaction. The first creates the per-mint subscription
 * authority (the program becomes the delegate on the USDC account); the second creates the recurring delegation to the puller:
 * `capRaw` per day, starting now, no expiry. The nonce seeds the delegation address, so it is generated at link time and stored.
 * The wallet signs later (Phantom or Mobile Wallet Adapter), so the signer here is a placeholder.
 */
export async function buildApproveOnceIxs(a: { delegator: Address; delegatee: Address; capRaw: bigint; nonce: bigint }): Promise<Instruction[]> {
  const owner = createNoopSigner(a.delegator);
  const userAta = await usdcAta(a.delegator);
  const init = await getInitSubscriptionAuthorityOverlayInstructionAsync({ owner, tokenMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS, userAta });
  const create = await getCreateRecurringDelegationOverlayInstructionAsync({
    delegator: owner,
    delegatee: a.delegatee,
    tokenMint: USDC_MINT,
    amountPerPeriod: a.capRaw,
    periodLengthS: DAY,
    startTs: now(),
    expiryTs: 0n,
    nonce: a.nonce,
    // One-transaction signup: the authority is initialised by the instruction before this one, so its init id is not known
    // yet; the SDK's sentinel tells the program to accept an authority initialised in the current slot (0 fails with error
    // 136 STALE_SUBSCRIPTION_AUTHORITY). A wallet that already has an authority needs its live init id instead (read the
    // SubscriptionAuthority account); re-linking is a Plan 2 concern.
    expectedSubscriptionAuthorityInitId: UNKNOWN_INIT_ID,
  });
  return [init, create];
}

/** The recurring delegation account for a delegator, delegatee and nonce: seeded by the delegator's subscription authority. */
export async function delegationPda(a: { delegator: Address; delegatee: Address; nonce: bigint }): Promise<Address> {
  const [subscriptionAuthority] = await findSubscriptionAuthorityPda({ user: a.delegator, tokenMint: USDC_MINT });
  const [pda] = await findRecurringDelegationPda({ subscriptionAuthority, delegator: a.delegator, delegatee: a.delegatee, nonce: a.nonce });
  return pda;
}

/** Pull USDC from the delegator's account into the delegatee's own account, inside the delegation's period allowance. */
export async function buildTransferRecurringIx(a: { delegator: Address; delegatee: TransactionSigner; delegationPda: Address; amountRaw: bigint }): Promise<Instruction> {
  return getTransferRecurringOverlayInstructionAsync({
    delegatee: a.delegatee,
    delegator: a.delegator,
    delegationPda: a.delegationPda,
    delegatorAta: await usdcAta(a.delegator),
    receiverAta: await usdcAta(a.delegatee.address),
    tokenMint: USDC_MINT,
    amount: a.amountRaw,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    transferHookAccounts: [],
  });
}

/** Revoke everything: close the delegation (rent back to the wallet), then remove the program's delegate and close the authority. */
export async function buildRevokeIxs(a: { delegator: Address; delegationPda: Address }): Promise<Instruction[]> {
  const authority = createNoopSigner(a.delegator);
  return [
    getRevokeDelegationOverlayInstruction({ authority, delegationAccount: a.delegationPda }),
    await getRevokeSubscriptionAuthorityOverlayInstructionAsync({ user: authority, tokenMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS }),
  ];
}

export type DelegationState = { exists: boolean; amountPerPeriodRaw: bigint; pulledInPeriodRaw: bigint; periodStartTs: bigint; periodLengthS: bigint };

/** Read the delegation live: what the limit is, what was pulled this period, and when the period started. */
export async function readDelegation(pda: Address): Promise<DelegationState> {
  const maybe = await fetchMaybeRecurringDelegation(rpc(), pda);
  if (!maybe.exists) return { exists: false, amountPerPeriodRaw: 0n, pulledInPeriodRaw: 0n, periodStartTs: 0n, periodLengthS: 0n };
  const d = maybe.data;
  return {
    exists: true,
    amountPerPeriodRaw: BigInt(d.amountPerPeriod),
    pulledInPeriodRaw: BigInt(d.amountPulledInPeriod),
    periodStartTs: BigInt(d.currentPeriodStartTs),
    periodLengthS: BigInt(d.periodLengthS),
  };
}
