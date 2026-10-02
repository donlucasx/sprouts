import { describe, it, expect, vi } from 'vitest'
import { withdrawAtTap, type WithdrawPlan } from '@/lib/withdraw-flow'

const plan = (transaction: string, prunes = false): WithdrawPlan => ({ transaction, shares: '1', amountRaw: '1000000', prunes, brief: [] })

describe('withdrawAtTap (round 3, item 7: build at the tap)', () => {
  it('builds again at the tap and signs THAT transaction, never the one built when the amount was picked', async () => {
    const calls: string[] = []
    const build = vi.fn(async () => { calls.push('build'); return plan('fresh') })
    const sign = vi.fn(async (tx: string) => { calls.push(`sign ${tx}`); return `signed ${tx}` })
    const confirm = vi.fn(async (s: string) => { calls.push(`confirm ${s}`) })
    expect(await withdrawAtTap({ request: { mode: 'earned' }, shown: plan('stale'), build, sign, confirm })).toEqual({ done: true })
    expect(calls).toEqual(['build', 'sign fresh', 'confirm signed fresh'])
    expect(build).toHaveBeenCalledWith({ mode: 'earned' })
  })
  it('signs nothing when the fresh plan prunes and the shown one did not; it hands back the fresh plan', async () => {
    const sign = vi.fn(async (tx: string) => tx), confirm = vi.fn(async () => {})
    const fresh = plan('fresh', true)
    expect(await withdrawAtTap({ request: { mode: 'amount', amountRaw: '5' }, shown: plan('stale'), build: async () => fresh, sign, confirm })).toEqual({ replanned: fresh })
    expect(sign).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
  it('a wallet cancel stops before the confirm and reaches the caller (which says nothing moved)', async () => {
    const confirm = vi.fn(async () => {})
    await expect(withdrawAtTap({ request: { mode: 'earned' }, shown: plan('stale'), build: async () => plan('fresh'), sign: async () => { throw new Error('declined') }, confirm })).rejects.toThrow('declined')
    expect(confirm).not.toHaveBeenCalled()
  })
})
