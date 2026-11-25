import type { MeResponse, LendingPosition } from './api'
import { DECIMALS, formatUsd, formatSkr, plantedParts, holdingAmount, positionAmount, positionNote, positionWhere, asOfParts } from './format'
import { ASSETS, isRetired, isLend, liveSplit, livePins, type LiveAsset, type AutoVenue, type LendAsset } from './coins'
import { dayMonth, usdFromCents, usdTrimmed } from "@/i18n/format"
import { t } from '@/i18n'

/** A cached read from before the Yield Manager build has no holdings, manager or rules.allocation and would crash every screen that reads them: it counts as no cache (10-01 whole-branch review, I2). */
export function usableMe(cached: MeResponse | null | undefined): MeResponse | null {
  return cached && 'holdings' in cached && 'manager' in cached && typeof cached.rules?.allocation === 'object' && cached.rules.allocation !== null ? cached : null
}

/** His note 10-22: the stale line names the cause. `status` is the failed read's ApiError status: 0 is no answer at all (the phone
 *  is offline, or the server could not be reached), anything else is the server's own failure. `asOf` is the last verified read's
 *  time, said as formatAsOf says it ("as of 9:41 AM", "as of yesterday 9:41 AM", "as of Sep 20"); 0.1.13: one whole line per case. */
export function staleLine(asOf: Date, now: Date, status: number | null): string {
  const a = asOfParts(asOf, now)
  const vars = { time: a.value, day: a.value }
  if (status === 0) return a.kind === 'time' ? t('home.stale.offline.time', vars) : a.kind === 'yesterday' ? t('home.stale.offline.yesterday', vars) : t('home.stale.offline.day', vars)
  return a.kind === 'time' ? t('home.stale.server.time', vars) : a.kind === 'yesterday' ? t('home.stale.server.yesterday', vars) : t('home.stale.server.day', vars)
}

/** Review Focus 2, as a pure decision: a failed read keeps the last verified state and says so; never a zero garden. */
export function pickMeState(
  live: MeResponse | undefined,
  cached: MeResponse | null,
  failed: boolean,
): { data: MeResponse | undefined; stale: boolean } {
  if (live) return { data: live, stale: false }
  const usable = usableMe(cached)
  if (usable) return { data: usable, stale: failed }
  return { data: undefined, stale: failed }
}

/** Withdraw's choice: the user's own once they tap; before that, "earned" only when there is 1 SKR of it to take (09-29). */
export function withdrawMode(earnedRaw: bigint, chosen: 'earned' | 'amount' | null): 'earned' | 'amount' {
  return chosen ?? (earnedRaw >= 1_000_000n ? 'earned' : 'amount')
}

export type ManagerExtra = Partial<Pick<MeResponse['manager'], 'managed' | 'undoAvailable' | 'changedDay' | 'why'>>

/** A save's or an undo's answer applied to the cached read (10-01 device check: the screen moved twice): the rules replaced, the manager's managed/stop/pins from them, then the extras; nothing else touched. */
export function applyRulesTo(
  me: MeResponse | undefined,
  rules: MeResponse['rules'],
  extra?: ManagerExtra,
): MeResponse | undefined {
  return me
    ? { ...me, rules, manager: { ...me.manager, managed: rules.managed, stop: rules.stop, pins: rules.pins, ...extra } }
    : me
}

/** The whole garden in dollars (R146): the SKR pot at its price plus every wallet coin; earned is the staking and pool growth; put in is the dollars planted. Unknown without an SKR price. */
export type GardenTotals = { valueUsd: number | null; earnedUsd: number | null; putInCents: number }
/** R159: SKR's put in is what is still held: its plantings' dollars scaled by the principal still staked (the API subtracts principal
 * taken out from skrPutInRaw). Home's total and the SKR coin sheet both read this one (s6 review C2: the sheet summed every planting). */
export function skrPutInCents(me: Pick<MeResponse, 'pot' | 'history'>): number {
  const skrPut = BigInt(me.pot.skrPutInRaw)
  const skrTaken = BigInt(me.pot.skrPrincipalPickedRaw)
  const skrKept = skrPut + skrTaken > 0n ? Number(skrPut) / Number(skrPut + skrTaken) : 1
  const skrCents = me.history.plantings.filter((p) => p.asset === 'SKR').reduce((s, p) => s + p.usdcInCents, 0)
  return Math.round(skrCents * skrKept)
}
export function gardenTotals(me: Pick<MeResponse, 'pot' | 'holdings' | 'history'>): GardenTotals {
  // R159: put in is what is still held; the wallet coins: the API's pro-rated putInCents
  const putInCents = skrPutInCents(me) + me.holdings.reduce((s, h) => s + h.putInCents, 0)
  const skrUsd = me.pot.skrUsd
  if (skrUsd === null) return { valueUsd: null, earnedUsd: null, putInCents }
  const skr = (raw: string) => (Number(raw) / 10 ** DECIMALS.SKR) * skrUsd
  return {
    valueUsd: skr(me.pot.skrStakedRaw) + me.holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0),
    earnedUsd: skr(me.pot.skrEarnedRaw) + me.holdings.reduce((s, h) => s + (h.earnedUsd ?? 0), 0),
    putInCents,
  }
}
/** Sprouts' switch on Home (R147), decided from the wallets' statuses: on while any wallet is active, off when every linked wallet is paused, hidden with nothing linked. */
export function pauseState(wallets: { status: string }[]): { shown: boolean; on: boolean; line: string } {
  const linked = wallets.filter((w) => w.status !== 'revoked')
  if (linked.length === 0) return { shown: false, on: false, line: '' }
  const on = linked.some((w) => w.status === 'active')
  return {
    shown: true,
    on,
    line: on ? t('home.pause.on') : t('home.pause.paused')   // R448: the switch turns the round-ups on and off; "planting" names the daily step only   // one line (his note 10-05); the Next planting row says Paused too,
  }
}


/** What this phone's own wallet is called in the USDC notice: Home's line under the title says "Held in your Seed Vault wallet".
 *  0.1.13: English only (Activity's lines); Home's sentences carry it inside whole keys (the .mine variants). */
export const PHONE_WALLET = 'Seed Vault wallet'

/**
 * 10-27 (his: "we dont have a lot of users, so we gotta tend to them promptly"; user-c.skr's wallet was stopped and only hidden, so
 * the app looked unlinked): the wallets Sprouts stopped on its own, by name, with what happened and the one fix, a re-link.
 * Build-written copy, his look owed. null when none.
 */
export function stoppedNotice(me: Pick<MeResponse, 'wallets' | 'user'>): { title: string; lines: string[]; button: string } | null {
  const stopped = me.wallets.filter((w) => w.status === 'revoked' && w.stopped)
  if (!stopped.length) return null
  // 0.1.13: this phone's wallet and another wallet (by its short address) are separate whole lines, never a name spliced in
  const mine = (w: { pubkey: string }) => w.pubkey === me.user.pubkey
  const wallet = (w: { pubkey: string }) => `${w.pubkey.slice(0, 4)}...${w.pubkey.slice(-4)}`
  const lines = stopped.map((w) =>
    w.stopped === 'approval'
      ? mine(w) ? t('home.stopped.approval.mine') : t('home.stopped.approval.other', { wallet: wallet(w) })
      : mine(w) ? t('home.stopped.outside.mine') : t('home.stopped.outside.other', { wallet: wallet(w) }),
  )
  const one = stopped.length === 1
  return {
    title: one
      ? mine(stopped[0]) ? t('home.stopped.title.mine') : t('home.stopped.title.other', { wallet: wallet(stopped[0]) })
      : t('home.stopped.title.many', { n: stopped.length }),
    lines: [...lines, one ? t('home.stopped.fix.one') : t('home.stopped.fix.many')],
    button: one ? t('home.stopped.button.one') : t('home.stopped.button.many'),
  }
}

/**
 * Home's amber USDC notice (10-27, his notes: the line must "stand out"; then "it should be one message that adapts... 'xxxx wallet has
 * no usdc' or 'xxxx wallet has low usdc'... name each wallet... Simplify"). Every wallet short of USDC by name (this phone's is the
 * Seed Vault wallet, others by address): one wallet is a title and one line; several, a title and a line each. `phone` is this phone's
 * wallet's own read (its balance, and whether lowUsdcLine calls it low); the top-up shows when the Seed Vault wallet is one of them.
 */
export function usdcNotice(me: Pick<MeResponse, 'wallets' | 'user' | 'nextPlanting'>, phone: { usdcCents: number | null; low: boolean }): { title: string; lines: string[]; topUp: boolean } | null {
  type Entry = { name: string; mine: boolean; state: 'paused' | 'zero' | 'low'; cents: number }
  const short = (k: string) => `${k.slice(0, 4)}...${k.slice(-4)}`
  const entries: Entry[] = []
  for (const w of me.wallets) {
    if (w.status !== 'paused' || w.pause?.reason !== 'no_usdc') continue
    const need = Math.max(1, Math.ceil(Math.max(w.pause.needCents ?? 0, w.pause.resumeAtCents ?? 0) / 100)) * 100   // ?? 0: an older cached read never says $NaN (Kimi 10-27)
    const mine = w.pubkey === me.user.pubkey
    entries.push({ name: mine ? PHONE_WALLET : short(w.pubkey), mine, state: 'paused', cents: need })
  }
  // 11-20 (founder's ruling): $0 shows the notice right away, no waiting on round-ups (the push already fires at $0); it still needs the
  // phone wallet linked and active, so a user-paused or revoked wallet is not nagged
  const linkedActive = me.wallets.some((w) => w.pubkey === me.user.pubkey && w.status === 'active')
  if (!entries.some((e) => e.mine) && phone.usdcCents !== null && ((phone.usdcCents <= 0 && linkedActive) || (phone.usdcCents > 0 && phone.low)))
    entries.unshift({ name: PHONE_WALLET, mine: true, state: phone.usdcCents <= 0 ? 'zero' : 'low', cents: phone.usdcCents })
  entries.sort((x, y) => Number(y.mine) - Number(x.mine))
  if (!entries.length) return null
  const usd = (c: number) => usdTrimmed(c)
  const topUp = entries.some((e) => e.mine)
  // the name alone: 'Your Seed Vault wallet has no USDC' wrapped to two lines on the Saga (10-27)
  // 0.1.13: the Seed Vault wallet's lines and another wallet's are separate whole keys (.mine / .other); `wallet` is the short address
  const state = (e: Entry) => (e.state === 'paused' ? 'needs' : e.state)
  const vars = (e: Entry) => ({ wallet: e.name, amount: usd(e.cents) })
  // 10-27 (his note: say "WHY sprouts needs USDC on such wallets... brief and simple"): the why leads every line, in the words of the
  // approved intro ("Sprouts plants the change with USDC from your wallet")
  if (entries.length === 1) {
    const [e] = entries
    // 10-27 (his question: can "your round-ups are still counted" fit, simply?): "they wait" says nothing is lost, in two words
    const s = state(e)
    return {
      title: e.mine ? t(`home.usdc.${s}.mine` as const) : t(`home.usdc.${s}.other` as const, vars(e)),
      lines: [t(`home.usdc.${s}.line` as const, vars(e))],
      topUp,
    }
  }
  return {
    title: t('home.usdc.many.title', { n: entries.length }),
    lines: [
      t('home.usdc.many.why'),
      ...entries.map((e) => (e.mine ? t(`home.usdc.many.${state(e)}.mine` as const, vars(e)) : t(`home.usdc.many.${state(e)}.other` as const, vars(e)))),
      t('home.usdc.many.wait'),
    ],
    topUp,
  }
}

/** Whether every paused wallet was paused by the run for want of USDC: then Home's lines above say it all and the Rules chip (the
 *  user's switch) stays hidden. False when any wallet is the user's pause or has no reason. */
export function pausedOnlyForNoUsdc(wallets: MeResponse['wallets']): boolean {
  const paused = wallets.filter((w) => w.status === 'paused')
  return paused.length > 0 && paused.every((w) => w.pause?.reason === 'no_usdc')
}

/** Home's coin rows (R150): SKR first, locked (R134's lock), then each held coin in the coins' order; amounts, and stORE's one
 * caption (R177, R194): where its growth comes from, with the week's measured rate; none while collecting or under 1%.
 * R198 (device check 2, his note): `lead` marks the SKR and stORE rows, which Home sets one step up the type ramp from the other
 * coins (heading against body, the same step as the Put in / Earned tiles above them), so the two Seeker coins lead the list. */
export type CoinRow = { key: string; asset: LiveAsset; venue: AutoVenue | null; amount: string; qty: string; usd: string | null; locked: boolean; note: string | null; lead: boolean
  /** R563: what this coin earned in dollars (SKR's staking at its price, a holding's growth, a position's interest); null when unknown. */
  earnedUsd: number | null
  /** R564's coin sheet: the dollars put into this row (null for SKR: the sheet sums its plantings), and where it lives in one line. */
  putInCents: number | null
  where: string | null
  /** R568: a lending coin held at two or more venues is ONE row (these totals) with a part per venue, each a full row of its own. */
  parts?: CoinRow[] }
/** R230 (10-03, his note: "a more familiar portfolio look, like coinmarketcap's"): `amount` split for Home's two-column row, the
 * coin amount under its name on the left and the dollars on the right; `usd` null when no price is known. */
function split(amount: string): { qty: string; usd: string | null } {
  const m = amount.match(/^(.*) \((\$[^)]*)\)$/)
  return m ? { qty: m[1], usd: m[2] } : { qty: amount, usd: null }
}
/** R198: the coins whose rows lead Home's list, one type step up. */
export const LEAD_COINS: readonly LiveAsset[] = ['SKR', 'stORE']
export function storeNote(growthPct: number | null | undefined): string | null {
  return growthPct != null && Math.round(growthPct) >= 1 ? t('home.where.store', { pct: Math.round(growthPct) }) : null
}
const VENUE_ORDER: readonly AutoVenue[] = ['kamino_klend', 'jupiter_lend']
/** A lending leg's positions with something in them, Kamino first. */
export function livePositions(me: Pick<MeResponse, 'positions'>, asset: LendAsset): LendingPosition[] {
  return (me.positions ?? [])
    .filter((p) => p.asset === asset && /^\d+$/.test(p.receiptRaw) && BigInt(p.receiptRaw) > 0n)
    .sort((a, b) => VENUE_ORDER.indexOf(a.venue) - VENUE_ORDER.indexOf(b.venue))
}
export function coinRows(me: Pick<MeResponse, 'pot' | 'holdings' | 'positions'>): CoinRow[] {
  const staked = BigInt(me.pot.skrStakedRaw)
  const skrEarned = me.pot.skrUsd === null ? null : (Number(BigInt(me.pot.skrEarnedRaw)) / 10 ** DECIMALS.SKR) * me.pot.skrUsd
  const rows: CoinRow[] = staked > 0n ? [{ key: 'SKR', asset: 'SKR', venue: null, amount: formatSkr(staked, me.pot.skrUsd), ...split(formatSkr(staked, me.pot.skrUsd)), locked: true, note: null, lead: true, earnedUsd: skrEarned, putInCents: null, where: t('home.where.locked') }] : []
  for (const asset of ASSETS) {
    // Spec 11: a lending leg lists each venue position (venue, rate, value, earned) in place of its aggregated holding (Review Focus 4)
    const positions = isLend(asset) ? livePositions(me, asset) : []
    if (positions.length > 0) {
      const parts: CoinRow[] = positions.map((p) => ({ key: `${asset}:${p.venue}`, asset, venue: p.venue, amount: positionAmount(p), ...split(positionAmount(p)), locked: false, note: positionNote(p), lead: false, earnedUsd: p.earnedUsd, putInCents: p.putInCents, where: positionWhere(p) }))
      rows.push(parts.length === 1 ? parts[0]! : groupRow(asset as LendAsset, positions, parts))
      continue
    }
    const h = me.holdings.find((x) => x.asset === asset)
    if (h) rows.push({ key: asset, asset, venue: null, amount: holdingAmount(h), ...split(holdingAmount(h)), locked: false, note: asset === 'stORE' ? storeNote(h.growthPct) : null, lead: LEAD_COINS.includes(asset), earnedUsd: h.earnedUsd, putInCents: h.putInCents, where: asset === 'stORE' ? (storeNote(h.growthPct) ?? t('home.where.wallet')) : t('home.where.wallet') })
  }
  return rows
}

/** R568: one row for a lending coin at several venues: the summed amount and value (value unknown if any part's is), earned and put
 * in summed over the parts that know them, the venues in one line; Home draws the parts under it. */
function groupRow(asset: LendAsset, positions: LendingPosition[], parts: CoinRow[]): CoinRow {
  const sum = (xs: (number | null)[]) => (xs.some((x) => x !== null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null)
  const total: LendingPosition = {
    ...positions[0]!,
    underlyingRaw: String(positions.reduce((s, p) => s + BigInt(/^\d+$/.test(p.underlyingRaw) ? p.underlyingRaw : '0'), 0n)),
    valueUsd: positions.every((p) => p.valueUsd !== null) ? positions.reduce((s, p) => s + p.valueUsd!, 0) : null,
  }
  return {
    key: asset, asset, venue: null, amount: positionAmount(total), ...split(positionAmount(total)), locked: false, note: null, lead: false,
    earnedUsd: sum(parts.map((p) => p.earnedUsd)), putInCents: sum(parts.map((p) => p.putInCents)), where: parts.map((p) => p.where).join(' · '), parts,
  }
}

/** The two stats under the big number (R150): Put in, and Earned when it is known. */
/** 0.1.13: `id` names the tile whatever the language (Home colours the earned one). */
export function statTiles(g: GardenTotals): { id: 'putIn' | 'earned'; label: string; value: string }[] {
  const tiles: { id: 'putIn' | 'earned'; label: string; value: string }[] = [{ id: 'putIn', label: t('home.value.putIn'), value: formatUsd(g.putInCents) }]
  if (g.earnedUsd !== null) tiles.push({ id: 'earned', label: t('home.value.earned'), value: formatUsd(Math.round(g.earnedUsd * 100)) })
  return tiles
}

/** R355 (10-05, "Value on top"): Home's compact block right under the status line: the whole garden in dollars big with "in your
 * garden" under it, Put in and Earned small beside it (statTiles), and the block's one spoken line. With no price known the staked
 * SKR is the big number, as the pot card had it (R146). */
export function valueBlock(g: GardenTotals, skrStakedRaw: bigint): { big: string; label: string; side: ReturnType<typeof statTiles>; a11y: string } {
  const big = g.valueUsd === null ? formatSkr(skrStakedRaw, null) : formatUsd(Math.round(g.valueUsd * 100))
  const side = statTiles(g)
  const putIn = side.find((s) => s.id === 'putIn')!.value
  const earned = side.find((s) => s.id === 'earned')?.value
  const a11y = earned === undefined ? t('home.value.a11y', { big, putIn }) : t('home.value.a11y.earned', { big, putIn, earned })
  return { big, label: t('home.value.label'), side, a11y }
}

/** Home's one wallets row (R150, in his words): the count of linked wallets, revoked ones aside; null when none is linked. */
/**
 * 11-01 (his ruling "A", mock previews/support/home-link-v1.png): Home's one green line above the garden, only while no wallet is
 * linked (none live, and no stopped one: a stopped wallet has its own re-link notice). It replaces the bottom Linked wallets card.
 */
// 0.1.13: the prompt's line is the key home.linkPrompt ("Link a wallet to start saving").
export function showLinkPrompt(me: Pick<MeResponse, 'wallets' | 'user'>): boolean {
  return walletsLine(me.wallets) === null && stoppedNotice(me) === null
}

export function walletsLine(wallets: { status: string }[]): string | null {
  const n = wallets.filter((w) => w.status !== 'revoked').length
  return n === 0 ? null : n === 1 ? t('home.wallets.one') : t('home.wallets.other', { n })
}

/** The last planting as one row that opens Activity (R150): the date and what the change became; the fee clause lives in Activity. */
export function lastPlantingLine(r: MeResponse['lastReceipt']): string | null {
  if (!r || isRetired(r.asset)) return null   // a retired coin shows nowhere (R281)
  const day = dayMonth(new Date(r.ts))
  const w = plantedParts({ usdcInCents: r.usdcPulledCents, asset: r.asset, amountOutRaw: r.amountOutRaw, usdPrice: r.usdPrice, venue: r.venue })
  return w.kind === 'went' ? t('home.lastPlanting.went', { day, ...w.vars }) : t('home.lastPlanting.became', { day, ...w.vars })
}

/**
 * Every /api/me read, live or cached, goes through here once (Review Focus 1): an API from before the lending build (main a6d6f32)
 * still serves JitoSOL/JupSOL keys and holdings. R281: they show nowhere, so the read is cut to the six live legs: retired holdings
 * dropped, splits re-keyed (retired shares fold into SKR, contracts 1.1), pins on retired coins dropped, a retired next coin read as SKR,
 * a retired last receipt hidden. Idempotent.
 */
export function normalizeMe(me: MeResponse): MeResponse {
  return {
    ...me,
    holdings: me.holdings.filter((h) => !isRetired(h.asset)),
    manager: { ...me.manager, stopSplit: liveSplit(me.manager.stopSplit), pins: livePins(me.manager.pins) },
    rules: {
      ...me.rules,
      allocation: liveSplit(me.rules.allocation),
      pins: livePins(me.rules.pins),
      // 0.1.10: an API before the new round-up choices sends none of them; they read as off.
      smallOn: me.rules.smallOn ?? false,
      perSwapOn: me.rules.perSwapOn ?? false,
      perSwapCents: me.rules.perSwapCents ?? 10,
    },
    nextPlanting: { ...me.nextPlanting, asset: isRetired(me.nextPlanting.asset) ? 'SKR' : me.nextPlanting.asset },
    lastReceipt: me.lastReceipt && isRetired(me.lastReceipt.asset) ? null : me.lastReceipt,
    // Slow opening: only live coins wait; an older API sends no `opening` and the read stays without it.
    ...(me.opening ? { opening: { ...me.opening, waiting: me.opening.waiting.filter((w) => !isRetired(w.asset)) } } : {}),
  }
}

/**
 * 0.1.10 (his ruling "Last 30 days total"): Home's line for a user with no wallet linked, from their own last 30 days of swaps.
 * Null when there is nothing worth saying (no swaps, or nothing they would have saved either way): Home then shows the plain prompt.
 * Whole-dollar buys save nothing by rounding up, so they are told what "Add 10c to every swap" would have saved instead.
 */
export function previewLine(p: { swaps: number; savedCents: number; perSwapSavedCents: number; partial?: boolean } | null | undefined): string | null {
  if (!p || p.swaps === 0) return null
  // Kimi 11-12: a busy wallet is read only in part (its newest 500 transactions), so the total is a floor.
  if (p.savedCents > 0) return t(p.partial ? 'home.preview.savedAtLeast' : 'home.preview.saved', { amount: usdFromCents(p.savedCents) })
  if (p.perSwapSavedCents > 0) return t(p.partial ? 'home.preview.perSwapAtLeast' : 'home.preview.perSwap', { amount: usdFromCents(p.perSwapSavedCents) })
  return null
}
