import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ notify: vi.fn(), refreshWidget: vi.fn(), record: vi.fn() }))
vi.mock('expo-background-task', () => ({ BackgroundTaskResult: { Success: 1, Failed: 2 }, registerTaskAsync: vi.fn(), unregisterTaskAsync: vi.fn() }))
vi.mock('expo-task-manager', () => ({ defineTask: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: vi.fn(async (p: string) => (p === '/api/me/usdc' ? { usdcRaw: null } : {})) }))
vi.mock('@/lib/me', () => ({ readLastMe: () => null, writeLastMe: vi.fn() }))
vi.mock('@/lib/notify', () => ({ notify: m.notify }))
vi.mock('@/lib/widget-refresh', () => ({ refreshWidget: m.refreshWidget }))
vi.mock('@/lib/me-state', () => ({
  normalizeMe: (x: unknown) => ({ ...(x as object), wallets: [], user: { pubkey: 'p' }, reminder: { id: 'r1', kind: 'idle', title: 't', body: 'b', route: '/home' } }),
}))
vi.mock('@/lib/usdc-watch', () => ({ readLastAvg: () => null, readWasLow: () => false, writeWasLow: vi.fn() }))
vi.mock('@/lib/prefs', () => ({ readNotify: () => true }))
vi.mock('@/lib/coalesce', () => ({ coalesce: (f: unknown) => f }))
vi.mock('@/lib/reminders', () => ({
  reminderToShow: (r: unknown) => r, readReminderState: () => ({ shownIds: [], lastShownDay: null }), recordReminderShown: m.record,
}))
import { runRefresh } from '@/lib/background'

describe('runRefresh', () => {
  beforeEach(() => vi.clearAllMocks())
  it('a rejected reminder notify still refreshes the widget and succeeds', async () => {
    m.notify.mockRejectedValue(new Error('no'))
    expect(await runRefresh()).toBe(1)
    expect(m.refreshWidget).toHaveBeenCalledTimes(1)
    expect(m.record).not.toHaveBeenCalled()
  })
  it('a shown reminder is recorded', async () => {
    m.notify.mockResolvedValue(undefined)
    expect(await runRefresh()).toBe(1)
    expect(m.record).toHaveBeenCalledWith('r1', expect.any(Date))
  })
})
