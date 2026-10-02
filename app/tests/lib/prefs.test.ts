import { describe, it, expect, vi, beforeEach } from 'vitest'

const mem = new Map<string, string | boolean>()
vi.mock('@/lib/me', () => ({
  store: {
    getString: (k: string) => (typeof mem.get(k) === 'string' ? mem.get(k) : undefined),
    getBoolean: (k: string) => (typeof mem.get(k) === 'boolean' ? mem.get(k) : undefined),
    set: (k: string, v: string | boolean) => void mem.set(k, v),
  },
}))
import { readAppearance, writeAppearance, readNotify, writeNotify } from '@/lib/prefs'

describe('prefs (R153)', () => {
  beforeEach(() => mem.clear())
  it('appearance defaults to system and round-trips', () => {
    expect(readAppearance()).toBe('system')
    writeAppearance('dark')
    expect(readAppearance()).toBe('dark')
  })
  it('every notice defaults to on and round-trips on its own (R161)', () => {
    for (const k of ['plantings', 'withdrawals', 'manager', 'limit'] as const) expect(readNotify(k)).toBe(true)
    writeNotify('manager', false)
    expect(readNotify('manager')).toBe(false)
    expect(readNotify('limit')).toBe(true)
  })
  it('the planting switch keeps the key R153 shipped, so an earlier off stays off', () => {
    mem.set('prefs.notifyPlantings', false)
    expect(readNotify('plantings')).toBe(false)
  })
})
