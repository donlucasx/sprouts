import { VENUE_NAME } from './coins'
import { COIN_NAME, formatUsd } from './format'
import { REFUSED, SignRefused, type MovePart, type SignFlow } from './sign'
import type { MoveProposal } from './api'

/** S3 result (Task 0, docs/superpowers/plans/2026-10-05-lending-spike-s3-result.md): VERDICT ONE, so one or two transactions. */
export const MOVE_TXS_ALLOWED: readonly number[] = [1, 2]
/** What POST /api/moves/build answers (contracts 5.4). */
export type MoveBuild = { transactions: string[]; receiptRaw: string; depositRaw: string; brief: string }
export const MOVE_CHANGED = 'Your position changed since this was proposed. Nothing moved.'
export const MOVED_LINE = 'Moved.'
export const MOVE_FAILED = 'The move did not go through. Nothing moved.'

export function moveCopy(p: MoveProposal): { title: string; line: string } {
  const to = VENUE_NAME[p.to], from = VENUE_NAME[p.from]
  return {
    title: `Move your ${COIN_NAME[p.asset]} to ${to}?`,
    line: `${to} has paid ${p.toAvg7Pct.toFixed(1)}% over 7 days, ${from} ${p.fromAvg7Pct.toFixed(1)}%. About ${formatUsd(Math.round(p.gain30dUsd * 100))} more in 30 days, after a network cost of ${formatUsd(Math.round(p.costUsd * 100))}. One approval.`,
  }
}

/** The flows the build implies: one transaction is the whole move; two are redeem then deposit (S3 passed). Anything else is refused. */
export function moveFlows(user: string, p: MoveProposal, built: MoveBuild): SignFlow[] {
  const n = built.transactions.length
  if (!MOVE_TXS_ALLOWED.includes(n)) throw new SignRefused(REFUSED.plan)
  const parts: MovePart[] = n === 1 ? ['whole'] : ['redeem', 'deposit']
  const base = { user, asset: p.asset, receiptRaw: p.receiptRaw, depositRaw: built.depositRaw }
  // Each direction by name (T14 carry-in); a venue pair other than these two is not a move this app signs.
  if (p.from === 'kamino_klend' && p.to === 'jupiter_lend') return parts.map((part) => ({ kind: 'move_klend_to_jlend', ...base, part }))
  if (p.from === 'jupiter_lend' && p.to === 'kamino_klend') return parts.map((part) => ({ kind: 'move_jlend_to_klend', ...base, part }))
  throw new SignRefused(REFUSED.plan)
}

/**
 * Built at the tap (a blockhash lives 60 to 90 s). The build must move the position the card showed; every transaction is checked against
 * its own part, then one wallet session signs them all (S3), then the API sends them in order. Errors (the API's 409s, SignRefused) reach
 * the caller as they are. No confirm retry: the route sends and waits itself and has no not-on-chain-yet answer (contracts 5.4).
 */
export async function moveAtTap(a: {
  user: string
  proposal: MoveProposal
  build: (id: string) => Promise<MoveBuild>
  signAll: (flows: SignFlow[]) => (transactions: string[]) => Promise<string[]>
  confirm: (body: { id: string; signedTransactions: string[] }) => Promise<unknown>
  onSigned?: () => void
}): Promise<{ done: true } | { stopped: string }> {
  const built = await a.build(a.proposal.id)
  if (built.receiptRaw !== a.proposal.receiptRaw) return { stopped: MOVE_CHANGED }
  const signedTransactions = await a.signAll(moveFlows(a.user, a.proposal, built))(built.transactions)
  a.onSigned?.()
  await a.confirm({ id: a.proposal.id, signedTransactions })
  return { done: true }
}
