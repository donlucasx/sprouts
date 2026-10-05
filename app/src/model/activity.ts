import type { ActivityResponse, FoundVenue, SplitRow } from '@/lib/api'
import { isRetired, VENUE_NAME, type LiveAsset, type Stop } from '@/lib/coins'
import { arrivalLine, COIN_NAME, COIN_NAME_LONG, formatSkr, formatUsd, plantedLine, timeOf, underlyingAmount } from '@/lib/format'
import { changeSummary, STOP_LABEL } from './manager'

/**
 * R284 + R362: every Activity row is ONE line: its time, a short label, an amount on the right. The rows sit under day headers;
 * everything else (the coin amount, the venue, the why) and the transaction open with a tap.
 * `ts` is the row's ISO time, or a found venue's `YYYY-MM-DD` day (no time).
 */
export type ActivityRow = { key: string; ts: string; label: string; amount: string | null; details: string[]; signature: string | null }
type Planting = ActivityResponse['plantings'][number]
type Leg = Planting['legs'][number] & { asset: LiveAsset }
type Swap = Pick<ActivityResponse['swaps'][number], 'signature' | 'ts' | 'usdSizeCents' | 'roundupCents' | 'plantingId'>
type Withdrawal = Pick<ActivityResponse['withdrawals'][number], 'id' | 'ts' | 'amountRaw' | 'cancelled' | 'delivered' | 'source' | 'withdrawSignature' | 'unstakeSignature'>
type LendWithdrawal = NonNullable<ActivityResponse['lendWithdrawals']>[number]
type Move = NonNullable<ActivityResponse['moves']>[number]

/** "Planted SKR" and its dollars; several legs as "Planted 2 coins". A retired coin's planting is not a row (R281). */
export function plantingRow(p: Planting): ActivityRow | null {
  const legs = p.legs.filter((l): l is Leg => !isRetired(l.asset))
  if (p.legs.length > 0 && legs.length === 0) return null
  const base = { key: p.id, ts: p.ts, signature: p.signature }
  if (p.status === 'failed') return { ...base, label: 'Planting did not land', amount: null, details: ['Nothing moved.'] }
  if (p.status !== 'confirmed' || legs.length === 0) return { ...base, label: 'Planting on its way', amount: null, details: [] }
  const total = legs.reduce((s, l) => s + l.usdcInCents, 0)
  const label = legs.length === 1 ? `Planted ${COIN_NAME_LONG[legs[0].asset]}` : `Planted ${legs.length} coins`
  const details = legs.map((l) => plantedLine({ usdcInCents: l.usdcInCents, asset: l.asset, amountOutRaw: l.amountOutRaw, usdPrice: l.usdPrice ?? null, feeCents: l.feeCents, feeAmountRaw: l.feeAmountRaw, venue: l.venue }))
  if (p.networkFeeCents > 0) details.push(`Network fee ${formatUsd(p.networkFeeCents)}`)
  return { ...base, label, amount: formatUsd(total), details }
}

/** A split change: who changed it, chevron only; what moved and the manager's why behind the tap. */
export function splitRow(s: SplitRow, i: number): ActivityRow {
  const summary = changeSummary(s.from, s.to)
  const stop = s.stop ? `${STOP_LABEL[s.stop as Stop] ?? s.stop}.` : ''
  const base = { key: `${s.ts}-${i}`, ts: s.ts, amount: null, signature: null }
  if (s.by === 'undo') return { ...base, label: 'Undone', details: ["Yesterday's split is back.", 'The Yield Manager is off.'] }
  if (s.by === 'you' && s.turnedOn) return { ...base, label: 'You turned on the AI', details: [stop, summary].filter(Boolean) }
  if (s.by === 'you') return { ...base, label: 'You changed your split', details: summary ? [summary] : stop ? [stop] : [] }
  if (s.fallback) return { ...base, label: 'Split moved by rule', details: [summary, 'Chosen by rule today.'].filter(Boolean) }
  return { ...base, label: 'AI moved your split', details: [summary, s.why ?? ''].filter(Boolean) }
}

/** "Swap $10.00" and its change "+$1.00"; planted or waiting behind the tap. */
export function swapRow(s: Swap): ActivityRow {
  const label = s.usdSizeCents === null ? 'Unpriced swap' : `Swap ${formatUsd(s.usdSizeCents)}`
  const change = formatUsd(s.roundupCents)
  return { key: s.signature, ts: s.ts, label, amount: `+${change}`, details: [`Change ${change}, ${s.plantingId ? 'planted' : 'waiting to be planted'}.`], signature: s.signature }
}

const COOLDOWN_MS = 172_800_000
/**
 * An SKR withdrawal: its dollars on the right (the SKR when no price is known). R156: the details say when the SKR arrives (the
 * staking program's 48 hours after the unstake), in the phone's time zone; once that time has passed, "Arriving today" (R165). A
 * withdrawal the basket knows the chain's time for says that time (a wallet-started row's ts is when Sprouts found it).
 */
export function withdrawalRow(w: Withdrawal, skrUsd: number | null, readyAt?: string, now: Date = new Date()): ActivityRow {
  const raw = w.amountRaw ? BigInt(w.amountRaw) : null
  const amount = raw === null ? null : skrUsd === null ? formatSkr(raw, null) : formatSkr(raw, skrUsd).replace(/^.*\((.*)\)$/, '$1')
  const label = w.cancelled ? 'Withdrawal put back' : w.delivered ? 'Withdrew SKR' : 'Withdrawing SKR'
  const state = w.cancelled ? 'Put back.' : w.delivered ? 'Delivered.' : `${arrivalLine(readyAt ? new Date(readyAt) : new Date(new Date(w.ts).getTime() + COOLDOWN_MS), now, true)}.`
  const details = [raw === null ? '' : formatSkr(raw, skrUsd), state, w.source === 'wallet' ? 'Started from your wallet.' : ''].filter(Boolean)
  return { key: w.id, ts: w.ts, label, amount, details, signature: w.withdrawSignature ?? w.unstakeSignature }
}

/** Spec 7: a lending position back to the wallet. underlyingRaw is null when the API does not know the amount; then no amount shows. */
export function lendWithdrawalRow(w: LendWithdrawal): ActivityRow {
  const amount = w.underlyingRaw && /^\d+$/.test(w.underlyingRaw) ? underlyingAmount(w.asset, w.underlyingRaw) : null
  return { key: `lw-${w.signature}`, ts: w.ts, label: `Withdrew ${COIN_NAME[w.asset]}`, amount, details: [`From ${VENUE_NAME[w.venue]}.`, 'Back in your Seeker wallet.'], signature: w.signature }
}

/** Spec 7: a move the user approved or turned down; an open or expired proposal is the card's, not a row. */
export function moveRow(m: Move): ActivityRow | null {
  const coin = COIN_NAME[m.asset], from = VENUE_NAME[m.from], to = VENUE_NAME[m.to]
  const base = { key: `mv-${m.ts}-${m.asset}-${m.from}`, ts: m.ts, amount: null, signature: null }
  if (m.status === 'done') return { ...base, label: `Moved ${coin}`, details: [`${from} to ${to}.`] }
  if (m.status === 'failed') {
    const where = m.asset === 'SOL_LEND' ? 'Your SOL is in your wallet. If it shows as wrapped SOL, unwrap it in your wallet.' : `Your ${coin} is back in your wallet.`
    return { ...base, label: "Move didn't finish", details: [where, `${from} to ${to}.`] }
  }
  if (m.status === 'dismissed') return { ...base, label: `Kept ${coin} on ${from}`, details: [`Not moved to ${to}.`] }
  return null
}

/** R278: what the Yield Manager found; shown, never routed to. */
export const FOUND_NOTE = 'Not used: Sprouts lends only on Kamino and Jupiter.'
export const FOUND_SECTION = { title: 'Found by the Yield Manager', sub: 'Places it found paying more. Sprouts does not put money there.' } as const
export function foundRow(f: FoundVenue): ActivityRow {
  return {
    key: `f-${f.day}-${f.project}-${f.symbol}`,
    ts: f.day,
    label: `Found ${f.project} ${f.symbol}`,
    amount: f.apyBasePct !== null ? `${f.apyBasePct.toFixed(1)}%` : null,
    details: [f.note ?? '', FOUND_NOTE].filter(Boolean),
    signature: null,
  }
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n: number) => String(n).padStart(2, '0')
const localKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** The row's day as `YYYY-MM-DD` in the phone's zone; a found venue's day is the API's, as given. */
export function rowDay(ts: string): string {
  return DAY_ONLY.test(ts) ? ts : localKey(new Date(ts))
}

/** The time column, "7:11 AM" in the phone's zone; a day-only row has none. */
export function rowTime(ts: string): string {
  return DAY_ONLY.test(ts) ? '' : timeOf(new Date(ts))
}

/** R362: the day header: Today, Yesterday, then "Oct 3" ("Dec 30, 2025" in another year). */
export function dayHeader(day: string, now: Date = new Date()): string {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (day === localKey(now)) return 'Today'
  if (day === localKey(yesterday)) return 'Yesterday'
  const [y, m, d] = day.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}${y === now.getFullYear() ? '' : `, ${y}`}`
}

/** R362: rows (newest first) under their local day, in order. */
export function groupByDay(rows: ActivityRow[], now: Date = new Date()): { key: string; header: string; rows: ActivityRow[] }[] {
  const out: { key: string; header: string; rows: ActivityRow[] }[] = []
  for (const r of rows) {
    const key = rowDay(r.ts)
    const last = out[out.length - 1]
    if (last && last.key === key) last.rows.push(r)
    else out.push({ key, header: dayHeader(key, now), rows: [r] })
  }
  return out
}

/** What TalkBack reads for a row: the full date (the header is not repeated on the row), the time, the label, the amount. */
export function spokenLabel(r: ActivityRow): string {
  const [y, m, d] = rowDay(r.ts).split('-').map(Number)
  return [`${MONTHS_LONG[m - 1]} ${d}, ${y}`, rowTime(r.ts), r.label, r.amount ?? ''].filter(Boolean).join(', ')
}

/** R156 (supersedes R94's third line): the one-line explainer under the withdrawals; R171 names it Withdraw. */
export const WITHDRAWN_LINE = 'What you withdrew.'

/** A section shows its latest five rows (the API serves fifty, newest first); "Show N more" opens the rest in place (his note 6). */
export function visibleRows<T>(rows: T[], open: boolean, limit = 5): { shown: T[]; hidden: number } {
  if (open || rows.length <= limit) return { shown: rows, hidden: 0 }
  return { shown: rows.slice(0, limit), hidden: rows.length - limit }
}
