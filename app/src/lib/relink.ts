import type { MeResponse } from './api'
import { leashPda, type SignFlow } from './sign'

/**
 * Ruling C6 (contracts 5.5, audit Kimi #4): a web-linked wallet's re-link is built and checked by the link page, which the API serves;
 * the Seed Vault checks its own on the phone. Shared with the Settings guarantee (Task 13): one constant, never retyped.
 */
export const WEB_LINK_TRUST = "Web-linked wallets trust the link page at link time; your Seeker's own wallet does not."

/** R287 (in-app card, one Seed Vault signature), R300 (the public promise, verbatim), spec 6.5 (the old approval stays exposed until revoked), C6. */
export const RELINK = {
  title: 'Re-link to keep planting',
  body: `Sprouts now plants through its own on-chain program. Even if our server is hacked, it can only move your daily round-up (max $5) into your own savings. Never anywhere else. ${WEB_LINK_TRUST}`,
  thisPhone: 'One fingerprint ends your old approval and makes the new one.',
  exposed: 'Until you re-link, your old approval stays on chain under the old rules. Re-link or revoke it to end it.',
  button: 'Re-link',
  web: (short: string) => `${short}: open sprouts.money/link on the computer with that wallet, enter the code, and approve.`,
  /** Contracts 5.5 verbatim: the link page shows this sentence beside the same address. */
  leashLine: 'Your delegation names this Sprouts program address, not a Sprouts server key.',
  /** Build-invented (Task 9): tells the user why the address is on the card. */
  compare: 'Approve on the link page only if it shows this same address.',
  done: 'Re-linked. Your round-ups plant through the Sprouts program now.',
} as const

export type RelinkView = { show: boolean; thisPhone: boolean; web: string[] }
/** What the card offers: this phone's Seed Vault wallet re-links in the app; a web-linked wallet re-links on the link page (contracts 5.5). */
export function relinkView(me: Pick<MeResponse, 'relink' | 'user'>): RelinkView {
  const r = me.relink
  if (!r?.needed) return { show: false, thisPhone: false, web: [] }
  const thisPhone = r.wallets.some((w) => w.via === 'app' && w.pubkey === me.user.pubkey)
  const web = r.wallets.filter((w) => w.via === 'link_page').map((w) => w.pubkey)
  return { show: thisPhone || web.length > 0, thisPhone, web }
}

/** C6: each web-linked wallet with the leash address its new delegation must name, `leashPda(wallet, user)` (the delegator is that wallet). */
export async function relinkWebLines(user: string, web: string[]): Promise<{ pubkey: string; leash: string }[]> {
  return Promise.all(web.map(async (pubkey) => ({ pubkey, leash: await leashPda(pubkey, user) })))
}

/** POST /api/relink/build, the relink check (only this wallet's leash PDA, at most one revoke), the Seed Vault, POST /api/relink/confirm. */
export async function relinkThisPhone(a: {
  user: string
  build: () => Promise<{ transaction: string }>
  sign: (flow: SignFlow) => (transaction: string) => Promise<string>
  confirm: (body: { signedTransaction: string }) => Promise<unknown>
}): Promise<void> {
  const built = await a.build()
  const signedTransaction = await a.sign({ kind: 'relink', user: a.user })(built.transaction)
  await a.confirm({ signedTransaction })
}
