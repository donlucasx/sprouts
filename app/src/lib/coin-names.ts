import type { LiveAsset } from './coins'
import { t } from '@/i18n'

/** The names Home's coin list and the coin sheet show. */
export const COIN_FULL_NAME: Record<LiveAsset, string> = {
  SKR: 'Seeker',
  stORE: 'Staked ORE',
  USDC_LEND: 'USDC lending',
  SOL_LEND: 'SOL lending',
  hSOL: 'Helius Staked SOL',
  cbBTC: 'Coinbase Wrapped BTC',
}

/** 0.1.13: COIN_FULL_NAME in the current language (only the two lending legs have words in them; the rest are product names). */
export function coinFullName(asset: LiveAsset): string {
  return asset === 'USDC_LEND' ? t('coin.usdcLending') : asset === 'SOL_LEND' ? t('coin.solLending') : COIN_FULL_NAME[asset]
}
