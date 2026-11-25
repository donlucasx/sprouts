import type { MeResponse } from './api'
import type { LiveAsset } from './coins'
import { usdTrimmed } from '@/i18n/format'
import { t } from '@/i18n'

/** Season 11-23 (slow opening): the line under a coin that waits to join the garden; null when it is not waiting or the API sends no `opening`. */
export function joinsLine(me: Pick<MeResponse, 'opening'> | null | undefined, asset: LiveAsset): string | null {
  const w = me?.opening?.waiting.find((x) => x.asset === asset)
  return w ? t('rules.joins', { amount: usdTrimmed(Math.round(w.afterCents / 100) * 100) }) : null
}
