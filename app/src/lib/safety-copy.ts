import { t } from '@/i18n'
import { en } from '@/i18n/en'
import { decimalNumber, usdFromCents } from "@/i18n/format"

/**
 * What Sprouts can and can't do with a linked wallet, shown on Link a wallet before anyone signs. His note 10-22 ("too much text,
 * simplify"): three marked lines. /link and /faqs say these exact lines (api/src/lib/link-safety-copy.ts, his note 10-28: "match it
 * so the messaging is always the same"); change both, the test checks they match.
 */
/** The line above the card. His note 10-28: "Your USDC stays in your wallet until then." cut. */
/** Heading of the Link a wallet screen; the same string as the heading on /link (api/src/app/link/page.tsx). */
export const SAFETY_HEADING = en['link.safety.heading']
/** 11-25 (his ruling, store reviews: "don't get how it works"): three steps at the top of Link a wallet; English here for the web drift test. */
export const LINK_STEP_KEYS = ['link.step.1', 'link.step.2', 'link.step.3'] as const
export const LINK_STEPS: readonly string[] = LINK_STEP_KEYS.map((k) => en[k])
/** 11-25 (his ruling, 4 reviews surprised by link/unlink fees): one line above Approve. */
export const LINK_FEES = en['link.fees']

/** 11-25 (his ruling): two lines, the fee named. English here for the app/web drift test; screens show t() of CAN_KEYS. */
export const CAN_KEYS = ['link.can.plants', 'link.can.fee'] as const
export const CAN: readonly string[] = CAN_KEYS.map((k) => en[k])

export const CANT_KEYS = ['link.cant.send', 'link.cant.touch'] as const
export const CANT: readonly string[] = CANT_KEYS.map((k) => en[k])

/**
 * 10-27 (WAL-002 store rejection + his note "this is a scary permission that will turn off most people"): the wallet's "unlimited USDC"
 * warning, said right above Approve, before the wallet says it. Same words as api/src/app/safety.tsx ApprovalWarning.
 */
export const APPROVAL_WARN_TITLE = en['link.approval.title']
export const APPROVAL_WARN_BODY = en['link.approval.body']

/**
 * 0.1.13 Spanish pass P5 (d): the English constants below stay for tests (en.ts is their source); every screen shows t() of the key.
 * Under "Another wallet" (his note 10-22: make clear more than one wallet can be linked). Its balance is not read here.
 */
export const OTHER_WALLET_LINE = en['link.other.line']
/** 10-28: under the code (link.code.steps). Plain text, no link: a tap would open the phone's own browser, which has no wallet. */
export const CODE_STEPS = en['link.code.steps']
/** 10-28: after the wallet signs, while the link is confirmed on chain (link.finishing). */
export const LINK_FINISHING = en['link.finishing']
/** 10-28 (his note): Home's notice after a link, until OK: "Linked your Seed Vault wallet" or "Linked Abcd...wxyz", whole sentences. */
export const linkedTitle = (mine: boolean, short: string): string =>
  mine ? t('activity.wallet.linked.mine') : t('activity.wallet.linked.other', { wallet: short })
export const LINKED_LINE = en['link.linked.line']

/**
 * The note under "This phone's wallet" when its USDC is below one planting (the threshold), or null: no note when the balance is
 * enough or could not be read (the static point above still says it). `usdcRaw` is the balance in USDC base units (6 decimals).
 * Never blocks linking.
 */
/** About what an approval costs in SOL: the one-time rent and the fee; the API's own no-SOL error says the same. (That rent stays with
 *  its account: it comes back only when an account is emptied and closed, never on revoke.) */
export const LINK_SOL_LAMPORTS = 10_000_000n

/**
 * 0.1.10 (link failures 11-12: 5 of 31 were wallets with no SOL): the note under "This phone's wallet" when it holds less than about
 * 0.01 SOL, said BEFORE the approval instead of after it fails. Null when it has enough or the balance could not be read. Never blocks.
 */
export function phoneSolNote(solLamports: string | null | undefined): string | null {
  if (solLamports == null || !/^\d+$/.test(solLamports)) return null
  if (BigInt(solLamports) >= LINK_SOL_LAMPORTS) return null
  return t('link.note.sol')
}

/**
 * Task 17b (user rent, design 6): a link, re-link or top-up may also set up the user's coin accounts from their own SOL. The count comes
 * from /api/me/usdc?setup=1 (`setupAccounts`); the lamports and dollars are the phone's own (this constant, the phone's SOL price), never
 * the API's. The count shown IS the bound: it goes to the build request and to the sign check (sign.ts takeSetup), so the wallet never
 * signs more creates than the line said. The API adds a setup only when the wallet holds n x rent + 0.02 SOL (api lib/user-setup.ts
 * SETUP_SOL_MARGIN), and may drop it (SOL, size or a failed simulation) after the line showed: the user then pays less than the line
 * said, never more (founder D4). The line itself rounds UP (cents, or 0.0001 SOL), so it never states less than the rent.
 */
/** Rent for one 165-byte token account (api lib/user-setup.ts ATA_RENT_LAMPORTS), copied. */
export const SETUP_RENT_LAMPORTS = 2_039_280n

/** A setup count the API sent, as the whole number the screen may show: 0..cap; anything else is 0 (no line, no creates). */
export function setupAccountsOf(raw: unknown, cap = 7): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) return 0
  return Math.min(raw, cap)
}

/** The link approval request: `&setup=N` only when the screen showed a count, so a count of 0 asks exactly what 0.1.12 asked. */
export const linkApprovalPath = (code: string, wallet: string, setup: number): string =>
  `/api/link/${code}?wallet=${wallet}${setup > 0 ? `&setup=${setup}` : ''}`

/**
 * The founder's line (D4): "Includes $X one-time setup for N coin account(s), paid in SOL. It's yours: you get it back if you empty and
 * close them." $X = N x rent x the phone's SOL price, rounded UP to the cent in integers (the price taken up to the micro-dollar); no
 * usable price shows the SOL, rounded UP to 0.0001. null = no line (no count).
 */
export function setupLine(n: number, solUsd: number | null | undefined): string | null {
  if (!Number.isInteger(n) || n <= 0) return null
  const lamports = BigInt(n) * SETUP_RENT_LAMPORTS
  const form = n === 1 ? 'one' : 'other'
  const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b
  if (solUsd != null && Number.isFinite(solUsd) && solUsd > 0) {
    // micro-dollars per SOL, rounded up; cents = lamports x micro-dollars / (1e9 lamports x 1e4 micro-dollars per cent), rounded up
    const microUsd = BigInt(Math.ceil(solUsd * 1e6))
    const cents = ceilDiv(lamports * microUsd, 10_000_000_000_000n)
    return t(`setup.usd.${form}`, { usd: usdFromCents(Number(cents)), n })
  }
  // 0.0001 SOL = 100,000 lamports, rounded up
  const tenThousandths = ceilDiv(lamports, 100_000n)
  return t(`setup.sol.${form}`, { sol: decimalNumber(Number(tenThousandths) / 10_000, 4), n })
}

export function phoneUsdcNote(usdcRaw: string | null | undefined, thresholdCents: number): string | null {
  if (usdcRaw == null || !/^\d+$/.test(usdcRaw)) return null
  const cents = Number(BigInt(usdcRaw) / 10_000n)
  if (cents >= thresholdCents) return null
  // 10-26 copy review row 2: the wallet named, the amount to add (the threshold less what it holds)
  const add = usdFromCents(thresholdCents - cents)
  if (cents === 0) return t('link.note.usdc.none', { add })
  return t('link.note.usdc.some', { held: usdFromCents(cents), add })
}
