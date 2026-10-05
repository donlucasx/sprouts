import { describe, it, expect, vi } from 'vitest'
import type { Address, Transaction } from '@solana/kit'
import { relinkView, relinkThisPhone, relinkWebLines, RELINK, WEB_LINK_TRUST } from '@/lib/relink'
import { leashPda, makeSigner, SignRefused } from '@/lib/sign'
import { linkIxs, OTHER, USER, wire } from '../fixtures/api-built'
import type { MeResponse } from '@/lib/api'

const me = (relink?: MeResponse['relink']) => ({ user: { pubkey: USER }, relink }) as unknown as MeResponse

describe('relinkView (R287; invariant 3: only when the API asks)', () => {
  it('hidden when the API does not ask (field absent, needed false, no wallet)', () => {
    expect(relinkView(me()).show).toBe(false)
    expect(relinkView(me({ needed: false, wallets: [{ pubkey: USER, via: 'app' }] })).show).toBe(false)
    expect(relinkView(me({ needed: true, wallets: [] })).show).toBe(false)
  })
  it('this phone re-links in the app; another wallet on the link page', () => {
    expect(relinkView(me({ needed: true, wallets: [{ pubkey: USER, via: 'app' }, { pubkey: OTHER, via: 'link_page' }] }))).toEqual({ show: true, thisPhone: true, web: [OTHER] })
  })
  it('an "app" wallet that is not this phone gets nothing to tap (contracts 5.5: via app means pubkey == user)', () => {
    expect(relinkView(me({ needed: true, wallets: [{ pubkey: OTHER, via: 'app' }] }))).toEqual({ show: false, thisPhone: false, web: [] })
  })
  it("the copy: the ruled title, the public promise verbatim, the old approval's exposure said, no dashes", () => {
    expect(RELINK.title).toBe('Re-link to keep planting')
    expect(RELINK.body).toContain('Even if our server is hacked, it can only move your daily round-up (max $5) into your own savings. Never anywhere else.')
    expect(RELINK.exposed).toBe('Until you re-link, your old approval stays on chain under the old rules. Re-link or revoke it to end it.')
    for (const t of [RELINK.title, RELINK.body, RELINK.thisPhone, RELINK.exposed, RELINK.done, RELINK.web('AbCd...WxYz'), RELINK.leashLine, RELINK.compare]) expect(t).not.toMatch(/[–—]/)
  })
})

describe('C6 (contracts 5.5, Kimi #4): the web-linked wallet shows its leash address; the guarantee names what the link page is trusted for', () => {
  it('the guarantee sentence verbatim, one shared constant, closing the card body', () => {
    expect(WEB_LINK_TRUST).toBe("Web-linked wallets trust the link page at link time; your Seeker's own wallet does not.")
    expect(RELINK.body.endsWith(` ${WEB_LINK_TRUST}`)).toBe(true)
  })
  it("each web wallet's line carries leashPda(that wallet, the user), the address the link page shows", async () => {
    const lines = await relinkWebLines(USER, [OTHER])
    expect(lines).toEqual([{ pubkey: OTHER, leash: await leashPda(OTHER, USER) }])
    // the delegator is the web wallet, never this phone: not the Seed Vault's own leash, and not the seeds swapped
    expect(lines[0].leash).not.toBe(await leashPda(USER, USER))
    expect(lines[0].leash).not.toBe(await leashPda(USER, OTHER))
    expect(RELINK.leashLine).toBe('Your delegation names this Sprouts program address, not a Sprouts server key.')
  })
  it('no web wallet, no lines', async () => {
    expect(await relinkWebLines(USER, [])).toEqual([])
  })
  it('R318: the card never calls the network fee a Sprouts fee', () => {
    for (const t of Object.values(RELINK)) expect(typeof t === 'string' ? t : t('x')).not.toMatch(/sprouts fee/i)
  })
})

describe('relinkThisPhone', () => {
  it('build, the pinned relink check, the Seed Vault once, confirm', async () => {
    const tx = wire(await linkIxs({ delegatee: (await leashPda(USER, USER)) as Address, revokeOld: true }))
    const sign = vi.fn(async (t: Transaction) => t)
    const confirm = vi.fn(async () => ({ relinked: true }))
    await relinkThisPhone({ user: USER, build: async () => ({ transaction: tx }), sign: (flow) => makeSigner(sign, flow), confirm })
    expect(sign).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith({ signedTransaction: tx })
  })
  it('an API that answers a link to the old puller is refused; nothing is confirmed', async () => {
    const tx = wire(await linkIxs({ revokeOld: true }))
    const sign = vi.fn(async (t: Transaction) => t)
    const confirm = vi.fn()
    await expect(relinkThisPhone({ user: USER, build: async () => ({ transaction: tx }), sign: (flow) => makeSigner(sign, flow), confirm })).rejects.toThrow(SignRefused)
    expect(sign).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
})
