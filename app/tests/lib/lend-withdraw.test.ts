import { describe, it, expect, vi } from 'vitest'
import type { Transaction } from '@solana/kit'
import {
  withdrawLendAtTap, prepareLendWithdraw, lendWithdrawFlow, lendAmountProblem, lendRequest, lendMaxText, parseCoinAmount, lendScreenLines,
  POOL_FULL_LINE, POSITION_CHANGED, AMOUNT_CHANGED_LEND, PARTIAL_NOT_YET, WITHDRAWN_LEND_LINE, WITHDRAWN_PART_LINE, type LendWithdrawBuild,
} from '@/lib/lend-withdraw'
import { makeSigner, SignRefused } from '@/lib/sign'
import { withdrawRows } from '@/lib/withdraw-list'
import { FIXTURE_LEND_HOLDINGS, FIXTURE_POSITIONS } from '@/lib/lend-fixtures'
import { USER, wire } from '../fixtures/api-built'
import { klendWithdrawIxs } from '../fixtures/lend-built'
import type { MeResponse } from '@/lib/api'

const kamino = FIXTURE_POSITIONS[0]   // USDC on Kamino, receiptRaw 1661200, underlyingRaw 1999752
const full = FIXTURE_POSITIONS[1]     // USDC on Jupiter, pool full
const wallet = () => vi.fn(async (tx: Transaction) => tx)
const ALL = {}
const b = (over: Partial<LendWithdrawBuild>): LendWithdrawBuild => ({ transaction: 'x', receiptRaw: '1661200', expectedOutRaw: '1999752', all: true, brief: 'About 2.00 USDC comes back.', ...over })

describe('the amount on the lending withdraw screen (R359, the same control as SKR)', () => {
  it('parses typed amounts in the coin, dropping digits past its decimals', () => {
    expect(parseCoinAmount('1.5', 6)).toBe(1_500_000n)
    expect(parseCoinAmount('1,5', 9)).toBe(1_500_000_000n)
    expect(parseCoinAmount('0.1234567', 6)).toBe(123_456n)
    expect(parseCoinAmount('abc', 6)).toBeNull()
    expect(parseCoinAmount('', 6)).toBeNull()
  })
  it('says why Continue is off: not a number, under the smallest, more than the position', () => {
    expect(lendAmountProblem('', kamino)).toBe('Enter an amount in USDC.')
    expect(lendAmountProblem('0.001', kamino)).toBe('The smallest withdrawal is 0.01 USDC.')
    expect(lendAmountProblem('2.01', kamino)).toBe('That is more than this position holds.')
    expect(lendAmountProblem('1', kamino)).toBeNull()
    expect(lendAmountProblem('0.00001', FIXTURE_POSITIONS[2])).toBe('The smallest withdrawal is 0.0001 SOL.')
  })
  it('Max fills the whole position; All sends no amount; an amount sends raw units', () => {
    expect(lendMaxText(kamino)).toBe('1.999752')
    expect(lendRequest('all', '', kamino)).toEqual({})
    expect(lendRequest('amount', '1.25', kamino)).toEqual({ amountRaw: '1250000' })
    expect(lendRequest('amount', '9', kamino)).toBeNull()
  })
  it('the screen shows the value, the venue line and the honest notes', () => {
    const l = lendScreenLines(kamino)
    expect(l.title).toBe('Withdraw USDC from Kamino')
    expect(l.value).toBe('2.00 USDC ($2.00)')
    expect(l.venue).toBe('From Kamino back to your Seeker wallet as USDC.')
    expect(l.notes).toContain(POOL_FULL_LINE)
    expect(l.notes).toContain('What stays keeps earning.')
    expect(lendScreenLines(full).poolFull).toBe(true)
  })
})

describe('prepareLendWithdraw and withdrawLendAtTap (R359: plan first, then sign the fresh build at the tap)', () => {
  it('All on a full pool stops before anything is built, with the spec sentence', async () => {
    const build = vi.fn()
    expect(await prepareLendWithdraw({ position: full, request: ALL, build })).toEqual({ stopped: POOL_FULL_LINE })
    expect(build).not.toHaveBeenCalled()
    expect(POOL_FULL_LINE).toBe('A venue can pause withdrawals when its pool is fully lent out; your money stays yours.')
  })
  it('an amount on a full pool is asked of the venue (a smaller amount may still come out)', async () => {
    const build = vi.fn(async () => b({ receiptRaw: '470000', all: false }))
    expect(await prepareLendWithdraw({ position: full, request: { amountRaw: '500000' }, build })).toMatchObject({ plan: { receiptRaw: '470000' } })
    expect(build).toHaveBeenCalledWith({ asset: 'USDC_LEND', venue: 'jupiter_lend', amountRaw: '500000' })
  })
  it('All: builds at the tap, signs the whole position through the pinned check, confirms with the asset and venue', async () => {
    const tx = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661200n }))
    const sign = wallet()
    const confirm = vi.fn(async () => ({}))
    const out = await withdrawLendAtTap({ user: USER, position: kamino, request: ALL, shown: b({ transaction: tx }), build: async () => b({ transaction: tx }), sign: (flow) => makeSigner(sign, flow), confirm })
    expect(out).toEqual({ done: true, line: WITHDRAWN_LEND_LINE })
    expect(sign).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith({ asset: 'USDC_LEND', venue: 'kamino_klend', signedTransaction: tx })
  })
  it('a part: signs only the receipt the fresh build redeems, sends the amount, says the rest keeps earning', async () => {
    // 1.00 of 1.999752 USDC: receipt 1661200 x 1000000 / 1999752 = 830_703 at the screen's rate
    const tx = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 830_600n }))
    const sign = wallet()
    const confirm = vi.fn(async () => ({}))
    const part = b({ transaction: tx, receiptRaw: '830600', expectedOutRaw: '1000000', all: false })
    const out = await withdrawLendAtTap({ user: USER, position: kamino, request: { amountRaw: '1000000' }, shown: part, build: async () => part, sign: (flow) => makeSigner(sign, flow), confirm })
    expect(out).toEqual({ done: true, line: WITHDRAWN_PART_LINE })
    expect(confirm).toHaveBeenCalledWith({ asset: 'USDC_LEND', venue: 'kamino_klend', amountRaw: '1000000', signedTransaction: tx })
  })
  it('a part whose receipt is more than the amount asked for (beyond the 1% rate margin) is not signed', async () => {
    const sign = vi.fn()
    const greedy = b({ receiptRaw: '850000', all: false })
    expect(await prepareLendWithdraw({ position: kamino, request: { amountRaw: '1000000' }, build: async () => greedy })).toEqual({ stopped: POSITION_CHANGED })
    expect(await withdrawLendAtTap({ user: USER, position: kamino, request: { amountRaw: '1000000' }, shown: greedy, build: async () => greedy, sign, confirm: vi.fn() })).toEqual({ stopped: POSITION_CHANGED })
    expect(sign).not.toHaveBeenCalled()
  })
  it('an API without partial withdrawals (no `all` in its answer) never turns an amount into the whole position', async () => {
    const old = { transaction: 'x', receiptRaw: '1661200', expectedOutRaw: '1999752', brief: '' }
    expect(await prepareLendWithdraw({ position: kamino, request: { amountRaw: '1000000' }, build: async () => old })).toEqual({ stopped: PARTIAL_NOT_YET })
    // ...while All on that API still works as before
    expect(await prepareLendWithdraw({ position: kamino, request: ALL, build: async () => old })).toMatchObject({ plan: { receiptRaw: '1661200' } })
  })
  it('review I2: an amount answered with the whole position is refused unless the rest really is under the smallest withdrawal', async () => {
    // 1.999752 shown; asking 1.00 leaves 0.99: an `all` answer is not a dust take
    expect(await prepareLendWithdraw({ position: kamino, request: { amountRaw: '1000000' }, build: async () => b({ all: true }) })).toEqual({ stopped: POSITION_CHANGED })
  })
  it('review I3: Max sends All (the screen rate lags the venue, so the shown value as an amount would leave a rest)', () => {
    expect(lendRequest('amount', lendMaxText(kamino), kamino)).toEqual({})
  })
  it('the rest too small to leave: the API answers all, the plan shows it; signing then needs the whole receipt', async () => {
    const dust = b({ all: true, brief: 'About 2.00 USDC comes back. The rest is too small to leave, so this takes it all.' })
    expect(await prepareLendWithdraw({ position: kamino, request: { amountRaw: '1995000' }, build: async () => dust })).toEqual({ plan: dust })
  })
  it('the fresh build at the tap differs from the plan shown (all vs part, or a larger receipt): re-plans, signs nothing', async () => {
    const sign = vi.fn()
    const shown = b({ receiptRaw: '830600', all: false })
    // 1.995 of 1.999752: shown as a part, the fresh build takes it all (the rest became dust): ask again
    let out = await withdrawLendAtTap({ user: USER, position: kamino, request: { amountRaw: '1995000' }, shown: b({ receiptRaw: '1657000', all: false }), build: async () => b({ all: true }), sign, confirm: vi.fn() })
    expect(out).toMatchObject({ replanned: { all: true }, message: AMOUNT_CHANGED_LEND })
    out = await withdrawLendAtTap({ user: USER, position: kamino, request: { amountRaw: '1000000' }, shown, build: async () => b({ receiptRaw: '830700', all: false }), sign, confirm: vi.fn() })
    expect(out).toMatchObject({ message: AMOUNT_CHANGED_LEND })
    expect(sign).not.toHaveBeenCalled()
  })
  it('a fresh receipt a little smaller (the rate rose since the plan) is fine', async () => {
    const tx = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 830_590n }))
    const sign = wallet()
    const out = await withdrawLendAtTap({ user: USER, position: kamino, request: { amountRaw: '1000000' }, shown: b({ receiptRaw: '830600', all: false }), build: async () => b({ transaction: tx, receiptRaw: '830590', all: false }), sign: (f) => makeSigner(sign, f), confirm: vi.fn(async () => ({})) })
    expect(out).toEqual({ done: true, line: WITHDRAWN_PART_LINE })
  })
  it('All: a build for another receipt than the screen shows is not signed', async () => {
    const sign = vi.fn()
    expect(await withdrawLendAtTap({ user: USER, position: kamino, request: ALL, shown: b({}), build: async () => b({ receiptRaw: '1661300' }), sign, confirm: vi.fn() })).toEqual({ stopped: POSITION_CHANGED })
    expect(sign).not.toHaveBeenCalled()
  })
  it('a transaction redeeming more than the build says is refused by the pinned check; nothing is confirmed', async () => {
    const tx = wire(await klendWithdrawIxs({ asset: 'USDC_LEND', amount: 1661201n }))
    const sign = wallet()
    const confirm = vi.fn()
    await expect(withdrawLendAtTap({ user: USER, position: kamino, request: ALL, shown: b({}), build: async () => b({ transaction: tx }), sign: (flow) => makeSigner(sign, flow), confirm })).rejects.toThrow(SignRefused)
    expect(sign).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
  it("the API's own refusal (a pool that filled since the read) reaches the screen as its sentence", async () => {
    const err = new Error('A venue can pause withdrawals when its pool is fully lent out; your money stays yours.')
    await expect(withdrawLendAtTap({ user: USER, position: kamino, request: ALL, shown: b({}), build: async () => { throw err }, sign: vi.fn(), confirm: vi.fn() })).rejects.toBe(err)
  })
  it('the venue picks the flow; the amount is the receipt the build redeems', () => {
    expect(lendWithdrawFlow(USER, kamino)).toEqual({ kind: 'withdraw_klend', user: USER, asset: 'USDC_LEND', receiptRaw: '1661200' })
    expect(lendWithdrawFlow(USER, { ...FIXTURE_POSITIONS[2], receiptRaw: '100' })).toEqual({ kind: 'withdraw_jlend', user: USER, asset: 'SOL_LEND', receiptRaw: '100' })
  })
})

describe('withdrawRows with lending positions (R359: one pattern, a row with a > that opens its own screen)', () => {
  it('one row per position after SKR, each opening its own screen; a full pool says so; no aggregated lending row', () => {
    const rows = withdrawRows({ pot: { skrStakedRaw: '34900000', skrUsd: 0.0183 } as MeResponse['pot'], basket: null, holdings: FIXTURE_LEND_HOLDINGS, positions: FIXTURE_POSITIONS })
    expect(rows.map((r) => r.key)).toEqual(['SKR', 'USDC_LEND:kamino_klend', 'USDC_LEND:jupiter_lend', 'SOL_LEND:jupiter_lend'])
    expect(rows[1]).toMatchObject({ label: 'Withdraw USDC from Kamino', amount: '2.00 USDC ($2.00)', note: 'Back to your Seeker wallet as USDC.', opens: true })
    expect(rows.filter((r) => r.position).every((r) => r.opens)).toBe(true)
    expect(rows[0].opens).toBe(true)
    expect(rows[2].note).toBe(POOL_FULL_LINE)
    expect(rows[3].label).toBe('Withdraw SOL from Jupiter')
    expect(rows[3].position?.receiptRaw).toBe('9408000')
  })
})
