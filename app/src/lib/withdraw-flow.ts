/** What /api/withdraw/build answers: the unsigned unstake and the plan the screen shows. */
export type WithdrawPlan = { transaction: string; shares: string; amountRaw: string; prunes: boolean; brief: string[] }
export type WithdrawRequest = { mode: 'earned' | 'amount'; amountRaw?: string }
/** The line the screen shows when the tap re-planned instead of signing (review, round 3 fix 1: never a silent swap). */
export const REPLANNED = 'Your garden changed since you opened this. Check the amount and tap Withdraw again.'

/**
 * Device round 3, item 7 (10-02): the transaction is built AT THE TAP. The plan on screen was built when the amount was picked, and
 * its blockhash runs out in about 60 to 90 s; a wallet approval after that is refused by the chain. So the tap builds again and the
 * wallet signs that fresh transaction. If the fresh plan would prune where the shown one did not (or the other way), nothing is
 * signed: the caller shows the fresh plan and the user taps again.
 */
export async function withdrawAtTap(a: {
  request: WithdrawRequest
  shown: WithdrawPlan
  build: (request: WithdrawRequest) => Promise<WithdrawPlan>
  sign: (transaction: string) => Promise<string>
  confirm: (signedTransaction: string) => Promise<unknown>
}): Promise<{ done: true } | { replanned: WithdrawPlan }> {
  const fresh = await a.build(a.request)
  if (fresh.prunes !== a.shown.prunes) return { replanned: fresh }
  await a.confirm(await a.sign(fresh.transaction))
  return { done: true }
}
