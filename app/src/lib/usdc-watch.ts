import { store } from './store'

/**
 * 10-27: what the low-USDC notification needs between the app's reads (notices.ts lowUsdcNotice): the round-up pace Home last measured
 * for this phone's wallet (usdc-runway avgDailyRoundupCents; the background task does not read Activity), and whether the last check
 * already said the wallet was low, so the notification comes once per low spell.
 */
const AVG = 'usdc.avgCents'
const LOW = 'usdc.lowNotified'

export function readLastAvg(): number | null {
  const v = store.getNumber(AVG)
  return v === undefined || !(v > 0) ? null : v
}
export function writeLastAvg(avg: number | null) {
  if (avg !== null && avg > 0) store.set(AVG, avg)
}
export function readWasLow(): boolean {
  return store.getBoolean(LOW) ?? false
}
export function writeWasLow(low: boolean) {
  store.set(LOW, low)
}
