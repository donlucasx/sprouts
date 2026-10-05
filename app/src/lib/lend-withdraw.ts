import type { LendingPosition } from './api'
import type { SignFlow } from './sign'
import { VENUE_NAME, type LendAsset } from './coins'
import { COIN_NAME, DECIMALS, positionAmount } from './format'

/** Spec 7, verbatim with a capital: what Withdraw says when a venue cannot pay the position right now. */
export const POOL_FULL_LINE = 'A venue can pause withdrawals when its pool is fully lent out; your money stays yours.'
export const POSITION_CHANGED = 'Your position changed since you opened this. Check it and tap Withdraw again.'
/** R359: the fresh build at the tap would take another amount than the plan on screen. */
export const AMOUNT_CHANGED_LEND = 'The amount changed. Review it and tap Withdraw again.'
/** R359: an API from before partial withdrawals answers an amount with the whole position; the app never signs that. */
export const PARTIAL_NOT_YET = 'Taking out part of a position arrives with the next update. Choose All, or try again later.'
export const WITHDRAWN_LEND_LINE = 'Withdrawn. It is in your Seeker wallet.'
export const WITHDRAWN_PART_LINE = 'Withdrawn. It is in your Seeker wallet; the rest keeps earning.'
const KEEPS_EARNING = 'What stays keeps earning.'

/** What POST /api/lend/withdraw/build answers (contracts 5.3; R359 adds `all`: the transaction takes the whole position). */
export type LendWithdrawBuild = { transaction: string; receiptRaw: string; expectedOutRaw: string; brief: string; all?: boolean }
/** R359: `amountRaw` in the underlying's raw units; absent = the whole position. */
export type LendRequest = { amountRaw?: string }
type Body = { asset: LendingPosition['asset']; venue: LendingPosition['venue'] } & LendRequest
type Position = Pick<LendingPosition, 'asset' | 'venue' | 'receiptRaw' | 'underlyingRaw' | 'poolFull'>

/** R359, the API's LEND_MIN_RAW: the smallest withdrawal (and the smallest rest a part may leave). */
export const LEND_MIN_RAW: Record<LendAsset, bigint> = { USDC_LEND: 10_000n, SOL_LEND: 100_000n }
const MIN_TEXT: Record<LendAsset, string> = { USDC_LEND: '0.01 USDC', SOL_LEND: '0.0001 SOL' }

/** Typed coin ("1.5" or "1,5") to raw units at `decimals`, or null when it is not a number; digits past the last decimal are dropped. */
export function parseCoinAmount(text: string, decimals: number): bigint | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null
  const [whole, frac = ''] = t.split('.')
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

/** Why Continue is off for a typed amount (the API's own words), or null when it is fine. */
export function lendAmountProblem(text: string, p: Pick<LendingPosition, 'asset' | 'underlyingRaw'>): string | null {
  const raw = parseCoinAmount(text, DECIMALS[p.asset])
  if (raw === null) return `Enter an amount in ${COIN_NAME[p.asset]}.`
  if (raw < LEND_MIN_RAW[p.asset]) return `The smallest withdrawal is ${MIN_TEXT[p.asset]}.`
  if (raw > BigInt(p.underlyingRaw)) return 'That is more than this position holds.'
  return null
}

/** The whole position as the field shows it (Max). */
export function lendMaxText(p: Pick<LendingPosition, 'asset' | 'underlyingRaw'>): string {
  const d = DECIMALS[p.asset]
  const raw = BigInt(p.underlyingRaw)
  const frac = (raw % 10n ** BigInt(d)).toString().padStart(d, '0').replace(/0+$/, '')
  return frac ? `${raw / 10n ** BigInt(d)}.${frac}` : `${raw / 10n ** BigInt(d)}`
}

/** The body's amount for the choice on screen; null when the typed amount does not pass. */
export function lendRequest(choice: 'all' | 'amount', text: string, p: Pick<LendingPosition, 'asset' | 'underlyingRaw'>): LendRequest | null {
  if (choice === 'all') return {}
  if (lendAmountProblem(text, p) !== null) return null
  const raw = parseCoinAmount(text, DECIMALS[p.asset])!
  // Review I3: the whole shown value (Max) is All. The screen's value is at the newest snapshot's rate, under the venue's live one, so as
  // an amount it would leave the difference behind.
  return raw === BigInt(p.underlyingRaw) ? {} : { amountRaw: String(raw) }
}

/** The lending withdraw screen's fixed lines (R359, mirroring SKR's): the title, the value, the venue line, the honest notes. */
export function lendScreenLines(p: LendingPosition): { title: string; value: string; venue: string; notes: string[]; poolFull: boolean } {
  const coin = COIN_NAME[p.asset]
  return {
    title: `Withdraw ${coin} from ${VENUE_NAME[p.venue]}`,
    value: positionAmount(p),
    venue: `From ${VENUE_NAME[p.venue]} back to your Seeker wallet as ${coin}.`,
    notes: [KEEPS_EARNING, POOL_FULL_LINE],
    poolFull: p.poolFull,
  }
}

/** The flow the signer checks: the venue's withdraw of exactly `receiptRaw` (the whole position, or the part the build redeems). */
export function lendWithdrawFlow(user: string, p: Pick<LendingPosition, 'asset' | 'venue' | 'receiptRaw'>): SignFlow {
  return p.venue === 'kamino_klend'
    ? { kind: 'withdraw_klend', user, asset: p.asset, receiptRaw: p.receiptRaw }
    : { kind: 'withdraw_jlend', user, asset: p.asset, receiptRaw: p.receiptRaw }
}

/**
 * The build must be the one the screen asked for, checked against the position on screen (never against the build's own claims):
 * All: exactly the position's receipt. A part: more than 0 and less than the receipt, and no more receipt than the amount is worth at
 * the screen's rate plus 1% (the screen's rate is the newest snapshot, at most a little behind the venue's, and rates only rise).
 * An answer without `all` comes from an API that ignores the amount: All only.
 */
function buildProblem(p: Position, request: LendRequest, b: LendWithdrawBuild): string | null {
  const all = b.all ?? (request.amountRaw === undefined ? true : null)
  if (all === null) return PARTIAL_NOT_YET
  if (!/^\d+$/.test(b.receiptRaw)) return POSITION_CHANGED
  const r = BigInt(b.receiptRaw), held = BigInt(p.receiptRaw)
  const shown = BigInt(p.underlyingRaw)
  if (all) {
    if (r !== held) return POSITION_CHANGED
    // Review I2: an amount answered with the whole position only when the rest is dust (under the smallest withdrawal; at the screen's
    // rate, which is at or under the venue's, so a true dust rest always passes, with a 1% margin).
    if (request.amountRaw !== undefined && (shown - BigInt(request.amountRaw)) * 100n >= LEND_MIN_RAW[p.asset] * 101n) return POSITION_CHANGED
    return null
  }
  if (request.amountRaw === undefined) return POSITION_CHANGED   // All asked, a part answered
  const amount = BigInt(request.amountRaw)
  if (r <= 0n || r >= held || shown <= 0n) return POSITION_CHANGED
  return r * shown * 100n <= held * amount * 101n + shown * 100n ? null : POSITION_CHANGED
}

const bodyOf = (p: Position, request: LendRequest): Body => ({ asset: p.asset, venue: p.venue, ...(request.amountRaw !== undefined ? { amountRaw: request.amountRaw } : {}) })

/** Continue (R359): All on a full pool stops here (the read said so); otherwise the plan the screen shows, checked as the tap will be. */
export async function prepareLendWithdraw(a: { position: Position; request: LendRequest; build: (body: Body) => Promise<LendWithdrawBuild> }): Promise<{ plan: LendWithdrawBuild } | { stopped: string }> {
  if (a.position.poolFull && a.request.amountRaw === undefined) return { stopped: POOL_FULL_LINE }
  const plan = await a.build(bodyOf(a.position, a.request))
  const problem = buildProblem(a.position, a.request, plan)
  return problem ? { stopped: problem } : { plan }
}

/**
 * Withdraw (spec 7, R264, R359). The transaction is built again AT the tap (a blockhash lives 60 to 90 s) and must match the plan shown:
 * all or a part as shown, and a part never redeeming more receipt than shown (the rate only rises, so a fresh part is equal or smaller).
 * The signer checks every account against the receipt the build redeems, the Seed Vault signs, the API sends. Errors (the API's 409s,
 * SignRefused) reach the caller as they are.
 */
export async function withdrawLendAtTap(a: {
  user: string
  position: Position
  request: LendRequest
  shown: LendWithdrawBuild
  build: (body: Body) => Promise<LendWithdrawBuild>
  sign: (flow: SignFlow) => (transaction: string) => Promise<string>
  confirm: (body: Body & { signedTransaction: string }) => Promise<unknown>
}): Promise<{ done: true; line: string } | { stopped: string } | { replanned: LendWithdrawBuild; message: string }> {
  const body = bodyOf(a.position, a.request)
  const fresh = await a.build(body)
  const problem = buildProblem(a.position, a.request, fresh)
  if (problem) return { stopped: problem }
  const all = fresh.all ?? true
  if (all !== (a.shown.all ?? true) || (!all && BigInt(fresh.receiptRaw) > BigInt(a.shown.receiptRaw))) return { replanned: fresh, message: AMOUNT_CHANGED_LEND }
  const signedTransaction = await a.sign(lendWithdrawFlow(a.user, { asset: a.position.asset, venue: a.position.venue, receiptRaw: fresh.receiptRaw }))(fresh.transaction)
  await a.confirm({ ...body, signedTransaction })
  return { done: true, line: all ? WITHDRAWN_LEND_LINE : WITHDRAWN_PART_LINE }
}
