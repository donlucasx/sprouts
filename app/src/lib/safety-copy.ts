/**
 * What Sprouts can and can't do with a linked wallet, shown on Link a wallet before anyone signs. A phone-sized version of the
 * website's box (api/src/app/safety.tsx, his ask 10-22, approved to ship); the facts come from there, so change them there first and
 * keep the two in step. The can / can't lines are the site's, word for word; the "before you link" lines are its points, shortened.
 */
export const CAN: readonly string[] = [
  'Take up to $5 of USDC a day from a wallet you link. You can set a lower limit.',
  'Put it into your own savings: staked SKR, stORE, hSOL, cbBTC, or USDC and SOL lending.',
]

export const CANT: readonly string[] = [
  "Send your money anywhere else. Our on-chain program cancels any pull that doesn't land in your own savings.",
  'Take more than your daily limit, even if our server is hacked.',
  "Touch any token besides USDC, or sell or withdraw what's in your garden.",
]

/** The site's "Before you link" points: the unlimited approval, the USDC the round-ups are paid from, the rent. */
export const BEFORE_YOU_LINK: readonly string[] = [
  'Your wallet will show an unlimited USDC approval. The $5 limit and the savings-only rule are enforced on chain by the programs it names.',
  'Keep a few dollars of USDC in the wallet. Your round-ups are paid from it.',
  'Linking needs a little SOL for rent (under $1), refunded when you revoke.',
]

/** Under "Another wallet": its balance is not read here, so the USDC point stands on its own. */
export const OTHER_WALLET_USDC = 'Round-ups are paid from USDC in that wallet, so keep a few dollars of USDC there.'

/**
 * The note under "This phone's wallet" when its USDC is below one planting (the threshold), or null: no note when the balance is
 * enough or could not be read (the static point above still says it). `usdcRaw` is the balance in USDC base units (6 decimals).
 * Never blocks linking.
 */
export function phoneUsdcNote(usdcRaw: string | null | undefined, thresholdCents: number): string | null {
  if (usdcRaw == null || !/^\d+$/.test(usdcRaw)) return null
  const cents = Number(BigInt(usdcRaw) / 10_000n)
  if (cents >= thresholdCents) return null
  if (cents === 0)
    return 'This wallet has no USDC yet. Round-ups are paid from USDC, so add a few dollars before your first planting.'
  return `This wallet holds $${(cents / 100).toFixed(2)} of USDC. Round-ups are paid from USDC, so add a few dollars before your first planting.`
}
