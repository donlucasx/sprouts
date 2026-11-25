import { formatUsd } from './format'
import { t } from '@/i18n'

/** R455: the line under the Sprouts switch, "is it working" at a glance. Swaps that set change aside in the last 7 days (the
 *  activity read's newest 50, enough for a week of normal use). */
export function weekLine(swaps: { ts: string; roundupCents: number }[] | undefined, now = new Date()): string | null {
  if (!swaps) return null
  const since = now.getTime() - 7 * 24 * 3600 * 1000
  const week = swaps.filter((s) => s.roundupCents > 0 && Date.parse(s.ts) >= since)
  if (week.length === 0) return t('week.none')
  const cents = week.reduce((t, s) => t + s.roundupCents, 0)
  return week.length === 1 ? t('week.one', { amount: formatUsd(cents) }) : t('week.other', { n: week.length, amount: formatUsd(cents) })
}
