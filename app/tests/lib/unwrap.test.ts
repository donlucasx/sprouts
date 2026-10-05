import { describe, it, expect, vi } from 'vitest'
import type { Transaction } from '@solana/kit'
import { isWalletDecline, partialUnwrap, unwrapAfterError, unwrapAtTap, wsolAccount, UNWRAP_DONE, UNWRAP_NOT_SENT, UNWRAP_NOT_YET, UNWRAP_UNSURE, UNWRAP_FAILED, unwrapRetryable, UNWRAP_VALID_MS, type UnwrapStatus } from '@/lib/unwrap'
import { SignRefused } from '@/lib/sign'
import { ATTACKER, USER, wire } from '../fixtures/api-built'
import { ataOf, closeAcct, ix, L } from '../fixtures/lend-built'

const err = (status: number, body?: Record<string, unknown>) => Object.assign(new Error('x'), { status, body })

describe('partialUnwrap: only the move 409 that carries the unwrap', () => {
  it('returns the transaction on a 409 partial', () => expect(partialUnwrap(err(409, { partial: true, unwrapTransaction: 'AAA' }))).toBe('AAA'))
  it('null without a transaction (USDC, or the build failed), on other statuses, and on other errors', () => {
    expect(partialUnwrap(err(409, { partial: true }))).toBeNull()
    expect(partialUnwrap(err(409, { unwrapTransaction: 'AAA' }))).toBeNull()
    expect(partialUnwrap(err(500, { partial: true, unwrapTransaction: 'AAA' }))).toBeNull()
    expect(partialUnwrap(err(409))).toBeNull()
    expect(partialUnwrap('nope')).toBeNull()
  })
})

describe('unwrapAtTap', () => {
  const tx = async () => wire([closeAcct(await ataOf(USER, L.WSOL))])
  const fast = { sleep: async () => {}, waitMs: 0 }
  it('is confirmed only when the chain says so, after the wallet answered with a signature', async () => {
    const signAndSend = vi.fn(async (_: Transaction) => 'SIG')
    const seq: UnwrapStatus[] = ['pending', 'pending', 'confirmed']
    const status = vi.fn(async (_: string) => seq.shift() ?? 'pending')
    expect(await unwrapAtTap({ user: USER, transaction: await tx(), signAndSend, status, ...fast })).toBe('confirmed')
    expect(signAndSend).toHaveBeenCalledTimes(1)
    expect(status).toHaveBeenCalledTimes(3)
    expect(status).toHaveBeenCalledWith('SIG')
  })
  it('a transaction the chain says errored is failed', async () =>
    expect(await unwrapAtTap({ user: USER, transaction: await tx(), signAndSend: async () => 'SIG', status: async () => 'failed', ...fast })).toBe('failed'))
  it('never seen within the bound is unknown, not confirmed; a status read that throws is not a verdict', async () => {
    const status = vi.fn(async (_: string): Promise<UnwrapStatus> => { throw new Error('rpc down') })
    expect(await unwrapAtTap({ user: USER, transaction: await tx(), signAndSend: async () => 'SIG', status, tries: 4, ...fast })).toBe('unknown')
    expect(status).toHaveBeenCalledTimes(4)
  })
  it('a wallet decline is thrown as it is and the chain is never asked', async () => {
    const status = vi.fn(async () => 'confirmed' as UnwrapStatus)
    await expect(unwrapAtTap({ user: USER, transaction: await tx(), signAndSend: async () => { throw new Error('User declined') }, status, ...fast })).rejects.toThrow('User declined')
    expect(status).not.toHaveBeenCalled()
  })
  it('never asks the wallet for a close to someone else, or a transaction it cannot read', async () => {
    const signAndSend = vi.fn(async () => 'SIG')
    const status = async () => 'confirmed' as UnwrapStatus
    await expect(unwrapAtTap({ user: USER, transaction: wire([ix(L.TOKEN, [await ataOf(USER, L.WSOL), ATTACKER, USER], [9])]), signAndSend, status })).rejects.toThrow(SignRefused)
    await expect(unwrapAtTap({ user: USER, transaction: '!!!', signAndSend, status })).rejects.toThrow(SignRefused)
    expect(signAndSend).not.toHaveBeenCalled()
  })
})

describe('unwrapRetryable: the button survives a decline while the blockhash can land', () => {
  it('yes when fresh, no past the blockhash window', () => {
    expect(unwrapRetryable(5_000)).toBe(true)
    expect(unwrapRetryable(UNWRAP_VALID_MS - 1)).toBe(true)
    expect(unwrapRetryable(UNWRAP_VALID_MS)).toBe(false)
  })
})

describe('unwrapAfterError: state, not the error', () => {
  const decline = Object.assign(new Error('declined'), { code: -3 })
  const exists = (v: boolean | Error) => vi.fn(async () => { if (v instanceof Error) throw v; return v })
  it('recognises the wallet explicit decline and a closed sheet only', () => {
    expect(isWalletDecline(decline)).toBe(true)
    expect(isWalletDecline(Object.assign(new Error('x'), { code: 'ERROR_ASSOCIATION_CANCELLED' }))).toBe(true)
    expect(isWalletDecline(new Error('timeout'))).toBe(false)
    expect(isWalletDecline(Object.assign(new Error('x'), { code: -4 }))).toBe(false)
    expect(isWalletDecline('declined')).toBe(false)
  })
  it('our own refusal: its sentence, button gone, no read', async () => {
    const read = exists(true)
    const r = await unwrapAfterError({ error: new SignRefused('Nothing was signed.'), ageMs: 1, accountExists: read })
    expect(r).toEqual({ text: 'Nothing was signed.', error: true, keepButton: false, invalidate: false })
    expect(read).not.toHaveBeenCalled()
  })
  it('a decline: Not sent, button kept while valid and gone after; the chain is not read', async () => {
    const read = exists(true)
    expect(await unwrapAfterError({ error: decline, ageMs: 5_000, accountExists: read })).toEqual({ text: UNWRAP_NOT_SENT, error: true, keepButton: true, invalidate: false })
    expect((await unwrapAfterError({ error: decline, ageMs: UNWRAP_VALID_MS, accountExists: read })).keepButton).toBe(false)
    expect(read).not.toHaveBeenCalled()
  })
  it('any other error and the account is gone: the unwrap landed', async () =>
    expect(await unwrapAfterError({ error: new Error('timeout'), ageMs: 5_000, accountExists: exists(false) })).toEqual({ text: UNWRAP_DONE, error: false, keepButton: false, invalidate: true }))
  it('any other error and the account is still there: not yet, never "Not sent", button only while valid', async () => {
    const fresh = await unwrapAfterError({ error: new Error('timeout'), ageMs: 5_000, accountExists: exists(true) })
    expect(fresh).toEqual({ text: UNWRAP_NOT_YET, error: true, keepButton: true, invalidate: true })
    const late = await unwrapAfterError({ error: new Error('timeout'), ageMs: UNWRAP_VALID_MS + 1, accountExists: exists(true) })
    expect(late.keepButton).toBe(false)
    for (const r of [fresh, late]) expect(r.text).not.toBe(UNWRAP_NOT_SENT)
  })
  it('a read that fails: Sent?, button gone, refresh', async () =>
    expect(await unwrapAfterError({ error: new Error('timeout'), ageMs: 5_000, accountExists: exists(new Error('rpc down')) })).toEqual({ text: UNWRAP_UNSURE, error: false, keepButton: false, invalidate: true }))
  it('UNWRAP_FAILED is never chosen here (only a confirmed on-chain failure uses it)', async () => {
    for (const e of [new Error('x'), decline, new SignRefused('s')]) for (const v of [true, false, new Error('r')]) expect((await unwrapAfterError({ error: e, ageMs: 1, accountExists: exists(v) })).text).not.toBe(UNWRAP_FAILED)
  })
  it('wsolAccount is the user WSOL associated token account the check pins', async () =>
    expect(await wsolAccount(USER)).toBe(await ataOf(USER, L.WSOL)))
})
