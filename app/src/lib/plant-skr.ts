import type { MeResponse } from './api'
import { coinRows, type CoinRow } from './me-state'
import { grouped, formatUsd } from './format'
import { decimalSeparator } from '@/i18n/format'
import { REFUSED, SignRefused, type SignFlow } from './sign'
import { DROPPED_NOTHING_SENT } from './wallet-errors'
import { t } from '@/i18n'

/**
 * 0.1.13 item 3, "Plant my SKR" (his rulings 11-25): SKR held liquid in this phone's Seed Vault wallet, staked straight into the garden
 * position Sprouts plants into, in one signature. The API builds it (POST /api/stake/build), the phone checks it (sign.ts 'stake'), the
 * Seed Vault signs, POST /api/stake/confirm sends. A small marker on Home's SKR row and SKR plant card opens the SKR coin sheet, whose
 * "Plant my SKR" section offers [25%] [50%] [All] (All first, no typing). No fee wording anywhere; never "free".
 */

export type IdleSkr = { raw: bigint; usdCents: number }

/** /api/me idleSkr, checked: null when absent (an older API: no marker), null, or malformed. */
export function idleSkrOf(me: Pick<MeResponse, 'idleSkr'>): IdleSkr | null {
  const i = me.idleSkr
  if (!i || typeof i.raw !== 'string' || !/^\d{1,20}$/.test(i.raw) || typeof i.usdCents !== 'number' || !Number.isFinite(i.usdCents) || i.usdCents <= 0) return null
  const raw = BigInt(i.raw)
  return raw > 0n ? { raw, usdCents: i.usdCents } : null
}

/** Kimi #13: the marker shows on the SKR row (and the SKR plant card, whose row it is) only while the wallet holds $5+ of liquid SKR. */
export function showPlantMarker(me: Pick<MeResponse, 'idleSkr'>, row: CoinRow | null | undefined): boolean {
  return !!row && row.asset === 'SKR' && row.venue === null && idleSkrOf(me) !== null
}

/** The key of the $0 SKR row (never a withdraw key: there is nothing staked to withdraw). */
export const IDLE_SKR_ROW_KEY = 'SKR:idle'

/**
 * 0.1.13 (his ruling 11-25, on the coordinator's recommendation): a wallet with $5+ of liquid SKR and NOTHING staked has no SKR row or
 * plant to carry the marker, so Home lists an SKR row at $0 with the seed; it opens the SKR sheet (Plant my SKR, no Withdraw) and goes
 * once idleSkr is null. Null whenever the user already has an SKR row (staked SKR: the marker sits on that row and plant card).
 */
export function idleSkrRow(me: Pick<MeResponse, 'pot' | 'holdings' | 'positions' | 'idleSkr'>): CoinRow | null {
  if (idleSkrOf(me) === null || coinRows(me).some((r) => r.asset === 'SKR')) return null
  const usd = formatUsd(0)
  return { key: IDLE_SKR_ROW_KEY, asset: 'SKR', venue: null, amount: `0 SKR (${usd})`, qty: '0 SKR', usd, locked: false, note: null, lead: true, earnedUsd: null, putInCents: 0, where: t('home.where.nothing') }
}

/** Home's coin list: coinRows, led by the $0 SKR row when idleSkrRow gives one. */
export function homeCoinRows(me: Pick<MeResponse, 'pot' | 'holdings' | 'positions' | 'idleSkr'>): CoinRow[] {
  const idle = idleSkrRow(me)
  return idle ? [idle, ...coinRows(me)] : coinRows(me)
}

export type PlantShare = '25' | '50' | 'all'
/** His ruling: [25%] [50%] [All], All picked first. */
export const PLANT_SHARES: readonly PlantShare[] = ['25', '50', 'all']
export const PLANT_DEFAULT: PlantShare = 'all'
/** The program's smallest stake (api constants MIN_STAKE_RAW, 1 SKR); a share below it is not offered. */
export const MIN_PLANT_RAW = 1_000_000n
/**
 * Amounts are floored to whole hundredths of SKR (10,000 raw units), the places the screen shows, so what the button names is exactly what
 * the wallet signs. All leaves at most 0.009999 SKR of dust in the wallet.
 */
const HUNDREDTH = 10_000n

/** The share's amount in raw units, floored. */
export function plantAmountRaw(idleRaw: bigint, share: PlantShare): bigint {
  const pct = share === 'all' ? 100n : BigInt(share)
  return ((idleRaw * pct) / 100n / HUNDREDTH) * HUNDREDTH
}

/** "1,240" or "310.12": the SKR amount at hundredths, grouped, ".00" dropped. */
export function skrAmountText(raw: bigint): string {
  const whole = grouped(String(raw / 1_000_000n))
  const hundredths = (raw % 1_000_000n) / HUNDREDTH
  return hundredths === 0n ? whole : `${whole}${decimalSeparator()}${String(hundredths).padStart(2, '0')}`
}

/** The amount's dollars at the price /api/me's own numbers imply (usdCents for raw), "24.80" (no "$": the line has it). */
export function plantUsdText(amountRaw: bigint, idle: IdleSkr): string {
  const cents = Number((amountRaw * BigInt(Math.round(idle.usdCents))) / idle.raw)
  return formatUsd(cents).slice(1)
}

/** The bar's options: each share that is at least one SKR; the labels "25%", "50%", "All". */
export function plantOptions(idle: IdleSkr): { value: PlantShare; label: string }[] {
  return PLANT_SHARES.filter((s) => plantAmountRaw(idle.raw, s) >= MIN_PLANT_RAW).map((s) => ({ value: s, label: s === 'all' ? t('plant.all') : `${s}%` }))
}

/** A planting that did not finish; `message` is the sentence to show as it is. */
export class PlantFailed extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlantFailed'
  }
}

// Duck-typed on ApiError's shape (status, message), as topup.ts.
const apiStatus = (e: unknown): number | null => {
  const s = e instanceof Error ? (e as { status?: unknown }).status : undefined
  return typeof s === 'number' ? s : null
}

/**
 * Build, check, sign, send (topUpThisPhone's shape). Before the wallet answered nothing was sent, so a refused build, a decline or our own
 * refusal is "nothing moved"; a build for another amount than the button's is refused before the wallet is asked; after the signature
 * went out only the confirm's own final answers (400, 409, 503 off) are shown as they are, anything else is t('plant.sent').
 */
export async function plantSkrThisPhone(a: {
  user: string
  amountRaw: bigint
  build: (body: { amountRaw: string }) => Promise<{ transaction: string; amountRaw: string }>
  sign: (flow: SignFlow) => (transaction: string) => Promise<string>
  confirm: (body: { signedTransaction: string }) => Promise<{ status?: string }>
  onSigned?: () => void
}): Promise<'confirmed' | 'pending'> {
  const amountRaw = a.amountRaw.toString()
  let built: { transaction: string; amountRaw: string }
  try {
    built = await a.build({ amountRaw })
  } catch (e) {
    throw new PlantFailed(apiStatus(e) !== null && apiStatus(e) !== 0 ? (e as Error).message : t('plant.failedBefore'))
  }
  if (built.amountRaw !== amountRaw) throw new PlantFailed(REFUSED.plan)
  let signedTransaction: string
  try {
    signedTransaction = await a.sign({ kind: 'stake', user: a.user, amountRaw })(built.transaction)
  } catch (e) {
    throw new PlantFailed(e instanceof SignRefused ? e.message : DROPPED_NOTHING_SENT)
  }
  a.onSigned?.()
  let answer: { status?: string }
  try {
    answer = await a.confirm({ signedTransaction })
  } catch (e) {
    const s = apiStatus(e)
    throw new PlantFailed(s === 400 || s === 409 || s === 503 ? (e as Error).message : t('plant.sent'))
  }
  return answer?.status === 'confirmed' ? 'confirmed' : 'pending'
}

