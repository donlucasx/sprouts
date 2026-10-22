/**
 * What Sprouts can and can't do with a linked wallet, shown on Link a wallet before anyone signs. Mirrors the website's box
 * (api/src/app/safety.tsx, his ask 10-22, shortened on his note "simplify" the same day), word for word: change the facts there
 * first and keep the two in step.
 */
export const CAN: readonly string[] = [
  'Plant up to $5 of USDC a day from each linked wallet, only into your own savings.',
]

export const CANT: readonly string[] = [
  'Send your money anywhere else. Our on-chain program blocks it.',
  'Take more than $5 a day, even if our server is hacked.',
  "Touch other tokens, or sell what's in your garden.",
]

/** The site's "Before you link": the USDC the round-ups are paid from, the unlimited approval, revoking. */
export const BEFORE_YOU_LINK: readonly string[] = [
  'Keep a few dollars of USDC in the wallet. Round-ups are paid from it.',
  'Your wallet will show an unlimited USDC approval. The on-chain programs it names hold it to $5 a day.',
  'Revoke any time in the app or at sprouts.money/revoke.',
]

/** Under "Another wallet" (his note 10-22: make clear more than one wallet can be linked). Its balance is not read here. */
export const OTHER_WALLET_LINES: readonly string[] = [
  'Link as many wallets as you like, one code each.',
  'Round-ups are paid from USDC in that wallet, so keep a few dollars there.',
]

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
