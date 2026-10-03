/**
 * Security R207 #3 (10-03): transactions built the way the API builds them, from the API's OWN builders (imported from api/src, not
 * copied), so a change to an API builder that the app's signer check does not follow fails app/tests/lib/sign.test.ts. The shape is
 * api/src/lib/user-tx.ts buildUserTransaction (and link/[code]'s, the same): v0, the wallet as fee payer, no lookup table, unsigned.
 * Only builders that never touch the network are imported (staking.ts and the routes read the chain; their instruction calls are
 * repeated here with the same arguments).
 */
import {
  address, appendTransactionMessageInstructions, compileTransaction, createNoopSigner, createTransactionMessage, getBase64EncodedWireTransaction,
  pipe, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, type Address, type Blockhash, type Instruction,
} from '@solana/kit'
import { getCancelUnstakeInstructionAsync, getUnstakeInstructionAsync } from '../../../api/src/generated/staking'
import { GUARDIAN_POOL, SKR_MINT, SKR_STAKING_PROGRAM, STAKE_CONFIG, STAKE_VAULT } from '../../../api/src/lib/constants'
import { buildApproveOnceIxs, buildRevokeDelegationIx, buildRevokeIxs, delegationPda } from '../../../api/src/lib/subscriptions'
import { userStakePda } from '@/lib/sign'

export const USER = address('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
export const OTHER = address('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')
export const PULLER = address('HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH')
const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N' as Blockhash

/** buildUserTransaction's shape, with the fee payer a parameter so a test can build one for someone else. */
export function wire(ixs: Instruction[], feePayer: Address = USER): string {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(createNoopSigner(feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  )
  return getBase64EncodedWireTransaction(compileTransaction(message))
}

/** api/src/lib/staking.ts buildUnstakeIx, same arguments (its userStakePda is the API's; the app derives the same address). */
export async function unstakeIx(shares: bigint, user: Address = USER, position?: Address): Promise<Instruction> {
  return getUnstakeInstructionAsync({
    user: createNoopSigner(user), stakeConfig: STAKE_CONFIG, guardianPool: GUARDIAN_POOL, userStake: position ?? ((await userStakePda(user)) as Address),
    stakeVault: STAKE_VAULT, mint: SKR_MINT, shares, program: SKR_STAKING_PROGRAM,
  }) as Promise<Instruction>
}

/** api/src/lib/staking.ts buildCancelUnstakeIx, same arguments. */
export async function cancelIx(user: Address = USER, position?: Address): Promise<Instruction> {
  return getCancelUnstakeInstructionAsync({
    user: createNoopSigner(user), stakeConfig: STAKE_CONFIG, guardianPool: GUARDIAN_POOL, userStake: position ?? ((await userStakePda(user)) as Address),
    stakeVault: STAKE_VAULT, program: SKR_STAKING_PROGRAM,
  }) as Promise<Instruction>
}

/** link/[code] GET: approve once at $5 a day (DAILY_CAP_RAW), optionally the first link of a wallet with no USDC account, or a re-link. */
export async function linkIxs(o: { capRaw?: bigint; existingInitId?: bigint; createAta?: boolean; revokeOld?: boolean } = {}): Promise<Instruction[]> {
  const ixs = (await buildApproveOnceIxs({ delegator: USER, delegatee: PULLER, capRaw: o.capRaw ?? 5_000_000n, nonce: 42n, existingInitId: o.existingInitId, createAta: o.createAta })) as Instruction[]
  if (o.revokeOld) ixs.unshift(buildRevokeDelegationIx({ delegator: USER, delegationPda: await delegationPda({ delegator: USER, delegatee: PULLER, nonce: 7n }) }) as Instruction)
  return ixs
}

/** revoke/[wallet] GET: revoke the delegation, then the authority. */
export async function revokeIxs(): Promise<Instruction[]> {
  return (await buildRevokeIxs({ delegator: USER, delegationPda: await delegationPda({ delegator: USER, delegatee: PULLER, nonce: 42n }) })) as Instruction[]
}
