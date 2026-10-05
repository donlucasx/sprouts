import type { MeResponse } from './api'
import { DECIMALS, formatUsd, formatSkr, plantedWhat, holdingAmount } from './format'
import { ASSETS, isRetired, liveSplit, livePins, type LiveAsset } from './coins'

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
 * caption (R177, R194): where its growth comes from, with the week's measured rate; none while collecting or under 1%.
 * R198 (device check 2, his note): `lead` marks the SKR and stORE rows, which Home sets one step up the type ramp from the other
 * coins (heading against body, the same step as the Put in / Earned tiles above them), so the two Seeker coins lead the list. */
export type CoinRow = { asset: LiveAsset; amount: string; qty: string; usd: string | null; locked: boolean; note: string | null; lead: boolean }
/** R230 (10-03, his note: "a more familiar portfolio look, like coinmarketcap's"): `amount` split for Home's two-column row, the
 * coin amount under its name on the left and the dollars on the right; `usd` null when no price is known. */
function split(amount: string): { qty: string; usd: string | null } {
  const m = amount.match(/^(.*) \((\$[^)]*)\)$/)
  return m ? { qty: m[1], usd: m[2] } : { qty: amount, usd: null }
}
/** R198: the coins whose rows lead Home's list, one type step up. */
export const LEAD_COINS: readonly LiveAsset[] = ['SKR', 'stORE']
export function storeNote(growthPct: number | null | undefined): string | null {
  return growthPct != null && Math.round(growthPct) >= 1 ? `grows from ORE mining, ~${Math.round(growthPct)}%/yr` : null
}
export function coinRows(me: Pick<MeResponse, 'pot' | 'holdings'>): CoinRow[] {
  const staked = BigInt(me.pot.skrStakedRaw)
  const rows: CoinRow[] = staked > 0n ? [{ asset: 'SKR', amount: formatSkr(staked, me.pot.skrUsd), ...split(formatSkr(staked, me.pot.skrUsd)), locked: true, note: null, lead: true }] : []
  for (const asset of ASSETS) {
    const h = me.holdings.find((x) => x.asset === asset)
    if (h) rows.push({ asset, amount: holdingAmount(h), ...split(holdingAmount(h)), locked: false, note: asset === 'stORE' ? storeNote(h.growthPct) : null, lead: LEAD_COINS.includes(asset) })
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
  if (!r || isRetired(r.asset)) return null   // a retired coin shows nowhere (R281)
  const day = new Date(r.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `Last planting ${day}: ${plantedWhat({ usdcInCents: r.usdcPulledCents - r.networkFeeCents, asset: r.asset, amountOutRaw: r.amountOutRaw, usdPrice: r.usdPrice, venue: r.venue })}`
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
    rules: { ...me.rules, allocation: liveSplit(me.rules.allocation), pins: livePins(me.rules.pins) },
    nextPlanting: { ...me.nextPlanting, asset: isRetired(me.nextPlanting.asset) ? 'SKR' : me.nextPlanting.asset },
    lastReceipt: me.lastReceipt && isRetired(me.lastReceipt.asset) ? null : me.lastReceipt,
  }
}
