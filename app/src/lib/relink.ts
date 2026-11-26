import { en } from '@/i18n/en'
import type { MeResponse } from './api'
import { confirmWithRetries, isBlockhashExpired, RELINK_NOT_ON_CHAIN, signAndConfirmRebuildingOnce } from './confirm-retry'
import { NEEDS_LIVE } from './lend-mock'
import { leashPda, SETUP_MAX, type SignFlow } from './sign'
import { t } from '@/i18n'

/**
 * Ruling C6 (contracts 5.5, audit Kimi #4): a web-linked wallet's re-link is built and checked by the link page, which the API serves;
 * the Seed Vault checks its own on the phone. Shared with the Settings guarantee (Task 13): one constant, never retyped.
 */
export const WEB_LINK_TRUST = en['relink.trust']

/** R300's public promise verbatim (the controller's one sentence plus its three-word close): the re-link card and Settings (Task 13). */
export const PUBLIC_GUARANTEE = en['promise.public']

/**
 * R287 (in-app card, one Seed Vault signature), R300 (the public promise, verbatim), spec 6.5 (the old approval stays exposed until
 * revoked), C6. T9 fix round 1 (controller ruling, "too much text, simplify"): closed, the card is the title, ONE guarantee sentence and
 * the Re-link button; everything about web-linked wallets opens in place under `disclosure`.
 */
/** 0.1.13 Spanish pass P5 (d): each line is read at use time in the current language (getters), so a card re-render shows it. */
export const RELINK = {
  get title() { return t('relink.title') },
  get body() { return t('promise.public') },
  get button() { return t('relink.button') },
  get waiting() { return t('wallet.waiting') },
  /** After the signature returned, while the confirm (and its retries) runs: the Seeker is done. */
  get checking() { return t('wallet.checking') },
  get disclosure() { return t('relink.disclosure') },
  web: (short: string) => t('relink.web', { wallet: short }),
  /** Contracts 5.5 verbatim: the link page shows this sentence beside the same address. */
  get leashLine() { return t('relink.leashLine') },
  /** Build-invented (Task 9, awaiting his ruling): tells the user why the address is on the card. */
  get compare() { return t('relink.compare') },
  get codeRule() { return t('relink.codeRule') },
  get getCode() { return t('link.code.get') },
  get newCode() { return t('link.code.new') },
  get exposed() { return t('relink.exposed') },
  get done() { return t('relink.done') },
  webDone: (short: string) => t('relink.webDone', { wallet: short }),
  /** Before the Seed Vault is asked: nothing was signed, nothing moved. */
  get failedBefore() { return t('relink.failedBefore') },
  /** T9 review I3: after a signature went out, never claim nothing changed. */
  get sent() { return t('relink.sent') },
  get codeFailed() { return t('link.code.failed') },
}

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
  if (web.some((pk) => leashes[pk])) items.push({ kind: 'note', text: t('relink.trust'), key: 'trust' })
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
 * 11-26 (Kimi scope 2 B): the re-link approval expired before it reached the network, twice (the Seed Vault was already asked once
 * more): it can never land, so the card says so instead of RelinkSent's "may still go through".
 */
export class RelinkExpired extends Error {
  constructor(public reason: unknown) {
    super(t('approval.expired'))
    this.name = 'RelinkExpired'
  }
}

/**
 * POST /api/relink/build, the relink check (only this wallet's leash PDA, at most one revoke), the Seed Vault, POST /api/relink/confirm.
 * A late delegation is confirmed again with the SAME signed transaction (never a new signature); a failure after signing is RelinkSent.
 * 11-26: the one exception, an expired blockhash (409 blockhash_expired): those bytes can never land, so the re-link is built and the
 * Seed Vault asked ONCE more (`onRebuild` first); a second expiry is RelinkExpired.
 */
export async function relinkThisPhone(a: {
  user: string
  /** Task 17b: the setup count the card showed (/api/me/usdc?setup=1); absent or 0 = today's body ({}) and check. */
  setupMax?: number
  build: (body: { setupMax?: number }) => Promise<{ transaction: string }>
  sign: (flow: SignFlow) => (transaction: string) => Promise<string>
  confirm: (body: { signedTransaction: string }) => Promise<unknown>
  /** Called once the Seeker returned the signature, before the first confirm. */
  onSigned?: () => void
  sleep?: (ms: number) => Promise<void>
  /** 11-26: called when the first approval expired, before the Seed Vault is asked once more. */
  onRebuild?: () => void
}): Promise<void> {
  const setupMax = a.setupMax !== undefined && Number.isInteger(a.setupMax) && a.setupMax > 0 ? Math.min(a.setupMax, SETUP_MAX) : 0
  // A build or signature failure is thrown as it came (before any send of that round); only confirm failures are wrapped.
  let confirming = false
  try {
    await signAndConfirmRebuildingOnce({
      build: () => { confirming = false; return a.build(setupMax > 0 ? { setupMax } : {}) },
      sign: (built) => a.sign(setupMax > 0 ? { kind: 'relink', user: a.user, setupMax } : { kind: 'relink', user: a.user })(built.transaction),
      onSigned: a.onSigned,
      confirm: (signedTransaction) => { confirming = true; return confirmWithRetries(() => a.confirm({ signedTransaction }), { notOnChainYet: RELINK_NOT_ON_CHAIN, sleep: a.sleep }) },
      onRebuild: a.onRebuild,
    })
  } catch (e) {
    if (!confirming) throw e
    throw isBlockhashExpired(e) ? new RelinkExpired(e) : new RelinkSent(e)
  }
}

/** T9 review M1: in mock mode a code is never made, since the live link page would build a real delegation (to the puller before go-live). */
export async function relinkCode(a: { mock: boolean; post: () => Promise<{ code: string }> }): Promise<{ code: string } | { error: string }> {
  if (a.mock) return { error: NEEDS_LIVE }
  return { code: (await a.post()).code }
}
