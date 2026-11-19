import type { MeResponse } from './api'
import type { LiveAsset } from './coins'

/** Season 11-23 (slow opening): the line under a coin that waits to join the garden; null when it is not waiting or the API sends no `opening`. */
export function joinsLine(me: Pick<MeResponse, 'opening'> | null | undefined, asset: LiveAsset): string | null {
  const w = me?.opening?.waiting.find((x) => x.asset === asset)
  return w ? `Joins your garden after $${Math.round(w.afterCents / 100)} planted` : null
}
