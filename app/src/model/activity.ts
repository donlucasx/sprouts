import type { ActivityResponse, FoundVenue, SplitRow } from '@/lib/api'
import { isRetired, VENUE_NAME, type LiveAsset, type Stop } from '@/lib/coins'
import { arrivalLine, COIN_NAME, COIN_NAME_LONG, dayLabel, dayTime, formatSkr, formatUsd, legLabel, plantedLine, underlyingAmount } from '@/lib/format'
import { changeSummary, STOP_LABEL } from './manager'

/** R284: every Activity row is ONE plain line; its details and its transaction open with a tap. */
export type ActivityRow = { key: string; line: string; details: string[]; signature: string | null }
type Planting = ActivityResponse['plantings'][number]
type Leg = Planting['legs'][number] & { asset: LiveAsset }
type Swap = Pick<ActivityResponse['swaps'][number], 'usdSizeCents' | 'roundupCents' | 'plantingId'>
type Withdrawal = Pick<ActivityResponse['withdrawals'][number], 'amountRaw' | 'cancelled' | 'delivered' | 'source' | 'ts'>
type LendWithdrawal = NonNullable<ActivityResponse['lendWithdrawals']>[number]
type Move = NonNullable<ActivityResponse['moves']>[number]

/** "Oct 5, planted $2.00: USDC lending (Kamino)"; several legs as shares. A retired coin's planting is not a row (R281). */
export function plantingRow(day: string, p: Planting): ActivityRow | null {
  const legs = p.legs.filter((l): l is Leg => !isRetired(l.asset))
  if (p.legs.length > 0 && legs.length === 0) return null
  const base = { key: p.id, signature: p.signature }
  if (p.status === 'failed') return { ...base, line: `${day}, a planting did not land. Nothing moved.`, details: [] }
  if (p.status !== 'confirmed' || legs.length === 0) return { ...base, line: `${day}, a planting is on its way.`, details: [] }
  const total = legs.reduce((s, l) => s + l.usdcInCents, 0)
  const what = legs.length === 1
    ? legLabel(legs[0].asset, legs[0].venue)
    : legs.map((l) => `${total > 0 ? Math.round((100 * l.usdcInCents) / total) : 0}% ${legLabel(l.asset, l.venue)}`).join(', ')
  const details = legs.map((l) => plantedLine({ usdcInCents: l.usdcInCents, asset: l.asset, amountOutRaw: l.amountOutRaw, usdPrice: l.usdPrice ?? null, feeCents: l.feeCents, feeAmountRaw: l.feeAmountRaw, venue: l.venue }))
  if (p.networkFeeCents > 0) details.push(`Network fee ${formatUsd(p.networkFeeCents)}`)
  return { ...base, line: `${day}, planted ${formatUsd(total)}: ${what}`, details }
}

/** A split change in one line; what moved and the manager's why behind the tap. Dated by the API's UTC day (the Rules card's "Changed"). */
export function splitRow(s: SplitRow, i: number): ActivityRow {
  const day = dayTime(s.ts) // R350: the time too, so the phone's zone (was the API's UTC day)
  const summary = changeSummary(s.from, s.to)
  const stop = s.stop ? `${STOP_LABEL[s.stop as Stop] ?? s.stop}.` : ''
  const base = { key: `${s.ts}-${i}`, signature: null }
  if (s.by === 'undo') return { ...base, line: `${day}, undone. The Yield Manager is off.`, details: ["Yesterday's split is back."] }
  if (s.by === 'you' && s.turnedOn) return { ...base, line: `${day}, you turned the Yield Manager on`, details: [stop, summary].filter(Boolean) }
  if (s.by === 'you') return { ...base, line: `${day}, you changed your split`, details: summary ? [summary] : stop ? [stop] : [] }
  if (s.fallback) return { ...base, line: `${day}, your split moved by rule today`, details: summary ? [summary] : [] }
  return { ...base, line: `${day}, the Yield Manager moved your split`, details: [summary, s.why ?? ''].filter(Boolean) }
}

export function swapRow(day: string, s: Swap & { signature: string }): ActivityRow {
  return { key: s.signature, line: swapRowLine(day, s), details: [], signature: s.signature }
}

export function withdrawalRow(day: string, w: Withdrawal & { id: string; withdrawSignature: string | null; unstakeSignature: string | null }, skrUsd: number | null, readyAt?: string, now: Date = new Date()): ActivityRow {
  return { key: w.id, line: withdrawalRowLine(day, w, skrUsd, readyAt, now), details: [], signature: w.withdrawSignature ?? w.unstakeSignature }
}

/** Spec 7: a lending position back to the wallet. underlyingRaw is null when the API does not know the amount; then the line names the coin and no amount. */
export function lendWithdrawalRow(day: string, w: LendWithdrawal): ActivityRow {
  const what = w.underlyingRaw && /^\d+$/.test(w.underlyingRaw) ? underlyingAmount(w.asset, w.underlyingRaw) : `your ${COIN_NAME_LONG[w.asset]}`
  return { key: `lw-${w.signature}`, line: `${day}, withdrew ${what} from ${VENUE_NAME[w.venue]}`, details: ['Back in your Seeker wallet.'], signature: w.signature }
}

/** Spec 7: a move the user approved or turned down; an open or expired proposal is the card's, not a row. */
export function moveRow(day: string, m: Move): ActivityRow | null {
  const coin = COIN_NAME[m.asset], from = VENUE_NAME[m.from], to = VENUE_NAME[m.to]
  const base = { key: `mv-${m.ts}`, signature: null }
  if (m.status === 'done') return { ...base, line: `${day}, moved your ${coin} from ${from} to ${to}`, details: [] }
  if (m.status === 'failed') return { ...base, line: m.asset === 'SOL_LEND' ? `${day}, moving your SOL didn't finish. Your SOL is in your wallet. If it shows as wrapped SOL, unwrap it in your wallet.` : `${day}, moving your ${coin} didn't finish. It is back in your wallet.`, details: [`${from} to ${to}.`] }
  if (m.status === 'dismissed') return { ...base, line: `${day}, you kept your ${coin} on ${from}`, details: [] }
  return null
}

/** R278: what the Yield Manager found; shown, never routed to. */
export const FOUND_NOTE = 'Not used: Sprouts lends only on Kamino and Jupiter.'
export const FOUND_SECTION = { title: 'Found by the Yield Manager', sub: 'Places it found paying more. Sprouts does not put money there.' } as const
export function foundRow(f: FoundVenue): ActivityRow {
  return {
    key: `f-${f.day}-${f.project}-${f.symbol}`,
    line: `${dayLabel(f.day)}, found ${f.project} ${f.symbol}${f.apyBasePct !== null ? ` at ${f.apyBasePct.toFixed(1)}%` : ''}`,
    details: [f.note ?? '', FOUND_NOTE].filter(Boolean),
    signature: null,
  }
}

export function swapRowLine(day: string, s: Swap): string {
  const size = s.usdSizeCents === null ? 'unpriced swap' : `${formatUsd(s.usdSizeCents)} swap`
  return `${day}, ${size}, change ${formatUsd(s.roundupCents)}${s.plantingId ? ', planted' : ', waiting'}`
}

const COOLDOWN_MS = 172_800_000
/** R156: the row says when the SKR arrives (the staking program's 48 hours after the unstake), in the phone's time zone; once that time has passed it says "arriving today" (R165). A withdrawal the basket knows the chain's time for says that time (a wallet-started row's ts is when Sprouts found it). */

export function withdrawalRowLine(day: string, w: Withdrawal, skrUsd: number | null, readyAt?: string, now: Date = new Date()): string {
  const amount = w.amountRaw ? formatSkr(BigInt(w.amountRaw), skrUsd) : 'an amount'
  const state = w.cancelled ? 'put back' : w.delivered ? 'delivered' : arrivalLine(readyAt ? new Date(readyAt) : new Date(new Date(w.ts).getTime() + COOLDOWN_MS), now)
  return `${day}, ${amount}, ${state}${w.source === 'wallet' ? ', from your wallet' : ''}`
}

/** R156 (supersedes R94's third line): the one-line explainer under the withdrawals; R171 names it Withdraw. */
export const WITHDRAWN_LINE = 'What you withdrew.'

/** A section shows its latest five rows (the API serves fifty, newest first); "Show N more" opens the rest in place (his note 6). */
export function visibleRows<T>(rows: T[], open: boolean, limit = 5): { shown: T[]; hidden: number } {
  if (open || rows.length <= limit) return { shown: rows, hidden: 0 }
  return { shown: rows.slice(0, limit), hidden: rows.length - limit }
}
