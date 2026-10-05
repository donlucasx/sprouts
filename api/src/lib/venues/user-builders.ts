import { createNoopSigner, type Address, type Instruction } from "@solana/kit";
import { findAssociatedTokenPda, getCloseAccountInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { WSOL_MINT } from "../constants";
import { buildKlendWithdrawIxs, buildKlendUserDepositIxs } from "./klend";
import { buildJlendWithdrawIxs, buildJlendUserDepositIxs } from "./jlend";
import { buildApproveOnceIxs, buildRevokeDelegationIx } from "../subscriptions";
import { leashPda } from "../leash";
import type { LendAsset } from "@/domain/coins";
import type { AutoVenue } from "@/domain/venues";

/**
 * Every transaction the Seed Vault signs for lending and the re-link (contracts 6), built without the network so the app's signer test
 * signs this exact output. v0, no lookup table, the user pays and signs alone (buildUserTransaction wraps them). No ComputeBudget
 * instruction, ever (contracts 6 AMEND s20: the app's sign.ts refuses one).
 */
export const buildKlendWithdraw = (a: { user: Address; asset: LendAsset; receiptRaw: bigint }) => buildKlendWithdrawIxs(a);
export const buildJlendWithdraw = (a: { user: Address; asset: LendAsset; receiptRaw: bigint }) => buildJlendWithdrawIxs(a);
export const buildLendWithdraw = (a: { user: Address; asset: LendAsset; venue: AutoVenue; receiptRaw: bigint }) =>
  a.venue === "kamino_klend" ? buildKlendWithdraw(a) : buildJlendWithdraw(a);

/**
 * Contracts 6 move_*: the redeem part is the source's withdraw with the WSOL account kept open (SOL: the deposit part spends it);
 * the deposit part is the target's deposit, and for SOL it closes the WSOL account at its tail, so the redeem's remainder (the
 * 0.1% the deposit leaves) comes back as plain SOL in the same transaction.
 */
export async function buildMove(a: { user: Address; asset: LendAsset; from: AutoVenue; to: AutoVenue; receiptRaw: bigint; depositRaw: bigint; part: "redeem" | "deposit" | "whole" }): Promise<Instruction[]> {
  if (a.from === a.to) throw new Error("a move needs two different venues");
  const w = { user: a.user, asset: a.asset, receiptRaw: a.receiptRaw, keepWsolOpen: true };
  const redeem = a.from === "kamino_klend" ? await buildKlendWithdrawIxs(w) : await buildJlendWithdrawIxs(w);
  const deposit = a.to === "kamino_klend" ? await buildKlendUserDepositIxs({ user: a.user, asset: a.asset, depositRaw: a.depositRaw }) : await buildJlendUserDepositIxs({ user: a.user, asset: a.asset, depositRaw: a.depositRaw });
  return a.part === "redeem" ? redeem : a.part === "deposit" ? deposit : [...redeem, ...deposit];
}

/**
 * A SOL move whose redeem landed and whose deposit did not leaves the redeemed SOL wrapped in the user's WSOL account (the deposit's
 * closing CloseAccount reverted with it). This one instruction closes that account to the user: every lamport, wrapped or rent, back
 * as plain SOL. CloseAccount on a native account needs no zero balance.
 */
export async function buildUnwrapWsol(a: { user: Address }): Promise<Instruction[]> {
  const [wsol] = await findAssociatedTokenPda({ owner: a.user, mint: WSOL_MINT, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return [getCloseAccountInstruction({ account: wsol, destination: a.user, owner: createNoopSigner(a.user) }) as Instruction];
}

/** Contracts 5.5: [revoke the current delegation], [ATA], [init authority], create(delegatee = leashPda(user, user), $5/day, no expiry). */
export async function buildRelink(a: { user: Address; nonce: bigint; startTs: bigint; existingDelegationPda: Address | null; existingInitId?: bigint; createAta: boolean }): Promise<Instruction[]> {
  const ixs = await buildApproveOnceIxs({ delegator: a.user, delegatee: await leashPda(a.user, a.user), capRaw: 5_000_000n, nonce: a.nonce, startTs: a.startTs, ...(a.existingInitId !== undefined ? { existingInitId: a.existingInitId } : {}), createAta: a.createAta });
  return a.existingDelegationPda ? [buildRevokeDelegationIx({ delegator: a.user, delegationPda: a.existingDelegationPda }), ...ixs] : ixs;
}
