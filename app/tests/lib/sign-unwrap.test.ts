import { describe, it, expect, vi } from 'vitest'
import { address, type Transaction } from '@solana/kit'
import { makeSigner, REFUSED, SignRefused, type SignFlow } from '@/lib/sign'
import { ATTACKER, OTHER, USER, wire } from '../fixtures/api-built'
import { ataOf, closeAcct, createAta, ix, L } from '../fixtures/lend-built'

const flow: SignFlow = { kind: 'unwrap_wsol', user: USER }
async function refused(base64: string, why: keyof typeof REFUSED, f: SignFlow = flow) {
  const sign = vi.fn(async (tx: Transaction) => tx)
  const out = makeSigner(sign, f)(base64)
  await expect(out).rejects.toThrow(SignRefused)
  await expect(out).rejects.toThrow(REFUSED[why])
  expect(sign).not.toHaveBeenCalled()
}

describe('unwrap_wsol: the one close the move 409 hands back', () => {
  it('accepts exactly one CloseAccount of the user WSOL account to the user', async () => {
    const sign = vi.fn(async (tx: Transaction) => tx)
    const tx = wire([closeAcct(await ataOf(USER, L.WSOL))])
    expect(await makeSigner(sign, flow)(tx)).toBe(tx)
    expect(sign).toHaveBeenCalledTimes(1)
  })
  it('refuses a close to another destination', async () =>
    refused(wire([ix(L.TOKEN, [await ataOf(USER, L.WSOL), ATTACKER, USER], [9])]), 'plan'))
  it('refuses a close with another authority', async () =>
    refused(wire([ix(L.TOKEN, [await ataOf(USER, L.WSOL), USER, OTHER], [9])]), 'plan'))
  it('refuses a close of another account (another owner, or the USDC account)', async () => {
    await refused(wire([closeAcct(await ataOf(OTHER, L.WSOL))]), 'plan')
    await refused(wire([closeAcct(await ataOf(USER, L.USDC))]), 'plan')
  })
  it('refuses an extra instruction, a ComputeBudget one, or two closes', async () => {
    const close = closeAcct(await ataOf(USER, L.WSOL))
    await refused(wire([createAta(await ataOf(USER, L.WSOL), L.WSOL), close]), 'program')
    await refused(wire([ix('ComputeBudget111111111111111111111111111111', [], [2, 0, 0, 0, 0])].concat(close)), 'program')
    await refused(wire([close, close]), 'plan')
    await refused(wire([close, ix(L.TOKEN, [await ataOf(USER, L.WSOL), USER, USER], [3, 1, 0, 0, 0, 0, 0, 0, 0])]), 'plan')
  })
  it('refuses another instruction on its own: a different Token instruction, or no instruction', async () => {
    await refused(wire([ix(L.TOKEN, [await ataOf(USER, L.WSOL), USER, USER], [3, 1, 0, 0, 0, 0, 0, 0, 0])]), 'plan')
    await refused(wire([]), 'plan')
  })
  it('refuses a transaction for another fee payer', async () =>
    refused(wire([closeAcct(await ataOf(USER, L.WSOL))], address(OTHER)), 'payer'))
})
