import type { MeResponse } from './api'
import { DECIMALS, formatUsd, formatSkr, formatAmount, holdingAmount } from './format'
import { ASSETS, type Asset } from './coins'

/** A cached read from before the Yield Manager build has no holdings, manager or rules.allocation and would crash every screen that reads them: it counts as no cache (10-01 whole-branch review, I2). */
export function usableMe(cached: MeResponse | null | undefined): MeResponse | null {
  return cached && 'holdings' in cached && 'manager' in cached && typeof cached.rules?.allocation === 'object' && cached.rules.allocation !== null ? cached : null
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
export function gardenTotals(me: Pick<MeResponse, 'pot' | 'holdings' | 'history'>): GardenTotals {
  // R159: put in is what is still held. SKR: the plantings' dollars scaled by the principal still staked (the API subtracts
  // principal taken out from skrPutInRaw); the wallet coins: the API's pro-rated putInCents.
  const skrPut = BigInt(me.pot.skrPutInRaw)
  const skrTaken = BigInt(me.pot.skrPrincipalPickedRaw)
  const skrKept = skrPut + skrTaken > 0n ? Number(skrPut) / Number(skrPut + skrTaken) : 1
  const skrCents = me.history.plantings.filter((p) => p.asset === 'SKR').reduce((s, p) => s + p.usdcInCents, 0)
  const putInCents = Math.round(skrCents * skrKept) + me.holdings.reduce((s, h) => s + h.putInCents, 0)
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
    line: on ? 'On. Planting your change.' : 'Paused. Nothing moves; your garden keeps earning.',
  }
}

/** Home's coin rows (R150): SKR first, locked (R134's lock), then each held coin in the coins' order; amounts, and stORE's one
 * caption (R177, R194): where its growth comes from, with the week's measured rate; none while collecting or under 1%. */
export type CoinRow = { asset: Asset; amount: string; locked: boolean; note: string | null }
export function storeNote(growthPct: number | null | undefined): string | null {
  return growthPct != null && Math.round(growthPct) >= 1 ? `grows from ORE mining, ~${Math.round(growthPct)}%/yr` : null
}
export function coinRows(me: Pick<MeResponse, 'pot' | 'holdings'>): CoinRow[] {
  const staked = BigInt(me.pot.skrStakedRaw)
  const rows: CoinRow[] = staked > 0n ? [{ asset: 'SKR', amount: formatSkr(staked, me.pot.skrUsd), locked: true, note: null }] : []
  for (const asset of ASSETS) {
    const h = me.holdings.find((x) => x.asset === asset)
    if (h) rows.push({ asset, amount: holdingAmount(h), locked: false, note: asset === 'stORE' ? storeNote(h.growthPct) : null })
  }
  return rows
}

/** The two stats under the big number (R150): Put in, and Earned when it is known. */
export function statTiles(t: GardenTotals): { label: string; value: string }[] {
  const tiles = [{ label: 'Put in', value: formatUsd(t.putInCents) }]
  if (t.earnedUsd !== null) tiles.push({ label: 'Earned', value: formatUsd(Math.round(t.earnedUsd * 100)) })
  return tiles
}

/** Home's one wallets row (R150, in his words): the count of linked wallets, revoked ones aside; null when none is linked. */
export function walletsLine(wallets: { status: string }[]): string | null {
  const n = wallets.filter((w) => w.status !== 'revoked').length
  return n === 0 ? null : `${n} ${n === 1 ? 'wallet' : 'wallets'} linked`
}

/** The last planting as one row that opens Activity (R150): the date and what the change became; the fee clause lives in Activity. */
export function lastPlantingLine(r: MeResponse['lastReceipt']): string | null {
  if (!r) return null
  const day = new Date(r.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Last planting ${day}: ${formatUsd(r.usdcPulledCents - r.networkFeeCents)} became ${formatAmount(r.asset, BigInt(r.amountOutRaw), r.usdPrice)}`
}
