import { describe, it, expect, vi } from 'vitest'
import { withdrawAtTap, oneAtATime, REPLANNED, AMOUNT_CHANGED, type WithdrawPlan } from '@/lib/withdraw-flow'

const plan = (transaction: string, prunes = false, amountRaw = '1000000', shares = '1'): WithdrawPlan => ({ transaction, shares, amountRaw, prunes, brief: [] })

describe('withdrawAtTap (round 3, item 7: build at the tap)', () => {
  it('builds again at the tap and signs THAT transaction, with a signer made for THAT plan', async () => {
    const calls: string[] = []
    const fresh = plan('fresh', false, '1000000', '7')
    const build = vi.fn(async () => { calls.push('build'); return fresh })
    const sign = vi.fn((p: WithdrawPlan) => async (tx: string) => { calls.push(`sign ${tx} shares ${p.shares}`); return `signed ${tx}` })
    const confirm = vi.fn(async (s: string) => { calls.push(`confirm ${s}`) })
    expect(await withdrawAtTap({ request: { mode: 'earned' }, shown: plan('stale'), build, sign, confirm })).toEqual({ done: true })
    expect(calls).toEqual(['build', 'sign fresh shares 7', 'confirm signed fresh'])
    expect(build).toHaveBeenCalledWith({ mode: 'earned' })
    expect(sign).toHaveBeenCalledWith(fresh)
  })
  it('signs nothing when the fresh plan prunes and the shown one did not; it hands back the fresh plan', async () => {
    const sign = vi.fn(() => async (tx: string) => tx), confirm = vi.fn(async () => {})
    const fresh = plan('fresh', true)
    expect(await withdrawAtTap({ request: { mode: 'amount', amountRaw: '5' }, shown: plan('stale'), build: async () => fresh, sign, confirm })).toEqual({ replanned: fresh, message: REPLANNED })
    expect(sign).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(REPLANNED).toBe('Your garden changed since you opened this. Check the amount and tap Withdraw again.')
  })
  it('security R207 #10: signs nothing when the fresh amount differs from the one on screen, even by one raw unit', async () => {
    for (const amountRaw of ['1000001', '999999', '2000000']) {
      const sign = vi.fn(() => async (tx: string) => tx), confirm = vi.fn(async () => {})
      const fresh = plan('fresh', false, amountRaw)
      expect(await withdrawAtTap({ request: { mode: 'earned' }, shown: plan('stale'), build: async () => fresh, sign, confirm })).toEqual({ replanned: fresh, message: AMOUNT_CHANGED })
      expect(sign).not.toHaveBeenCalled()
      expect(confirm).not.toHaveBeenCalled()
    }
    expect(AMOUNT_CHANGED).toBe('The amount changed. Review it and tap Withdraw again.')
  })
  it('a wallet cancel stops before the confirm and reaches the caller (which says nothing moved)', async () => {
    const confirm = vi.fn(async () => {})
    await expect(withdrawAtTap({ request: { mode: 'earned' }, shown: plan('stale'), build: async () => plan('fresh'), sign: () => async () => { throw new Error('declined') }, confirm })).rejects.toThrow('declined')
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('oneAtATime (T8 review Minor 2: two presses in one frame start one withdraw)', () => {
  it('lets the first caller in and turns the second away until the first leaves', () => {
    const gate = oneAtATime()
    expect(gate.enter()).toBe(true)
    expect(gate.enter()).toBe(false)
    gate.leave()
    expect(gate.enter()).toBe(true)
  })
  it('two taps started before either awaits run the action once', async () => {
    const gate = oneAtATime()
    const action = vi.fn(async () => {})
    const tap = async () => {
      if (!gate.enter()) return
      try {
        await action()
      } finally {
        gate.leave()
      }
    }
    await Promise.all([tap(), tap()])
    expect(action).toHaveBeenCalledTimes(1)
    await tap()
    expect(action).toHaveBeenCalledTimes(2)
  })
})
