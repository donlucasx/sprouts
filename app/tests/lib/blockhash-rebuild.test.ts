import { describe, it, expect, vi } from 'vitest'
import type { Address, Transaction } from '@solana/kit'

vi.mock('@/lib/session', () => ({ loadSession: async () => null }))
import { ApiError } from '@/lib/api'
import { confirmWithRetries, isBlockhashExpired, LINK_NOT_ON_CHAIN, signAndConfirmRebuildingOnce } from '@/lib/confirm-retry'
import { linkErrorView } from '@/lib/link-error'
import { relinkThisPhone, RelinkExpired, RelinkSent } from '@/lib/relink'
import { leashPda, makeSigner } from '@/lib/sign'
import { en } from '@/i18n/en'
import { es } from '@/i18n/es'
import { linkIxs, USER, wire } from '../fixtures/api-built'

// 11-26 (Kimi scope 2 B): a signed approval whose blockhash expired can never land. The 0.1.13 app fetches a fresh approval and asks the
// wallet ONCE more; never a third signature, and confirmWithRetries never re-posts the dead bytes.
const STEM = 'No delegation found: the network did not accept the approval (BlockhashNotFound). Nothing was linked. Try again.'
const expired = () => new ApiError(409, STEM, { error: STEM, code: 'blockhash_expired' })
const late = () => new ApiError(409, 'No delegation found yet: your approval was sent but is not on chain. Trying again is safe.', { code: 'no_delegation' })

describe('the new line', () => {
  it('en and es, as Lucas worded them', () => {
    expect(en['approval.expired']).toBe('The approval took too long to reach the network. Approve once more.')
    expect(es['approval.expired']).toBe('La aprobación tardó demasiado en llegar a la red. Apruébala una vez más.')
  })
})

describe('isBlockhashExpired', () => {
  it('the 409 and the code; the stem alone (a 0.1.12-era server) or another status is not', () => {
    expect(isBlockhashExpired(expired())).toBe(true)
    expect(isBlockhashExpired(new ApiError(409, STEM))).toBe(false)
    expect(isBlockhashExpired(new ApiError(400, STEM, { code: 'blockhash_expired' }))).toBe(false)
    expect(isBlockhashExpired(late())).toBe(false)
  })
})

describe('confirmWithRetries on blockhash_expired', () => {
  it('stops at once (the code decides alone, the English stem does not make it a late answer): no re-post of dead bytes', async () => {
    const send = vi.fn(async () => { throw expired() })
    await expect(confirmWithRetries(send, { notOnChainYet: LINK_NOT_ON_CHAIN, sleep: async () => {} })).rejects.toMatchObject({ code: 'blockhash_expired' })
    expect(send).toHaveBeenCalledTimes(1)
  })
})

function flow(confirms: (() => unknown)[]) {
  const log: string[] = []
  let builds = 0
  let i = 0
  const run = () => signAndConfirmRebuildingOnce({
    build: async () => { builds++; log.push(`build${builds}`); return `tx${builds}` },
    sign: async (t) => { log.push(`sign ${t}`); return `signed ${t}` },
    onSigned: () => log.push('signed'),
    confirm: async (s) => { log.push(`confirm ${s}`); const r = confirms[i++](); if (r instanceof Error) throw r },
    onRebuild: () => log.push('again'),
  })
  return { log, run }
}

describe('signAndConfirmRebuildingOnce', () => {
  it('confirmed first time: one build, one signature', async () => {
    const f = flow([() => undefined])
    await f.run()
    expect(f.log).toEqual(['build1', 'sign tx1', 'signed', 'confirm signed tx1'])
  })
  it('expired once: re-GET, re-sign ONCE, confirm again', async () => {
    const f = flow([expired, () => undefined])
    await f.run()
    expect(f.log).toEqual(['build1', 'sign tx1', 'signed', 'confirm signed tx1', 'again', 'build2', 'sign tx2', 'signed', 'confirm signed tx2'])
  })
  it('expired twice: the second is thrown, no third build or signature (no rebuild loop)', async () => {
    const f = flow([expired, expired, () => undefined])
    await expect(f.run()).rejects.toMatchObject({ code: 'blockhash_expired' })
    expect(f.log.filter((l) => l.startsWith('sign '))).toHaveLength(2)
    expect(f.log.filter((l) => l.startsWith('build'))).toHaveLength(2)
  })
  it('any other error is thrown at once with no rebuild', async () => {
    const f = flow([late])
    await expect(f.run()).rejects.toMatchObject({ code: 'no_delegation' })
    expect(f.log).not.toContain('again')
  })
})

describe('linkErrorView', () => {
  it('a final blockhash_expired shows the app line, not the server sentence', () => {
    expect(linkErrorView(expired())).toEqual({ title: '', body: en['approval.expired'], ask: false })
  })
})

describe('relinkThisPhone on blockhash_expired', () => {
  const RELINK_LATE = 'No re-link found on chain yet. Check again in a minute.'
  const relinkExpired = () => new ApiError(409, RELINK_LATE, { code: 'blockhash_expired' })
  async function setup(answers: (() => unknown)[]) {
    const tx = wire(await linkIxs({ delegatee: (await leashPda(USER, USER)) as Address, revokeOld: true }))
    const sign = vi.fn(async (t: Transaction) => t)
    const build = vi.fn(async () => ({ transaction: tx }))
    let i = 0
    const confirm = vi.fn(async () => { const r = answers[i++](); if (r instanceof Error) throw r; return { relinked: true } })
    const onRebuild = vi.fn()
    const run = () => relinkThisPhone({ user: USER, build, sign: (f) => makeSigner(sign, f), confirm, onRebuild, sleep: async () => {} })
    return { sign, build, confirm, onRebuild, run }
  }
  it('expired once: built again, the Seed Vault asked once more, relinked', async () => {
    const s = await setup([relinkExpired, () => undefined])
    await s.run()
    expect(s.build).toHaveBeenCalledTimes(2)
    expect(s.sign).toHaveBeenCalledTimes(2)
    expect(s.confirm).toHaveBeenCalledTimes(2)
    expect(s.onRebuild).toHaveBeenCalledTimes(1)
  })
  it('expired twice: RelinkExpired (never "may still go through"), two signatures only', async () => {
    const s = await setup([relinkExpired, relinkExpired, () => undefined])
    const e = await s.run().then(() => null, (x: unknown) => x)
    expect(e).toBeInstanceOf(RelinkExpired)
    expect((e as Error).message).toBe(en['approval.expired'])
    expect(s.sign).toHaveBeenCalledTimes(2)
  })
  it('the late answer still re-posts the same bytes and ends in RelinkSent, with no rebuild', async () => {
    const late = () => new ApiError(409, RELINK_LATE, { code: 'relink_not_on_chain' })
    const s = await setup([late, late, late, late, late])
    await expect(s.run()).rejects.toBeInstanceOf(RelinkSent)
    expect(s.build).toHaveBeenCalledTimes(1)
    expect(s.sign).toHaveBeenCalledTimes(1)
    expect(s.confirm).toHaveBeenCalledTimes(5)
  })
})
