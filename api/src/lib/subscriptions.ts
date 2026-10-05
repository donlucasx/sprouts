import { createNoopSigner, type Address, type Instruction, type TransactionSigner } from "@solana/kit";
import { findAssociatedTokenPda, fetchMaybeToken, getCreateAssociatedTokenIdempotentInstructionAsync, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  getInitSubscriptionAuthorityOverlayInstructionAsync,
  getCreateRecurringDelegationOverlayInstructionAsync,
  getTransferRecurringOverlayInstructionAsync,
  getRevokeDelegationOverlayInstruction,
  getRevokeSubscriptionAuthorityOverlayInstructionAsync,
  findSubscriptionAuthorityPda,
  findRecurringDelegationPda,
  fetchMaybeRecurringDelegation,
  fetchMaybeSubscriptionAuthority,
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
 *
 * Re-link: a wallet whose USDC subscription authority already exists (it linked before, or revoked only the delegation) gets
 * the create alone, carrying that authority's live `initId`; re-running the init would fail on chain.
 *
 * A wallet with no USDC account yet (the Saga, 2026-09-29): `createAta` prepends the idempotent associated-account create, paid
 * by the wallet, since the init sets the program as delegate on that account and fails when it is missing.
 */
/** Whether the wallet's USDC associated token account is on chain. The init sets a delegate on it, so it must exist first. */
export async function readUsdcAtaExists(owner: Address): Promise<boolean> {
  return (await fetchMaybeToken(rpc(), await usdcAta(owner))).exists;
}

export async function buildApproveOnceIxs(a: { delegator: Address; delegatee: Address; capRaw: bigint; nonce: bigint; startTs?: bigint; existingInitId?: bigint; createAta?: boolean }): Promise<Instruction[]> {
  const owner = createNoopSigner(a.delegator);
  const create = await getCreateRecurringDelegationOverlayInstructionAsync({
    delegator: owner,
    delegatee: a.delegatee,
    tokenMint: USDC_MINT,
    amountPerPeriod: a.capRaw,
    periodLengthS: DAY,
    startTs: a.startTs ?? now(), // optional so buildRelink stays pure (API Task 18)
    expiryTs: 0n,
    nonce: a.nonce,
    // One-transaction signup: the authority is initialised by the instruction before this one, so its init id is not known
    // yet; the SDK's sentinel tells the program to accept an authority initialised in the current slot (0 fails with error
    // 136 STALE_SUBSCRIPTION_AUTHORITY). An existing authority needs its live init id instead (`readSubscriptionAuthority`).
    expectedSubscriptionAuthorityInitId: a.existingInitId ?? UNKNOWN_INIT_ID,
  });
  if (a.existingInitId !== undefined) return [create];
  const userAta = await usdcAta(a.delegator);
  const init = await getInitSubscriptionAuthorityOverlayInstructionAsync({ owner, tokenMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS, userAta });
  if (!a.createAta) return [init, create];
  const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: owner, owner: a.delegator, mint: USDC_MINT });
  return [createAta, init, create];
}

export type SubscriptionAuthorityState = { exists: false } | { exists: true; initId: bigint };

/** Whether the wallet's USDC subscription authority is already on chain, and its init id if so (needed to re-link). */
export async function readSubscriptionAuthority(delegator: Address): Promise<SubscriptionAuthorityState> {
  const [pda] = await findSubscriptionAuthorityPda({ user: delegator, tokenMint: USDC_MINT });
  const maybe = await fetchMaybeSubscriptionAuthority(rpc(), pda);
  return maybe.exists ? { exists: true, initId: BigInt(maybe.data.initId) } : { exists: false };
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

/** Revoke one delegation only (rent back to the wallet); the authority stays, so a new delegation can be created in the same transaction. */
export function buildRevokeDelegationIx(a: { delegator: Address; delegationPda: Address }): Instruction {
  return getRevokeDelegationOverlayInstruction({ authority: createNoopSigner(a.delegator), delegationAccount: a.delegationPda });
}

/** Revoke everything: close the delegation (rent back to the wallet), then remove the program's delegate and close the authority. */
export async function buildRevokeIxs(a: { delegator: Address; delegationPda: Address }): Promise<Instruction[]> {
  const authority = createNoopSigner(a.delegator);
  return [
    getRevokeDelegationOverlayInstruction({ authority, delegationAccount: a.delegationPda }),
    await getRevokeSubscriptionAuthorityOverlayInstructionAsync({ user: authority, tokenMint: USDC_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS }),
  ];
}

/** delegator / delegatee / expiryTs: from the account's header and terms when it exists (the re-link confirm binds them); absent otherwise. */
export type DelegationState = { exists: boolean; amountPerPeriodRaw: bigint; pulledInPeriodRaw: bigint; periodStartTs: bigint; periodLengthS: bigint;
  delegator?: Address; delegatee?: Address; expiryTs?: bigint; mint?: Address; subscriptionAuthority?: Address };

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
    delegator: d.header.delegator,
    delegatee: d.header.delegatee,
    expiryTs: BigInt(d.expiryTs),
    mint: d.mint,
    subscriptionAuthority: d.subscriptionAuthority,
  };
}

const RETRY_MS = 2_000;

/** Waits for a delegation to appear (RPC lag right after the signature), up to `waitMs`; the link and re-link confirms poll with it. */
export async function waitForDelegation(pda: Address, waitMs: number): Promise<DelegationState> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const d = await readDelegation(pda);
    if (d.exists) return d;
    if (Date.now() >= deadline) return d;
    await new Promise((r) => setTimeout(r, Math.min(RETRY_MS, Math.max(0, deadline - Date.now()))));
  }
}
