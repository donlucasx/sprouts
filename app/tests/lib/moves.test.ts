import { describe, it, expect, vi } from 'vitest'
import { depositCap, moveAtTap, moveCopy, moveFlows, MOVE_SENT, MoveSent, MOVE_TXS_ALLOWED } from '@/lib/moves'
import { FIXTURE_MOVE, FIXTURE_POSITIONS } from '@/lib/lend-fixtures'
import { REFUSED, SignRefused } from '@/lib/sign'
import { USER } from '../fixtures/api-built'

const built = (n: number) => ({ transactions: Array.from({ length: n }, () => 'x'), receiptRaw: '940000', depositRaw: '999000', brief: '' })

describe('the move card (R280: least asking; spec 7)', () => {
  it('says what moves where, why, the gain against the cost, and that it is one approval', () => {
    expect(moveCopy(FIXTURE_MOVE)).toEqual({ title: 'Move your USDC to Kamino?', line: 'Kamino has paid 4.4% over 7 days, Jupiter 3.9%. About $0.04 more in 30 days, after a network cost of $0.01. One approval.' })
    expect(moveCopy(FIXTURE_MOVE).line).not.toMatch(/[–—]/)
  })
  it('one transaction is the whole move; two are redeem then deposit only when S3 passed; anything else refused', () => {
    expect(MOVE_TXS_ALLOWED).toEqual([1, 2]) // S3 VERDICT ONE
    expect(moveFlows(USER, FIXTURE_MOVE, built(1), '999140').map((f) => ('part' in f ? f.part : null))).toEqual(['whole'])
    expect(moveFlows(USER, FIXTURE_MOVE, built(2), '999140').map((f) => ('part' in f ? f.part : null))).toEqual(['redeem', 'deposit'])
    for (const n of [0, 3]) expect(() => moveFlows(USER, FIXTURE_MOVE, built(n), '999140')).toThrow(REFUSED.plan)
    expect(moveFlows(USER, FIXTURE_MOVE, built(1), '999140')[0]).toMatchObject({ kind: 'move_jlend_to_klend', asset: 'USDC_LEND', receiptRaw: '940000', depositRaw: '999000' })
    expect(moveFlows(USER, { ...FIXTURE_MOVE, from: 'kamino_klend', to: 'jupiter_lend' }, built(2), '1999752')).toMatchObject([{ kind: 'move_klend_to_jlend', part: 'redeem' }, { kind: 'move_klend_to_jlend', part: 'deposit' }])
  })
  it('a proposal from a venue to itself is not a move', () => {
    expect(() => moveFlows(USER, { ...FIXTURE_MOVE, to: 'jupiter_lend' }, built(2), '999140')).toThrow(SignRefused)
  })
  it('a build for another position than the card shows is not signed', async () => {
    const signAll = vi.fn()
    const confirm = vi.fn()
    expect(await moveAtTap({ user: USER, proposal: FIXTURE_MOVE, positions: FIXTURE_POSITIONS, build: async () => ({ transactions: ['x'], receiptRaw: '1', depositRaw: '1', brief: '' }), signAll, confirm })).toEqual({ stopped: 'Your position changed since this was proposed. Nothing moved.' })
    expect(signAll).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
  it('signs the flows the build implies and confirms with the signed transactions in order', async () => {
    const confirm = vi.fn(async () => ({}))
    const signAll = vi.fn(() => async (txs: string[]) => txs.map((t) => `${t}!`))
    expect(await moveAtTap({ user: USER, proposal: FIXTURE_MOVE, positions: FIXTURE_POSITIONS, build: async () => ({ transactions: ['a', 'b'], receiptRaw: '940000', depositRaw: '999000', brief: '' }), signAll, confirm })).toEqual({ done: true })
    expect(signAll).toHaveBeenCalledWith([expect.objectContaining({ part: 'redeem' }), expect.objectContaining({ part: 'deposit' })])
    expect(confirm).toHaveBeenCalledWith({ id: 'mock-move-1', signedTransactions: ['a!', 'b!'] })
  })
  it('a refused signature never reaches the confirm', async () => {
    const confirm = vi.fn()
    const signAll = vi.fn(() => async () => { throw new SignRefused(REFUSED.plan) })
    await expect(moveAtTap({ user: USER, proposal: FIXTURE_MOVE, positions: FIXTURE_POSITIONS, build: async () => ({ transactions: ['a'], receiptRaw: '940000', depositRaw: '999000', brief: '' }), signAll, confirm })).rejects.toThrow(REFUSED.plan)
    expect(confirm).not.toHaveBeenCalled()
  })
  it("the cap is the proposal's source position's underlying amount; none, and nothing is signed", async () => {
    expect(depositCap(FIXTURE_MOVE, FIXTURE_POSITIONS)).toBe('999140') // USDC on Jupiter, the card's source
    expect(depositCap({ ...FIXTURE_MOVE, from: 'kamino_klend', to: 'jupiter_lend' }, FIXTURE_POSITIONS)).toBe('1999752')
    expect(depositCap({ ...FIXTURE_MOVE, asset: 'SOL_LEND', from: 'kamino_klend', to: 'jupiter_lend' }, FIXTURE_POSITIONS)).toBeNull()
    expect(depositCap(FIXTURE_MOVE, undefined)).toBeNull()
    expect(depositCap(FIXTURE_MOVE, [{ asset: 'USDC_LEND', venue: 'jupiter_lend', underlyingRaw: '0' }])).toBeNull()
    expect(() => moveFlows(USER, FIXTURE_MOVE, built(2), null)).toThrow(REFUSED.plan)
    const signAll = vi.fn()
    await expect(moveAtTap({ user: USER, proposal: FIXTURE_MOVE, positions: [], build: async () => built(2), signAll, confirm: vi.fn() })).rejects.toThrow(REFUSED.plan)
    expect(signAll).not.toHaveBeenCalled()
  })
  it("after signing, a confirm with no answer from the route says sent, not \"Nothing moved\"", async () => {
    const signAll = () => async (txs: string[]) => txs
    const go = (confirm: () => Promise<unknown>) => moveAtTap({ user: USER, proposal: FIXTURE_MOVE, positions: FIXTURE_POSITIONS, build: async () => built(2), signAll, confirm })
    await expect(go(async () => { throw new TypeError('Network request failed') })).rejects.toThrow(MOVE_SENT)
    await expect(go(async () => { throw Object.assign(new Error('Request failed (504).'), { status: 504 }) })).rejects.toBeInstanceOf(MoveSent)
    const partial = Object.assign(new Error('Your USDC is back in your wallet; the move did not finish.'), { status: 409 })
    await expect(go(async () => { throw partial })).rejects.toBe(partial)
    expect(MOVE_SENT).not.toMatch(/Nothing moved/)
  })
})
