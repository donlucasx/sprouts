import type { LendingPosition } from './api'
import type { SignFlow } from './sign'
import { VENUE_NAME, type LendAsset } from './coins'
import { COIN_NAME, DECIMALS, positionAmount } from './format'
import { en } from '@/i18n/en'
import { t, type Lang } from '@/i18n'
import { decimalSeparator } from '@/i18n/format'

/** Spec 7, verbatim with a capital: what Withdraw says when a venue cannot pay the position right now.
 *  0.1.13: these constants hold the English (tests, the About drift test); the screen gets t() at use time. */
export const POOL_FULL_LINE = en['lend.poolFull']
export const POSITION_CHANGED = en['lend.positionChanged']
/** R359: the fresh build at the tap would take another amount than the plan on screen. */
export const AMOUNT_CHANGED_LEND = en['withdraw.amountChanged']
/** R359: an API from before partial withdrawals answers an amount with the whole position; the app never signs that. */
export const PARTIAL_NOT_YET = en['lend.partialNotYet']
export const WITHDRAWN_LEND_LINE = en['lend.withdrawn']
export const WITHDRAWN_PART_LINE = en['lend.withdrawnPart']

/** What POST /api/lend/withdraw/build answers (contracts 5.3; R359 adds `all`: the transaction takes the whole position). */
export type LendWithdrawBuild = { transaction: string; receiptRaw: string; expectedOutRaw: string; brief: string; all?: boolean }
/** R359: `amountRaw` in the underlying's raw units; absent = the whole position. */
export type LendRequest = { amountRaw?: string }
type Body = { asset: LendingPosition['asset']; venue: LendingPosition['venue'] } & LendRequest
type Position = Pick<LendingPosition, 'asset' | 'venue' | 'receiptRaw' | 'underlyingRaw' | 'poolFull'>

/** R359, the API's LEND_MIN_RAW: the smallest withdrawal (and the smallest rest a part may leave). */
export const LEND_MIN_RAW: Record<LendAsset, bigint> = { USDC_LEND: 10_000n, SOL_LEND: 100_000n }
/** The smallest withdrawal in words, with the language's decimal separator: "0.01 USDC" (es "0,01 USDC"). */
const minText = (a: LendAsset, lang?: Lang): string => (a === 'USDC_LEND' ? `0${decimalSeparator(lang)}01 USDC` : `0${decimalSeparator(lang)}0001 SOL`)

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
  if (raw === null) return t('withdraw.enterAmount', { coin: COIN_NAME[p.asset] })
  if (raw < LEND_MIN_RAW[p.asset]) return t('withdraw.min', { min: minText(p.asset) })
  if (raw > BigInt(p.underlyingRaw)) return t('lend.tooMuch')
  return null
}

/** The whole position as the field shows it (Max): no grouping, the language's decimal separator (parseCoinAmount reads both). */
export function lendMaxText(p: Pick<LendingPosition, 'asset' | 'underlyingRaw'>, lang?: Lang): string {
  const d = DECIMALS[p.asset]
  const raw = BigInt(p.underlyingRaw)
  const frac = (raw % 10n ** BigInt(d)).toString().padStart(d, '0').replace(/0+$/, '')
  return frac ? `${raw / 10n ** BigInt(d)}${decimalSeparator(lang)}${frac}` : `${raw / 10n ** BigInt(d)}`
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
    title: t('withdraw.row.lend', { coin, venue: VENUE_NAME[p.venue] }),
    value: positionAmount(p),
    venue: t('lend.venue', { venue: VENUE_NAME[p.venue], coin }),
    notes: [t('lend.keepsEarning'), t('lend.poolFull')],
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
  if (all === null) return t('lend.partialNotYet')
  if (!/^\d+$/.test(b.receiptRaw)) return t('lend.positionChanged')
  const r = BigInt(b.receiptRaw), held = BigInt(p.receiptRaw)
  const shown = BigInt(p.underlyingRaw)
  if (all) {
    if (r !== held) return t('lend.positionChanged')
    // Review I2: an amount answered with the whole position only when the rest is dust (under the smallest withdrawal; at the screen's
    // rate, which is at or under the venue's, so a true dust rest always passes, with a 1% margin).
    if (request.amountRaw !== undefined && (shown - BigInt(request.amountRaw)) * 100n >= LEND_MIN_RAW[p.asset] * 101n) return t('lend.positionChanged')
    return null
  }
  if (request.amountRaw === undefined) return t('lend.positionChanged')   // All asked, a part answered
  const amount = BigInt(request.amountRaw)
  if (r <= 0n || r >= held || shown <= 0n) return t('lend.positionChanged')
  return r * shown * 100n <= held * amount * 101n + shown * 100n ? null : t('lend.positionChanged')
}

const bodyOf = (p: Position, request: LendRequest): Body => ({ asset: p.asset, venue: p.venue, ...(request.amountRaw !== undefined ? { amountRaw: request.amountRaw } : {}) })

/** Continue (R359): All on a full pool stops here (the read said so); otherwise the plan the screen shows, checked as the tap will be. */
export async function prepareLendWithdraw(a: { position: Position; request: LendRequest; build: (body: Body) => Promise<LendWithdrawBuild> }): Promise<{ plan: LendWithdrawBuild } | { stopped: string }> {
  if (a.position.poolFull && a.request.amountRaw === undefined) return { stopped: t('lend.poolFull') }
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
  if (all !== (a.shown.all ?? true) || (!all && BigInt(fresh.receiptRaw) > BigInt(a.shown.receiptRaw))) return { replanned: fresh, message: t('withdraw.amountChanged') }
  const signedTransaction = await a.sign(lendWithdrawFlow(a.user, { asset: a.position.asset, venue: a.position.venue, receiptRaw: fresh.receiptRaw }))(fresh.transaction)
  await a.confirm({ ...body, signedTransaction })
  return { done: true, line: all ? t('lend.withdrawn') : t('lend.withdrawnPart') }
}
