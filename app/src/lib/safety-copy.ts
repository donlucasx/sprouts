/**
 * What Sprouts can and can't do with a linked wallet, shown on Link a wallet before anyone signs. His note 10-22 ("too much text,
 * simplify"): three marked lines. /link and /faqs say these exact lines (api/src/lib/link-safety-copy.ts, his note 10-28: "match it
 * so the messaging is always the same"); change both, the test checks they match.
 */
/** The line above the card. His note 10-28: "Your USDC stays in your wallet until then." cut. */
export const LINK_INTRO = 'Every swap rounds up. Once a day, Sprouts plants the change using USDC in your wallet.'

export const CAN: readonly string[] = ['Plants up to $5 of USDC a day, only into your own savings']

export const CANT: readonly string[] = [
  "Can't send your money anywhere else, even if our server is hacked",
  "Can't touch other tokens or sell your garden",
]

/**
 * 10-27 (WAL-002 store rejection + his note "this is a scary permission that will turn off most people"): the wallet's "unlimited USDC"
 * warning, said right above Approve, before the wallet says it. Same words as api/src/app/safety.tsx ApprovalWarning.
 */
export const APPROVAL_WARN_TITLE = 'Your wallet will ask for approval'
export const APPROVAL_WARN_BODY = "It shows as \"unlimited USDC\". That's normal. Sprouts' on-chain program caps it at $5 a day, only into your garden. You can revoke it any time."

/** Under "Another wallet" (his note 10-22: make clear more than one wallet can be linked). Its balance is not read here. */
export const OTHER_WALLET_LINE = 'Link a wallet from your computer, or from the browser inside any mobile wallet app. Each wallet plants from its own USDC.'
/** 10-28: under the code. Plain text, no link: a tap would open the phone's own browser, which has no wallet. */
export const CODE_STEPS = 'Go to sprouts.money/link and enter this code. It works once, for 15 minutes.'
/** 10-28: after the wallet signs, while the link is confirmed on chain. */
export const LINK_FINISHING = 'Approved. Finishing the link (a few seconds).'
/** 10-28 (his note): Home's notice after a link, until OK. */
export const LINKED_TITLE = (short: string) => `Linked ${short}`
export const LINKED_LINE = 'Its swaps now round up into your garden.'

/**
 * The note under "This phone's wallet" when its USDC is below one planting (the threshold), or null: no note when the balance is
 * enough or could not be read (the static point above still says it). `usdcRaw` is the balance in USDC base units (6 decimals).
 * Never blocks linking.
 */
export function phoneUsdcNote(usdcRaw: string | null | undefined, thresholdCents: number): string | null {
  if (usdcRaw == null || !/^\d+$/.test(usdcRaw)) return null
  const cents = Number(BigInt(usdcRaw) / 10_000n)
  if (cents >= thresholdCents) return null
  // 10-26 copy review row 2: the wallet named, the amount to add (the threshold less what it holds)
  const add = `$${((thresholdCents - cents) / 100).toFixed(2)}`
  if (cents === 0) return `This wallet has no USDC. Add at least ${add} to it so Sprouts can plant.`
  return `This wallet has $${(cents / 100).toFixed(2)} of USDC. Add at least ${add} to it so Sprouts can plant.`
}
