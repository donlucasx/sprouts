import { VENUE_NAME } from './coins'
import { COIN_NAME, formatUsd } from './format'
import { REFUSED, SignRefused, type MovePart, type SignFlow } from './sign'
import type { LendingPosition, MoveProposal } from './api'
import { percent } from "@/i18n/format"
import { t } from "@/i18n"

/** S3 result (Task 0, docs/superpowers/plans/2026-10-05-lending-spike-s3-result.md): VERDICT ONE, so one or two transactions. */
export const MOVE_TXS_ALLOWED: readonly number[] = [1, 2]
/** What POST /api/moves/build answers (contracts 5.4). */
export type MoveBuild = { transactions: string[]; receiptRaw: string; depositRaw: string; brief: string }
/**
 * The card's lines, read in the current language at use time (0.1.13). `inFlight` is the API's IN_FLIGHT sentence (a stored redeem
 * signature): the card shows it instead of the buttons, and build / dismiss answer it as a 409 with `inFlight: true` (detected by that
 * flag, never by matching the text). `sent`, as the re-link card's: once the Seeker signed, a failed confirm may still have sent the move.
 */
export const MOVE = {
  get changed() { return t('move.changed') },
  get inFlight() { return t('move.inFlight') },
  get moved() { return t('move.moved') },
  get failed() { return t('move.failed') },
  get sent() { return t('move.sent') },
}

/** A confirm that failed after the Seed Vault signed, with no answer from the route itself: the move may still land. */
export class MoveSent extends Error {
  constructor(public reason: unknown) {
    super(MOVE.sent)
    this.name = 'MoveSent'
  }
}

/**
 * T14 fix round 1: the deposit cap is the source position's underlyingRaw, the /api/me position (asset, from venue) the card is based on.
 * No such position, or no usable amount: null, and the move is refused rather than signed unbounded.
 */
export function depositCap(p: MoveProposal, positions: readonly Pick<LendingPosition, 'asset' | 'venue' | 'underlyingRaw'>[] | undefined): string | null {
  const pos = (positions ?? []).find((x) => x.asset === p.asset && x.venue === p.from)
  return pos && /^\d+$/.test(pos.underlyingRaw ?? '') && BigInt(pos.underlyingRaw) > 0n ? pos.underlyingRaw : null
}

export function moveCopy(p: MoveProposal): { title: string; line: string } {
  const to = VENUE_NAME[p.to], from = VENUE_NAME[p.from]
  return {
    title: t('move.title', { coin: COIN_NAME[p.asset], venue: to }),
    line: t('move.line', { to, toPct: percent(p.toAvg7Pct, 1), from, fromPct: percent(p.fromAvg7Pct, 1), gain: formatUsd(Math.round(p.gain30dUsd * 100)), cost: formatUsd(Math.round(p.costUsd * 100)) }),
  }
}

/** The flows the build implies: one transaction is the whole move; two are redeem then deposit (S3 passed). Anything else is refused. */
export function moveFlows(user: string, p: MoveProposal, built: MoveBuild, capRaw: string | null): SignFlow[] {
  const n = built.transactions.length
  if (!MOVE_TXS_ALLOWED.includes(n) || capRaw === null) throw new SignRefused(REFUSED.plan)
  const parts: MovePart[] = n === 1 ? ['whole'] : ['redeem', 'deposit']
  const base = { user, asset: p.asset, receiptRaw: p.receiptRaw, depositRaw: built.depositRaw, depositCapRaw: capRaw }
  // Each direction by name (T14 carry-in); a venue pair other than these two is not a move this app signs.
  if (p.from === 'kamino_klend' && p.to === 'jupiter_lend') return parts.map((part) => ({ kind: 'move_klend_to_jlend', ...base, part }))
  if (p.from === 'jupiter_lend' && p.to === 'kamino_klend') return parts.map((part) => ({ kind: 'move_jlend_to_klend', ...base, part }))
  throw new SignRefused(REFUSED.plan)
}

/**
 * Built at the tap (a blockhash lives 60 to 90 s). The build must move the position the card showed; every transaction is checked against
 * its own part, then one wallet session signs them all (S3), then the API sends them in order. Errors (the API's 409s, SignRefused) reach
 * the caller as they are, except a confirm failure with no route answer after signing, which is MoveSent. No confirm retry: the route sends and waits itself and has no not-on-chain-yet answer (contracts 5.4).
 */
export async function moveAtTap(a: {
  user: string
  proposal: MoveProposal
  /** /api/me positions, read with the card: the deposit cap comes from the proposal's source position. */
  positions: readonly Pick<LendingPosition, 'asset' | 'venue' | 'underlyingRaw'>[] | undefined
  build: (id: string) => Promise<MoveBuild>
  signAll: (flows: SignFlow[]) => (transactions: string[]) => Promise<string[]>
  confirm: (body: { id: string; signedTransactions: string[] }) => Promise<unknown>
  onSigned?: () => void
}): Promise<{ done: true } | { stopped: string }> {
  const built = await a.build(a.proposal.id)
  if (built.receiptRaw !== a.proposal.receiptRaw) return { stopped: MOVE.changed }
  const signedTransactions = await a.signAll(moveFlows(a.user, a.proposal, built, depositCap(a.proposal, a.positions)))(built.transactions)
  a.onSigned?.()
  try {
    await a.confirm({ id: a.proposal.id, signedTransactions })
  } catch (e) {
    // The route's own 4xx sentence (e.g. the 409 partial) is shown as is; anything else (network, timeout, 5xx) may have sent the move.
    // Duck-typed on ApiError's shape so this module stays free of api.ts for the node tests.
    const status = e instanceof Error ? (e as { status?: unknown }).status : undefined
    if (typeof status === 'number' && status >= 400 && status < 500) throw e
    throw new MoveSent(e)
  }
  return { done: true }
}

/** A 409 that says the move is already under way (build and dismiss, `inFlight: true`): the same sentence the card shows. Duck-typed like moveAtTap's status check. */
export function isMoveInFlight(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const { status, body } = e as { status?: unknown; body?: { inFlight?: unknown } }
  return status === 409 && body?.inFlight === true
}
