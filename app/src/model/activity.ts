import type { ActivityResponse, FoundVenue, SplitRow } from '@/lib/api'
import { t as tr } from '@/i18n'
import { en, type Key } from '@/i18n/en'
import { isRetired, VENUE_NAME, type LiveAsset } from '@/lib/coins'
import { arrivalParts, COIN_NAME, coinNameLong, formatSkr, formatUsd, plantedLine, timeOf, underlyingAmount } from '@/lib/format'
import { changeSummary, stopLabel } from './manager'
import { skrAmountText } from '@/lib/plant-skr'
import { dayMonthParts, dayMonthYearLong, dayMonthYearParts, percent } from "@/i18n/format"

/**
 * R284 + R362: every Activity row is ONE line: its time, a short label, an amount on the right. The rows sit under day headers;
 * everything else (the coin amount, the venue, the why) and the transaction open with a tap.
 * `ts` is the row's ISO time, or a found venue's `YYYY-MM-DD` day (no time).
 */
export type ActivityRow = { key: string; ts: string; label: string; amount: string | null; details: string[]; signature: string | null; tag?: string }
type Planting = ActivityResponse['plantings'][number]
type Leg = Planting['legs'][number] & { asset: LiveAsset }
type Swap = Pick<ActivityResponse['swaps'][number], 'signature' | 'ts' | 'usdSizeCents' | 'roundupCents' | 'plantingId'> & { walletPubkey?: string | null }
type Withdrawal = Pick<ActivityResponse['withdrawals'][number], 'id' | 'ts' | 'amountRaw' | 'cancelled' | 'delivered' | 'source' | 'withdrawSignature' | 'unstakeSignature'>
type LendWithdrawal = NonNullable<ActivityResponse['lendWithdrawals']>[number]
type Move = NonNullable<ActivityResponse['moves']>[number]
type TopUp = NonNullable<ActivityResponse['topUps']>[number]
type SkrPlant = NonNullable<ActivityResponse['skrPlants']>[number]

/** "Planted SKR" and its dollars; several legs as "Planted 2 coins". A retired coin's planting is not a row (R281). */
export function plantingRow(p: Planting): ActivityRow | null {
  const legs = p.legs.filter((l): l is Leg => !isRetired(l.asset))
  if (p.legs.length > 0 && legs.length === 0) return null
  const base = { key: p.id, ts: p.ts, signature: p.signature }
  if (p.status === 'failed') return { ...base, label: tr('activity.planting.failed'), amount: null, details: [tr('activity.planting.nothingMoved')] }
  if (p.status !== 'confirmed' || legs.length === 0) return { ...base, label: tr('activity.planting.onItsWay'), amount: null, details: [] }
  const total = legs.reduce((s, l) => s + l.usdcInCents, 0)
  const label = legs.length === 1 ? tr('activity.planting.one', { coin: coinNameLong(legs[0].asset) }) : tr('activity.planting.many', { n: legs.length })
  const details = legs.map((l) => plantedLine({ usdcInCents: l.usdcInCents, asset: l.asset, amountOutRaw: l.amountOutRaw, usdPrice: l.usdPrice ?? null, feeCents: l.feeCents, feeAmountRaw: l.feeAmountRaw, venue: l.venue }))
  // No "Network fee" line, old rows included: until 10-06 the 3 cents it named was planted with the rest, never kept (audits/fee-model).
  return { ...base, label, amount: formatUsd(total), details }
}

/** A split change: who changed it, chevron only; what moved and the manager's why behind the tap. */
export function splitRow(s: SplitRow, i: number): ActivityRow {
  const summary = changeSummary(s.from, s.to)
  const stop = s.stop ? tr('activity.split.stop', { stop: stopLabel(s.stop) }) : ''
  const base = { key: `${s.ts}-${i}`, ts: s.ts, amount: null, signature: null }
  if (s.by === 'undo') return { ...base, label: tr('activity.split.undone'), details: [tr('activity.split.undone.back'), tr('activity.split.undone.off')] }
  if (s.by === 'you' && s.turnedOn) return { ...base, label: tr('activity.split.turnedOn'), details: [stop, summary].filter(Boolean) }
  if (s.by === 'you') return { ...base, label: tr('activity.split.you'), details: summary ? [summary] : stop ? [stop] : [] }
  if (s.fallback) return { ...base, label: tr('activity.split.byRule'), details: [summary, tr('activity.split.byRule.today')].filter(Boolean) }
  // the manager's why is model-written English, stored on the server: shown as received
  return { ...base, tag: tr('activity.tag.ai'), label: tr('activity.split.ai'), details: [summary, s.why ?? ''].filter(Boolean) }
}

/** A wallet as a row names it: this phone's ("your Seed Vault wallet", a whole-sentence key per line) or another's short address. */
export type WalletName = { mine: true } | { mine: false; short: string }
const nameOf = (pubkey: string, phone: string): WalletName => (pubkey === phone ? { mine: true } : { mine: false, short: `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}` })

/**
 * 10-28 (his ruling): which wallet a row came from, only when 2+ wallets are linked (null otherwise, and the rows read as before).
 * This phone's wallet is "your Seed Vault wallet", another one its short address, as the stopped-wallet card names them.
 */
export function walletNamer(wallets: readonly { pubkey: string; status: string }[], phone: string): ((pubkey: string) => WalletName) | null {
  if (wallets.filter((w) => w.status !== 'revoked').length < 2) return null
  return (pubkey) => nameOf(pubkey, phone)
}

/** "Swap $10.00" and its change "+$1.00"; planted or waiting behind the tap; the wallet's name last when `name` is given. */
export function swapRow(s: Swap, name?: ((pubkey: string) => WalletName) | null): ActivityRow {
  const label = s.usdSizeCents === null ? tr('activity.swap.unpriced') : tr('activity.swap.label', { usd: formatUsd(s.usdSizeCents) })
  const n = name && s.walletPubkey ? name(s.walletPubkey) : null
  const from = n ? [n.mine ? tr('activity.swap.in.mine') : tr('activity.swap.in.other', { wallet: n.short })] : []
  // R484: a whole-dollar swap saves nothing; its row says so instead of "+$0.00, waiting to be planted"
  if (s.roundupCents <= 0) return { key: s.signature, ts: s.ts, label, amount: null, details: [tr('activity.swap.wholeDollar'), ...from], signature: s.signature }
  const change = formatUsd(s.roundupCents)
  return { key: s.signature, ts: s.ts, label, amount: `+${change}`, details: [tr(s.plantingId ? 'activity.swap.planted' : 'activity.swap.waiting', { amount: change }), ...from], signature: s.signature }
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
  const label = tr(w.cancelled ? 'activity.withdraw.putBack' : w.delivered ? 'activity.withdraw.done' : 'activity.withdraw.pending')
  const arrival = arrivalParts(readyAt ? new Date(readyAt) : new Date(new Date(w.ts).getTime() + COOLDOWN_MS), now)
  const state = w.cancelled ? tr('activity.withdraw.putBack.detail') : w.delivered ? tr('activity.withdraw.delivered') : arrival.today ? tr('activity.withdraw.arrivingToday') : tr('activity.withdraw.arrives', { when: arrival.when })
  const details = [raw === null ? '' : formatSkr(raw, skrUsd), state, w.source === 'wallet' ? tr('activity.withdraw.fromWallet') : ''].filter(Boolean)
  return { key: w.id, ts: w.ts, label, amount, details, signature: w.withdrawSignature ?? w.unstakeSignature }
}

/** Spec 7: a lending position back to the wallet. underlyingRaw is null when the API does not know the amount; then no amount shows. */
export function lendWithdrawalRow(w: LendWithdrawal): ActivityRow {
  const amount = w.underlyingRaw && /^\d+$/.test(w.underlyingRaw) ? underlyingAmount(w.asset, w.underlyingRaw) : null
  return { key: `lw-${w.signature}`, ts: w.ts, label: tr('activity.lend.withdrew', { coin: COIN_NAME[w.asset] }), amount, details: [tr('activity.lend.from', { venue: VENUE_NAME[w.venue] }), ...(w.whole === false ? [tr('activity.lend.part')] : []), tr('activity.lend.back')], signature: w.signature }
}

/** Spec 7: a move the user approved or turned down; an open or expired proposal is the card's, not a row. */
export function moveRow(m: Move): ActivityRow | null {
  const coin = COIN_NAME[m.asset], from = VENUE_NAME[m.from], to = VENUE_NAME[m.to]
  const base = { key: `mv-${m.ts}-${m.asset}-${m.from}`, ts: m.ts, amount: null, signature: null }
  const route = tr('activity.move.route', { from, to })
  if (m.status === 'done') return { ...base, label: tr('activity.move.done', { coin }), details: [route] }
  if (m.status === 'failed') {
    const where = m.asset === 'SOL_LEND' ? tr('activity.move.failed.sol') : tr('activity.move.failed.back', { coin })
    return { ...base, label: tr('activity.move.failed'), details: [where, route] }
  }
  if (m.status === 'dismissed') return { ...base, label: tr('activity.move.kept', { coin, venue: from }), details: [tr('activity.move.notMoved', { to })] }
  return null
}

/**
 * 10-27 (his rulings: top-ups show in Activity, never as a swap; copy approved): an Add USDC top-up, the USDC it added. 0.1.13 (11-24):
 * it names the coin that paid (/api/activity `coin`); a row recorded before 11-24, or from an older API, has none and says "this wallet".
 * 10-28: with 2+ wallets linked, "this wallet" names it; a top-up is always this phone's wallet (topup-record: wallet = the user).
 */
export function topUpNote(coin: string | null | undefined, named: boolean): string {
  if (coin) return named ? tr('activity.topup.coinNamed', { coin }) : tr('activity.topup.coin', { coin })
  return named ? tr('activity.topup.plainNamed') : tr('activity.topup.plain')
}
/** 11-25 (his ruling): Spanish says "Agregaste $10 en USDC a tu billetera" with the coin's line; the English is unchanged until his 12-3 review. */
export function topUpRow(t: TopUp, named = false): ActivityRow {
  return { key: `tu-${t.signature}`, ts: t.ts, label: tr('activity.topup.title', { amount: formatUsd(Number(BigInt(t.usdcRaw) / 10_000n)) }), amount: null, details: [topUpNote(t.coin, named)], signature: t.signature }
}

/** 0.1.13 Stake SKR (his copy 11-27): "Staked {amount} SKR" / "From this wallet.", the stake's transaction behind the tap; null when malformed. */
export function skrPlantRow(p: SkrPlant): ActivityRow | null {
  if (!/^\d{1,20}$/.test(p.amountRaw)) return null
  return { key: `ps-${p.signature}`, ts: p.ts, label: tr('activity.planted', { amount: skrAmountText(BigInt(p.amountRaw)) }), amount: null, details: [tr('activity.planted.from')], signature: p.signature }
}

/**
 * 10-28 (his note: "revoked wallets should appear on the activity tab"): a wallet linked or revoked, always named (the row is about the
 * wallet); a revoke says why, and one the user signed opens its transaction.
 */
type WalletEvent = NonNullable<ActivityResponse['wallets']>[number]
/** The English lines, for tests; rows read them through t(). */
export const WALLET_LINE = {
  linked: en['activity.wallet.line.linked'],
  user: en['activity.wallet.line.user'],
  approval: en['activity.wallet.line.approval'],
  outside: en['activity.wallet.line.outside'],
} as const
export function walletRow(e: WalletEvent, phone: string): ActivityRow {
  const n = nameOf(e.wallet, phone)
  const label = (mine: Key, other: Key) => (n.mine ? tr(mine) : tr(other, { wallet: n.short }))
  const base = { key: `w-${e.kind}-${e.wallet}-${e.ts}`, ts: e.ts, amount: null, signature: e.signature }
  if (e.kind === 'linked') return { ...base, label: label('activity.wallet.linked.mine', 'activity.wallet.linked.other'), details: [tr('activity.wallet.line.linked')] }
  if (e.why === 'user') return { ...base, label: label('activity.wallet.unlinked.mine', 'activity.wallet.unlinked.other'), details: [tr('activity.wallet.line.user')] }
  return { ...base, label: label('activity.wallet.stopped.mine', 'activity.wallet.stopped.other'), details: [tr(e.why === 'approval' ? 'activity.wallet.line.approval' : 'activity.wallet.line.outside')] }
}

/** R278: what the Yield Manager found; shown, never routed to. */
export const FOUND_NOTE = en['activity.found.note']
export function foundRow(f: FoundVenue): ActivityRow {
  return {
    key: `f-${f.day}-${f.project}-${f.symbol}`,
    ts: f.day,
    label: tr('activity.found', { project: f.project, symbol: f.symbol }),
    amount: f.apyBasePct !== null ? percent(f.apyBasePct, 1) : null,
    details: [f.note ?? '', tr('activity.found.note')].filter(Boolean),
    signature: null,
  }
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/
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
  if (day === localKey(now)) return tr('activity.day.today')
  if (day === localKey(yesterday)) return tr('activity.day.yesterday')
  const [y, m, d] = day.split('-').map(Number)
  return y === now.getFullYear() ? dayMonthParts(m - 1, d) : dayMonthYearParts(y, m - 1, d)
}

/** R362: rows (newest first) under their local day, in order. One group per day: a found venue's day-only stamp sorts as UTC
 *  midnight, so behind UTC it lands between two rows of another day; it still joins its own day's group (audit 10-08). */
export function groupByDay(rows: ActivityRow[], now: Date = new Date()): { key: string; header: string; rows: ActivityRow[] }[] {
  const out: { key: string; header: string; rows: ActivityRow[] }[] = []
  const byKey = new Map<string, (typeof out)[number]>()
  for (const r of rows) {
    const key = rowDay(r.ts)
    const g = byKey.get(key)
    if (g) g.rows.push(r)
    else {
      const n = { key, header: dayHeader(key, now), rows: [r] }
      byKey.set(key, n)
      out.push(n)
    }
  }
  return out
}

/** What TalkBack reads for a row: the full date (the header is not repeated on the row), the time, the label, the amount. */
export function spokenLabel(r: ActivityRow): string {
  const [y, m, d] = rowDay(r.ts).split('-').map(Number)
  const date = dayMonthYearLong(y, m - 1, d), time = rowTime(r.ts), label = r.label, amount = r.amount ?? ''
  if (time) return amount ? tr('activity.spoken', { date, time, label, amount }) : tr('activity.spoken.noAmount', { date, time, label })
  return amount ? tr('activity.spoken.noTime', { date, label, amount }) : tr('activity.spoken.noTimeNoAmount', { date, label })
}

/** The list shows its latest `limit` rows (the API serves fifty, newest first); "Show N more" opens the rest in place (his note 6). */
export function visibleRows<T>(rows: T[], open: boolean, limit = 5): { shown: T[]; hidden: number } {
  if (open || rows.length <= limit) return { shown: rows, hidden: 0 }
  return { shown: rows.slice(0, limit), hidden: rows.length - limit }
}

/** R450 (10-08): Activity as ONE list, newest first, each row tagged with its kind; the chips filter by kind. */
export type ActivityKind = 'plant' | 'swap' | 'withdraw' | 'split' | 'move' | 'found' | 'topup' | 'wallet'
export type TaggedRow = { kind: ActivityKind; row: ActivityRow; walletAccount?: boolean }
const KIND_KEY: Record<ActivityKind, Key> = {
  plant: 'activity.kind.plant', swap: 'activity.kind.swap', withdraw: 'activity.kind.withdraw', split: 'activity.kind.split',
  move: 'activity.kind.move', found: 'activity.kind.found', topup: 'activity.kind.topup', wallet: 'activity.kind.wallet',
}
/** The chips; each label is read with filterLabel() at render time. */
export const KIND_FILTERS: { value: 'all' | ActivityKind; key: Key }[] = [
  { value: 'all', key: 'activity.filter.all' },
  { value: 'plant', key: KIND_KEY.plant },
  { value: 'swap', key: KIND_KEY.swap },
  { value: 'withdraw', key: KIND_KEY.withdraw },
  { value: 'split', key: KIND_KEY.split },
  // 10-28 (his ruling "One 'Wallet' chip"): top-ups and links/unlinks together, what happens to the wallets rather than the garden
  { value: 'wallet', key: KIND_KEY.wallet },
]
export const filterLabel = (f: { key: Key }): string => tr(f.key)
/** R480: the tag on each row, spelled out so no legend is needed (the colour comes from the screen); a split the AI made carries "AI".
 *  KIND_TAG is the English, for tests; the screen reads kindTag(). */
export const KIND_TAG: Record<ActivityKind, string> = Object.fromEntries(Object.entries(KIND_KEY).map(([k, key]) => [k, en[key]])) as Record<ActivityKind, string>
/** The row's tag: a short word per kind (11-25: Spanish needs shorter words than the chips for the fixed tag column). */
export const kindTag = (kind: ActivityKind): string => tr(`activity.tag.${kind}`)

export function mergeRows(groups: Partial<Record<ActivityKind, { row: ActivityRow; walletAccount?: boolean }[]>>): TaggedRow[] {
  const all: TaggedRow[] = []
  for (const [kind, rows] of Object.entries(groups) as [ActivityKind, { row: ActivityRow; walletAccount?: boolean }[]][])
    for (const r of rows ?? []) all.push({ kind, ...r })
  return all.sort((x, y) => Date.parse(y.row.ts) - Date.parse(x.row.ts))
}

/** The chips: "All" keeps every kind (moves and found venues only show there); "Wallet" also keeps the top-ups. */
export function filterRows(rows: TaggedRow[], filter: 'all' | ActivityKind): TaggedRow[] {
  if (filter === 'all') return rows
  if (filter === 'wallet') return rows.filter((r) => r.kind === 'wallet' || r.kind === 'topup')
  return rows.filter((r) => r.kind === filter)
}
