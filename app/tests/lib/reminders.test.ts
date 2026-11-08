import { describe, it, expect, vi, beforeEach } from 'vitest'

const mem = new Map<string, string>()
vi.mock('@/lib/store', () => ({
  store: { getString: (k: string) => mem.get(k), set: (k: string, v: string) => void mem.set(k, v) },
}))
import { reminderToShow, localDay, readReminderState, recordReminderShown, routeForNotification, QUIET_START_HOUR, QUIET_END_HOUR } from '@/lib/reminders'

const R = { id: 'link_new:1', kind: 'link_new', title: 'Your garden is ready to plant', body: 'x', route: '/connect' } as const
const at = (h: number, m = 0) => new Date(2026, 10, 8, h, m) // local hours
const base = { shownIds: [] as string[], lastShownDay: null as string | null, on: true }

describe('reminderToShow', () => {
  it('quiet hours are 8 PM to 9 AM', () => {
    expect([QUIET_START_HOUR, QUIET_END_HOUR]).toEqual([20, 9])
  })
  it('shows a new id at 10:00 local', () => {
    expect(reminderToShow(R, { ...base, now: at(10) })).toEqual(R)
  })
  it('shows at 09:00 and 19:59, not at 08:59 or 20:00', () => {
    expect(reminderToShow(R, { ...base, now: at(9) })).toEqual(R)
    expect(reminderToShow(R, { ...base, now: at(19, 59) })).toEqual(R)
    expect(reminderToShow(R, { ...base, now: at(8, 59) })).toBeNull()
    expect(reminderToShow(R, { ...base, now: at(20) })).toBeNull()
    expect(reminderToShow(R, { ...base, now: at(23) })).toBeNull()
  })
  it('nothing when one was shown today', () => {
    const now = at(10)
    expect(reminderToShow(R, { ...base, now, lastShownDay: localDay(now) })).toBeNull()
    expect(reminderToShow(R, { ...base, now, lastShownDay: '2026-11-07' })).toEqual(R)
  })
  it('nothing for a shown id, a switched-off phone, or an old API', () => {
    expect(reminderToShow(R, { ...base, now: at(10), shownIds: [R.id] })).toBeNull()
    expect(reminderToShow(R, { ...base, now: at(10), on: false })).toBeNull()
    expect(reminderToShow(undefined, { ...base, now: at(10) })).toBeNull()
    expect(reminderToShow(null, { ...base, now: at(10) })).toBeNull()
  })
})

describe('localDay', () => {
  it('is YYYY-MM-DD in the phone zone', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('reminder state', () => {
  beforeEach(() => mem.clear())
  it('starts empty and records the id and the day', () => {
    expect(readReminderState()).toEqual({ shownIds: [], lastShownDay: null })
    const now = at(10)
    recordReminderShown('a', now)
    expect(readReminderState()).toEqual({ shownIds: ['a'], lastShownDay: localDay(now) })
  })
  it('keeps the last 50 ids', () => {
    for (let i = 0; i < 55; i++) recordReminderShown(`id${i}`, at(10))
    const s = readReminderState()
    expect(s.shownIds).toHaveLength(50)
    expect(s.shownIds[0]).toBe('id5')
    expect(s.shownIds[49]).toBe('id54')
  })
  it('survives a corrupt store value', () => {
    mem.set('reminders.shownIds', '{nope')
    expect(readReminderState().shownIds).toEqual([])
  })
})

describe('routeForNotification', () => {
  it('only /connect and /home', () => {
    expect(routeForNotification({ route: '/connect' })).toBe('/connect')
    expect(routeForNotification({ route: '/home' })).toBe('/home')
    expect(routeForNotification({ route: 'javascript:x' })).toBeNull()
    expect(routeForNotification({ route: '/settings' })).toBeNull()
    expect(routeForNotification(null)).toBeNull()
    expect(routeForNotification('/connect')).toBeNull()
    expect(routeForNotification({})).toBeNull()
  })
})
