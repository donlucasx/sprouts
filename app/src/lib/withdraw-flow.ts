/** What /api/withdraw/build answers: the unsigned unstake and the plan the screen shows. */
export type WithdrawPlan = { transaction: string; shares: string; amountRaw: string; prunes: boolean; brief: string[] }
export type WithdrawRequest = { mode: 'earned' | 'amount'; amountRaw?: string }
/** The line the screen shows when the tap re-planned instead of signing (review, round 3 fix 1: never a silent swap). */
export const REPLANNED = 'Your garden changed since you opened this. Check the amount and tap Withdraw again.'
/** Security R207 #10 (10-03): the fresh plan would withdraw a different amount than the one on screen. */
export const AMOUNT_CHANGED = 'The amount changed. Review it and tap Withdraw again.'

/**
 * Device round 3, item 7 (10-02): the transaction is built AT THE TAP. The plan on screen was built when the amount was picked, and
 * its blockhash runs out in about 60 to 90 s; a wallet approval after that is refused by the chain. So the tap builds again and the
 * wallet signs that fresh transaction. If the fresh plan would prune where the shown one did not (or the other way), or would
 * withdraw any other amount than the one on screen (security R207 #10: to the raw unit, so a share-price step that moves the dust
 * also asks again), nothing is signed: the caller shows the fresh plan and its `message`, and the user taps again. `sign` is made
 * per plan (security R207 #3): the signer refuses a transaction whose shares are not the fresh plan's.
 */
export async function withdrawAtTap(a: {
  request: WithdrawRequest
  shown: WithdrawPlan
  build: (request: WithdrawRequest) => Promise<WithdrawPlan>
  sign: (plan: WithdrawPlan) => (transaction: string) => Promise<string>
  confirm: (signedTransaction: string) => Promise<unknown>
}): Promise<{ done: true } | { replanned: WithdrawPlan; message: string }> {
  const fresh = await a.build(a.request)
  if (fresh.prunes !== a.shown.prunes) return { replanned: fresh, message: REPLANNED }
  if (fresh.amountRaw !== a.shown.amountRaw) return { replanned: fresh, message: AMOUNT_CHANGED }
  await a.confirm(await a.sign(fresh)(fresh.transaction))
  return { done: true }
}

/**
 * A synchronous in-flight flag for the screen's wallet actions (T8 review Minor 2): React's `busy` state only disables a button after the
 * next render, so two presses in one frame would both start. `enter()` is true for the first caller only, until `leave()`.
 */
export function oneAtATime() {
  let busy = false
  return {
    enter: (): boolean => (busy ? false : (busy = true)),
    leave: (): void => {
      busy = false
    },
  }
}
