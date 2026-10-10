import type { LiveAsset } from './coins'

/** R562: each coin's official round logo, Phantom style (assets/tokens/SOURCES.md); the lending legs show their coin's. */
export const COIN_LOGO: Record<LiveAsset, number> = {
  SKR: require('../../assets/tokens/skr.png'),
  stORE: require('../../assets/tokens/store.png'),
  USDC_LEND: require('../../assets/tokens/usdc.png'),
  SOL_LEND: require('../../assets/tokens/sol.png'),
  hSOL: require('../../assets/tokens/hsol.png'),
  cbBTC: require('../../assets/tokens/cbbtc.png'),
}
export { COIN_FULL_NAME } from './coin-names'
