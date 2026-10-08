import type { Asset } from './coins'

/** The split bar's colours (R446-R451 Rules redesign, 10-08): one hue per leg, mid-tone so it reads on paper and on the dark ground. */
export const COIN_COLOR: Partial<Record<Asset, string>> = {
  SKR: '#2E8B57',
  stORE: '#C49A3A',
  USDC_LEND: '#4A7DB5',
  SOL_LEND: '#8A6BC4',
  hSOL: '#3C9C9C',
  cbBTC: '#D07A3A',
}
export const coinColor = (a: Asset) => COIN_COLOR[a] ?? '#8A8A8A'
