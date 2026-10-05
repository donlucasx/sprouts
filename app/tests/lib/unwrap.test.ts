import { describe, it, expect, vi } from 'vitest'
import type { Transaction } from '@solana/kit'
import { partialUnwrap, unwrapAtTap } from '@/lib/unwrap'
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
  it('sends a checked unwrap to the wallet once', async () => {
    const signAndSend = vi.fn(async (_: Transaction) => undefined)
    await unwrapAtTap({ user: USER, transaction: wire([closeAcct(await ataOf(USER, L.WSOL))]), signAndSend })
    expect(signAndSend).toHaveBeenCalledTimes(1)
  })
  it('never asks the wallet for a close to someone else, or a transaction it cannot read', async () => {
    const signAndSend = vi.fn(async () => undefined)
    await expect(unwrapAtTap({ user: USER, transaction: wire([ix(L.TOKEN, [await ataOf(USER, L.WSOL), ATTACKER, USER], [9])]), signAndSend })).rejects.toThrow(SignRefused)
    await expect(unwrapAtTap({ user: USER, transaction: '!!!', signAndSend })).rejects.toThrow(SignRefused)
    expect(signAndSend).not.toHaveBeenCalled()
  })
})
