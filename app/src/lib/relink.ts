import type { MeResponse } from './api'
import { confirmWithRetries, RELINK_NOT_ON_CHAIN_YET } from './confirm-retry'
import { NEEDS_LIVE } from './lend-mock'
import { leashPda, type SignFlow } from './sign'

/**
 * Ruling C6 (contracts 5.5, audit Kimi #4): a web-linked wallet's re-link is built and checked by the link page, which the API serves;
 * the Seed Vault checks its own on the phone. Shared with the Settings guarantee (Task 13): one constant, never retyped.
 */
export const WEB_LINK_TRUST = "Web-linked wallets trust the link page at link time; your Seeker's own wallet does not."

/**
 * R287 (in-app card, one Seed Vault signature), R300 (the public promise, verbatim), spec 6.5 (the old approval stays exposed until
 * revoked), C6. T9 fix round 1 (controller ruling, "too much text, simplify"): closed, the card is the title, ONE guarantee sentence and
 * the Re-link button; everything about web-linked wallets opens in place under `disclosure`.
 */
export const RELINK = {
  title: 'Re-link to keep planting',
  // R300's promise verbatim: the controller's one sentence plus its three-word close, which the brief's test pins
  body: 'Even if our server is hacked, it can only move your daily round-up (max $5) into your own savings. Never anywhere else.',
  button: 'Re-link',
  waiting: 'Waiting for your Seeker.',
  /** After the signature returned, while the confirm (and its retries) runs: the Seeker is done. */
  checking: 'Approved. Checking the chain.',
  disclosure: 'Linked a wallet on a computer?',
  web: (short: string) => `${short}: open sprouts.money/link on the computer with that wallet, enter the code, and approve.`,
  /** Contracts 5.5 verbatim: the link page shows this sentence beside the same address. */
  leashLine: 'Your delegation names this Sprouts program address, not a Sprouts server key.',
  /** Build-invented (Task 9, awaiting his ruling): tells the user why the address is on the card. */
  compare: 'Approve on the link page only if it shows this same address.',
  codeRule: 'It lasts 15 minutes, one wallet.',
  getCode: 'Get a code',
  newCode: 'Get a new code',
  exposed: 'Until you re-link, your old approval stays on chain under the old rules. Re-link or revoke it to end it.',
  done: 'Re-linked. Your round-ups plant through the Sprouts program now.',
  webDone: (short: string) => `Re-linked ${short}.`,
  /** Before the Seed Vault is asked: nothing was signed, nothing moved. */
  failedBefore: 'The re-link did not go through. Nothing changed.',
  /** T9 review I3: after a signature went out, never claim nothing changed. */
  sent: 'Your approval was sent but is not confirmed yet. Pull down in a minute to check before you try again.',
  codeFailed: 'Could not make a code. Try again.',
} as const

export const short = (pk: string) => `${pk.slice(0, 4)}...${pk.slice(-4)}`

export type RelinkView = { show: boolean; thisPhone: boolean; web: string[] }
/**
 * What the card offers: this phone's Seed Vault wallet re-links in the app; a web-linked wallet re-links on the link page (contracts
 * 5.5). T9 review M2: a wallet `me.wallets` already shows on the leash, or revoked, is dropped even if a stale API still lists it.
 */
export function relinkView(me: Pick<MeResponse, 'relink' | 'user'> & { wallets?: MeResponse['wallets'] }): RelinkView {
  const r = me.relink
  if (!r?.needed) return { show: false, thisPhone: false, web: [] }
  const done = new Set((me.wallets ?? []).filter((w) => w.linkModel === 'leash' || w.status === 'revoked').map((w) => w.pubkey))
  const asked = r.wallets.filter((w) => !done.has(w.pubkey))
  const thisPhone = asked.some((w) => w.via === 'app' && w.pubkey === me.user.pubkey)
  const web = asked.filter((w) => w.via === 'link_page').map((w) => w.pubkey)
  return { show: thisPhone || web.length > 0, thisPhone, web }
}

/** C6: each web-linked wallet with the leash address its new delegation must name, `leashPda(wallet, user)` (the delegator is that wallet). */
export async function relinkWebLines(user: string, web: string[]): Promise<{ pubkey: string; leash: string }[]> {
  return Promise.all(web.map(async (pubkey) => ({ pubkey, leash: await leashPda(pubkey, user) })))
}

export type DisclosureItem = { kind: 'line' | 'address' | 'note'; text: string; key: string }
/**
 * What opens under the disclosure, in order. Per wallet: its link-page line, then (only once the address resolved, T9 review M4) the
 * address with the contracts 5.5 sentence and the compare line right under it; then the C6 guarantee sentence once, after the last
 * address; the exposure note closes it.
 */
export function disclosureItems(web: string[], leashes: Record<string, string>): DisclosureItem[] {
  const items: DisclosureItem[] = []
  for (const pk of web) {
    items.push({ kind: 'line', text: RELINK.web(short(pk)), key: `${pk}-line` })
    const leash = leashes[pk]
    if (leash) {
      items.push({ kind: 'address', text: leash, key: `${pk}-leash` })
      items.push({ kind: 'note', text: `${RELINK.leashLine} ${RELINK.compare}`, key: `${pk}-note` })
    }
  }
  if (web.some((pk) => leashes[pk])) items.push({ kind: 'note', text: WEB_LINK_TRUST, key: 'trust' })
  items.push({ kind: 'note', text: RELINK.exposed, key: 'exposed' })
  return items
}

/** A send that failed after the Seed Vault signed (T9 review I3): the approval may still land, so the card says so. */
export class RelinkSent extends Error {
  constructor(public reason: unknown) {
    super(RELINK.sent)
    this.name = 'RelinkSent'
  }
}

/**
 * POST /api/relink/build, the relink check (only this wallet's leash PDA, at most one revoke), the Seed Vault, POST /api/relink/confirm.
 * A late delegation is confirmed again with the SAME signed transaction (never a new signature); a failure after signing is RelinkSent.
 */
export async function relinkThisPhone(a: {
  user: string
  build: () => Promise<{ transaction: string }>
  sign: (flow: SignFlow) => (transaction: string) => Promise<string>
  confirm: (body: { signedTransaction: string }) => Promise<unknown>
  /** Called once the Seeker returned the signature, before the first confirm. */
  onSigned?: () => void
  sleep?: (ms: number) => Promise<void>
}): Promise<void> {
  const built = await a.build()
  const signedTransaction = await a.sign({ kind: 'relink', user: a.user })(built.transaction)
  a.onSigned?.()
  try {
    await confirmWithRetries(() => a.confirm({ signedTransaction }), { notOnChainYet: RELINK_NOT_ON_CHAIN_YET, sleep: a.sleep })
  } catch (e) {
    throw new RelinkSent(e)
  }
}

/** T9 review M1: in mock mode a code is never made, since the live link page would build a real delegation (to the puller before go-live). */
export async function relinkCode(a: { mock: boolean; post: () => Promise<{ code: string }> }): Promise<{ code: string } | { error: string }> {
  if (a.mock) return { error: NEEDS_LIVE }
  return { code: (await a.post()).code }
}
