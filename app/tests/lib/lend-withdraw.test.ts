import { describe, it, expect, vi } from 'vitest'
import type { Transaction } from '@solana/kit'
import { withdrawLendAtTap, lendWithdrawFlow, POOL_FULL_LINE, POSITION_CHANGED } from '@/lib/lend-withdraw'
import { makeSigner, SignRefused } from '@/lib/sign'
import { withdrawRows } from '@/lib/withdraw-list'
import { FIXTURE_LEND_HOLDINGS, FIXTURE_POSITIONS } from '@/lib/lend-fixtures'
import { USER, wire } from '../fixtures/api-built'
import { klendWithdrawIxs } from '../fixtures/lend-built'
import type { MeResponse } from '@/lib/api'

const kamino = FIXTURE_POSITIONS[0]   // USDC on Kamino, receiptRaw 1661200
const full = FIXTURE_POSITIONS[1]     // USDC on Jupiter, pool full
const wallet = () => vi.fn(async (tx: Transaction) => tx)

describe('withdrawLendAtTap (spec 7, R264: one tap per position)', () => {
  it('a full pool stops before anything is built, with the spec sentence', async () => {
    const build = vi.fn()
    expect(await withdrawLendAtTap({ user: USER, position: full, build, sign: vi.fn(), confirm: vi.fn() })).toEqual({ stopped: POOL_FULL_LINE })
    expect(build).not.toHaveBeenCalled()
    expect(POOL_FULL_LINE).toBe('A venue can pause withdrawals when its pool is fully lent out; your money stays yours.')
  })
  it('builds at the tap, signs the position on screen through the pinned check, confirms with the asset and venue', async () => {
    const tx = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n }))
    const sign = wallet()
    const confirm = vi.fn(async () => ({}))
    const out = await withdrawLendAtTap({ user: USER, position: kamino, build: async () => ({ transaction: tx, receiptRaw: '1661200', expectedOutRaw: '1999752', brief: '' }), sign: (flow) => makeSigner(sign, flow), confirm })
    expect(out).toEqual({ done: true })
    expect(sign).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith({ asset: 'USDC_LEND', venue: 'kamino_klend', signedTransaction: tx })
  })
  it('a build for another amount than the screen shows is not signed', async () => {
    const sign = vi.fn()
    expect(await withdrawLendAtTap({ user: USER, position: kamino, build: async () => ({ transaction: 'x', receiptRaw: '1661300', expectedOutRaw: '0', brief: '' }), sign, confirm: vi.fn() })).toEqual({ stopped: POSITION_CHANGED })
    expect(sign).not.toHaveBeenCalled()
  })
  it('a transaction redeeming more than the position is refused by the pinned check; nothing is confirmed', async () => {
    const tx = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661201n }))
    const sign = wallet()
    const confirm = vi.fn()
    await expect(withdrawLendAtTap({ user: USER, position: kamino, build: async () => ({ transaction: tx, receiptRaw: '1661200', expectedOutRaw: '0', brief: '' }), sign: (flow) => makeSigner(sign, flow), confirm })).rejects.toThrow(SignRefused)
    expect(sign).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
  it("the API's own refusal (a pool that filled since the read) reaches the screen as its sentence", async () => {
    const err = new Error('A venue can pause withdrawals when its pool is fully lent out; your money stays yours.')
    await expect(withdrawLendAtTap({ user: USER, position: kamino, build: async () => { throw err }, sign: vi.fn(), confirm: vi.fn() })).rejects.toBe(err)
  })
  it('the venue picks the flow; the amount is the one on screen', () => {
    expect(lendWithdrawFlow(USER, kamino)).toEqual({ kind: 'withdraw_klend', user: USER, asset: 'USDC_LEND', receiptRaw: '1661200' })
    expect(lendWithdrawFlow(USER, FIXTURE_POSITIONS[2])).toEqual({ kind: 'withdraw_jlend', user: USER, asset: 'SOL_LEND', receiptRaw: '9408000' })
  })
})

describe('withdrawRows with lending positions', () => {
  it('one row per position after SKR, each with its own Withdraw; a full pool says so; no aggregated lending row', () => {
    const rows = withdrawRows({ pot: { skrStakedRaw: '34900000', skrUsd: 0.0183 } as MeResponse['pot'], basket: null, holdings: FIXTURE_LEND_HOLDINGS, positions: FIXTURE_POSITIONS })
    expect(rows.map((r) => r.key)).toEqual(['SKR', 'USDC_LEND:kamino_klend', 'USDC_LEND:jupiter_lend', 'SOL_LEND:jupiter_lend'])
    expect(rows[1]).toMatchObject({ label: 'Withdraw USDC from Kamino', amount: '2.00 USDC ($2.00)', note: 'Back to your Seeker wallet as USDC.', opens: false })
    expect(rows[2].note).toBe(POOL_FULL_LINE)
    expect(rows[3].label).toBe('Withdraw SOL from Jupiter')
    expect(rows[3].position?.receiptRaw).toBe('9408000')
  })
})
