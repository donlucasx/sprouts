import { describe, it, expect, vi } from 'vitest'
import type { Address, Transaction } from '@solana/kit'
import { disclosureItems, relinkCode, relinkView, relinkThisPhone, relinkWebLines, RelinkSent, RELINK, WEB_LINK_TRUST } from '@/lib/relink'
import { confirmWithRetries, LINK_NOT_ON_CHAIN_YET, RELINK_NOT_ON_CHAIN_YET } from '@/lib/confirm-retry'
import { leashPda, makeSigner, SignRefused } from '@/lib/sign'
import { linkIxs, OTHER, USER, wire } from '../fixtures/api-built'
import type { MeResponse } from '@/lib/api'

/** ApiError's shape (api.ts itself pulls the native session store into node). */
class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
/** The routes' real 409 sentences: link/confirm route.ts:75; relink/confirm lending-api.md:5675 (pinned verbatim here, not via the constant). */
const LINK_LATE = 'No delegation found for this wallet yet. Sign the approval first.'
const RELINK_LATE = 'No re-link found on chain yet. Check again in a minute.'

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
    for (const t of Object.values(RELINK)) expect(typeof t === 'string' ? t : t('AbCd...WxYz')).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('C6 (contracts 5.5, Kimi #4): the web-linked wallet shows its leash address; the guarantee names what the link page is trusted for', () => {
  it('the guarantee sentence verbatim, one shared constant; the closed card carries only the promise (fix round 1 ruling), C6 opens in the disclosure', () => {
    expect(WEB_LINK_TRUST).toBe("Web-linked wallets trust the link page at link time; your Seeker's own wallet does not.")
    expect(RELINK.body).toBe('Even if our server is hacked, it can only move your daily round-up (max $5) into your own savings. Never anywhere else.')
    expect(RELINK.disclosure).toBe('Linked a wallet on a computer?')
  })
  it('the disclosure: each wallet line, its address with the program-address sentence right under it, the C6 sentence after the addresses, the exposure note last', () => {
    const items = disclosureItems(['A1111111111111111', 'B2222222222222222'], { A1111111111111111: 'LEASH_A', B2222222222222222: 'LEASH_B' })
    expect(items.map((i) => i.text)).toEqual([
      RELINK.web('A111...1111'),
      'LEASH_A',
      `${RELINK.leashLine} ${RELINK.compare}`,
      RELINK.web('B222...2222'),
      'LEASH_B',
      `${RELINK.leashLine} ${RELINK.compare}`,
      WEB_LINK_TRUST,
      RELINK.exposed,
    ])
    expect(items.filter((i) => i.kind === 'address').map((i) => i.text)).toEqual(['LEASH_A', 'LEASH_B'])
  })
  it('M4: before (or without) an address, neither address sentence shows', () => {
    expect(disclosureItems(['A1111111111111111'], {}).map((i) => i.text)).toEqual([RELINK.web('A111...1111'), RELINK.exposed])
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

describe('M2: a wallet /api/me already shows on the leash, or revoked, is dropped even if the API still lists it', () => {
  const both = { needed: true, wallets: [{ pubkey: USER, via: 'app' as const }, { pubkey: OTHER, via: 'link_page' as const }] }
  const withWallets = (wallets: unknown[]) => ({ user: { pubkey: USER }, relink: both, wallets }) as unknown as MeResponse
  const w = (pubkey: string, status: string, linkModel: string) => ({ pubkey, status, dailyCapCents: 500, linkModel })
  it('this phone on the leash: no button; the web wallet stays', () => {
    expect(relinkView(withWallets([w(USER, 'active', 'leash')]))).toEqual({ show: true, thisPhone: false, web: [OTHER] })
  })
  it('the web wallet revoked or on the leash: gone', () => {
    expect(relinkView(withWallets([w(OTHER, 'revoked', 'puller')])).web).toEqual([])
    expect(relinkView(withWallets([w(OTHER, 'active', 'leash')])).web).toEqual([])
  })
  it('both done: the card hides; a puller wallet stays asked', () => {
    expect(relinkView(withWallets([w(USER, 'active', 'leash'), w(OTHER, 'active', 'leash')])).show).toBe(false)
    expect(relinkView(withWallets([w(USER, 'active', 'puller'), w(OTHER, 'active', 'puller')]))).toEqual({ show: true, thisPhone: true, web: [OTHER] })
  })
})

describe('M1: mock mode never makes a real link code', () => {
  it('mock: the needs-live sentence, and /api/link/new is not called', async () => {
    const post = vi.fn(async () => ({ code: '123456' }))
    expect(await relinkCode({ mock: true, post })).toEqual({ error: 'Mock mode: this needs the live API.' })
    expect(post).not.toHaveBeenCalled()
  })
  it('live: the code', async () => {
    expect(await relinkCode({ mock: false, post: async () => ({ code: '123456' }) })).toEqual({ code: '123456' })
  })
})

describe('confirmWithRetries (shared with Connect, T9 review I3)', () => {
  it("Connect's matcher is link/confirm's real sentence; the two routes' sentences do not match each other", () => {
    expect(LINK_LATE).toContain(LINK_NOT_ON_CHAIN_YET)
    expect(RELINK_LATE).not.toContain(LINK_NOT_ON_CHAIN_YET)
    expect(LINK_LATE).not.toContain(RELINK_NOT_ON_CHAIN_YET)
  })
  it('late answers are retried, 5 sends in all, then the last error is thrown', async () => {
    const send = vi.fn(async (_n: number) => {
      throw new ApiError(409, LINK_LATE)
    })
    await expect(confirmWithRetries(send, { notOnChainYet: LINK_NOT_ON_CHAIN_YET, sleep: async () => {} })).rejects.toThrow('No delegation found')
    expect(send.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3, 4])
  })
  it('any other error (or a 409 that is not the late one) is thrown at once', async () => {
    for (const err of [new ApiError(400, 'Bad'), new ApiError(409, 'Code used'), new Error(LINK_LATE)]) {
      const send = vi.fn(async () => {
        throw err
      })
      await expect(confirmWithRetries(send, { notOnChainYet: LINK_NOT_ON_CHAIN_YET, sleep: async () => {} })).rejects.toBe(err)
      expect(send).toHaveBeenCalledTimes(1)
    }
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
  it("I3: the relink route's REAL late sentence re-sends the SAME signed transaction (one signature), then succeeds", async () => {
    expect(RELINK_NOT_ON_CHAIN_YET).toBe(RELINK_LATE)
    const tx = wire(await linkIxs({ delegatee: (await leashPda(USER, USER)) as Address, revokeOld: true }))
    const sign = vi.fn(async (t: Transaction) => t)
    const onSigned = vi.fn()
    let n = 0
    const confirm = vi.fn(async (_b: { signedTransaction: string }) => {
      expect(onSigned).toHaveBeenCalledTimes(1) // the waiting line has already turned to the chain line
      if (n++ < 2) throw new ApiError(409, RELINK_LATE)
      return { relinked: true }
    })
    await relinkThisPhone({ user: USER, build: async () => ({ transaction: tx }), sign: (flow) => makeSigner(sign, flow), confirm, onSigned, sleep: async () => {} })
    expect(sign).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls).toEqual([[{ signedTransaction: tx }], [{ signedTransaction: tx }], [{ signedTransaction: tx }]])
  })
  it("I3: the link route's sentence is NOT a late answer on the relink route: no re-send, RelinkSent at once", async () => {
    const tx = wire(await linkIxs({ delegatee: (await leashPda(USER, USER)) as Address, revokeOld: true }))
    const confirm = vi.fn(async () => {
      throw new ApiError(409, LINK_LATE)
    })
    const out = relinkThisPhone({ user: USER, build: async () => ({ transaction: tx }), sign: (flow) => makeSigner(async (t: Transaction) => t, flow), confirm, sleep: async () => {} })
    await expect(out).rejects.toBeInstanceOf(RelinkSent)
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('a refused signature never calls onSigned (the Seeker line stays until the error)', async () => {
    const onSigned = vi.fn()
    const tx = wire(await linkIxs({ revokeOld: true }))
    await expect(relinkThisPhone({ user: USER, build: async () => ({ transaction: tx }), sign: (flow) => makeSigner(async (t: Transaction) => t, flow), confirm: vi.fn(), onSigned })).rejects.toThrow(SignRefused)
    expect(onSigned).not.toHaveBeenCalled()
  })
  it("I3: a failure after signing is RelinkSent, and its copy never says nothing changed", async () => {
    const tx = wire(await linkIxs({ delegatee: (await leashPda(USER, USER)) as Address, revokeOld: true }))
    const confirm = vi.fn(async () => {
      throw new ApiError(500, 'Server error')
    })
    const out = relinkThisPhone({ user: USER, build: async () => ({ transaction: tx }), sign: (flow) => makeSigner(async (t: Transaction) => t, flow), confirm, sleep: async () => {} })
    await expect(out).rejects.toBeInstanceOf(RelinkSent)
    await expect(out).rejects.toThrow(RELINK.sent)
    expect(RELINK.sent).not.toMatch(/nothing changed/i)
  })
  it('a failed build is not RelinkSent (nothing was signed)', async () => {
    const err = new ApiError(409, 'x')
    const out = relinkThisPhone({ user: USER, build: async () => { throw err }, sign: () => async () => 'never', confirm: vi.fn() })
    await expect(out).rejects.toBe(err)
  })
})
