import type { Address, Instruction } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
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

const isClose = (ix: Instruction) => ix.programAddress === TOKEN_PROGRAM_ADDRESS && ix.data?.length === 1 && ix.data[0] === 9;
/** Contracts 6 move_*: the redeem part is the source's withdraw minus the WSOL close; the deposit part is the target's deposit (SOL closes WSOL at the end). */
export async function buildMove(a: { user: Address; asset: LendAsset; from: AutoVenue; to: AutoVenue; receiptRaw: bigint; depositRaw: bigint; part: "redeem" | "deposit" | "whole" }): Promise<Instruction[]> {
  if (a.from === a.to) throw new Error("a move needs two different venues");
  const redeem = (await buildLendWithdraw({ user: a.user, asset: a.asset, venue: a.from, receiptRaw: a.receiptRaw })).filter((ix) => !isClose(ix));
  const deposit = a.to === "kamino_klend" ? await buildKlendUserDepositIxs({ user: a.user, asset: a.asset, depositRaw: a.depositRaw }) : await buildJlendUserDepositIxs({ user: a.user, asset: a.asset, depositRaw: a.depositRaw });
  return a.part === "redeem" ? redeem : a.part === "deposit" ? deposit : [...redeem, ...deposit];
}

/** Contracts 5.5: [revoke the current delegation], [ATA], [init authority], create(delegatee = leashPda(user, user), $5/day, no expiry). */
export async function buildRelink(a: { user: Address; nonce: bigint; startTs: bigint; existingDelegationPda: Address | null; existingInitId?: bigint; createAta: boolean }): Promise<Instruction[]> {
  const ixs = await buildApproveOnceIxs({ delegator: a.user, delegatee: await leashPda(a.user, a.user), capRaw: 5_000_000n, nonce: a.nonce, startTs: a.startTs, ...(a.existingInitId !== undefined ? { existingInitId: a.existingInitId } : {}), createAta: a.createAta });
  return a.existingDelegationPda ? [buildRevokeDelegationIx({ delegator: a.user, delegationPda: a.existingDelegationPda }), ...ixs] : ixs;
}
