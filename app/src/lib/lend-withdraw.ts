import type { LendingPosition } from './api'
import type { SignFlow } from './sign'

/** Spec 7, verbatim with a capital: what Withdraw says when a venue cannot pay the position right now. */
export const POOL_FULL_LINE = 'A venue can pause withdrawals when its pool is fully lent out; your money stays yours.'
export const POSITION_CHANGED = 'Your position changed since you opened this. Check it and tap Withdraw again.'
export const WITHDRAWN_LEND_LINE = 'Withdrawn. It is in your Seeker wallet.'
/** What POST /api/lend/withdraw/build answers (contracts 5.3). */
export type LendWithdrawBuild = { transaction: string; receiptRaw: string; expectedOutRaw: string; brief: string }
type Body = { asset: LendingPosition['asset']; venue: LendingPosition['venue'] }

/** The flow the signer checks: the venue's withdraw, for exactly the position the screen showed. */
export function lendWithdrawFlow(user: string, p: Pick<LendingPosition, 'asset' | 'venue' | 'receiptRaw'>): SignFlow {
  return p.venue === 'kamino_klend'
    ? { kind: 'withdraw_klend', user, asset: p.asset, receiptRaw: p.receiptRaw }
    : { kind: 'withdraw_jlend', user, asset: p.asset, receiptRaw: p.receiptRaw }
}

/**
 * One tap per position (spec 7, R264). A full pool stops here (the read said so). Otherwise the transaction is built AT the tap (a
 * blockhash lives 60 to 90 s), the build's position must be the one on screen (a planting may have landed since), the signer checks every
 * account against that position, the Seed Vault signs, the API sends. Errors (the API's 409s, SignRefused) reach the caller as they are.
 */
export async function withdrawLendAtTap(a: {
  user: string
  position: Pick<LendingPosition, 'asset' | 'venue' | 'receiptRaw' | 'poolFull'>
  build: (body: Body) => Promise<LendWithdrawBuild>
  sign: (flow: SignFlow) => (transaction: string) => Promise<string>
  confirm: (body: Body & { signedTransaction: string }) => Promise<unknown>
}): Promise<{ done: true } | { stopped: string }> {
  if (a.position.poolFull) return { stopped: POOL_FULL_LINE }
  const body: Body = { asset: a.position.asset, venue: a.position.venue }
  const built = await a.build(body)
  if (built.receiptRaw !== a.position.receiptRaw) return { stopped: POSITION_CHANGED }
  const signedTransaction = await a.sign(lendWithdrawFlow(a.user, a.position))(built.transaction)
  await a.confirm({ ...body, signedTransaction })
  return { done: true }
}
