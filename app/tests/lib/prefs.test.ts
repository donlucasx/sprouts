import { describe, it, expect, vi, beforeEach } from 'vitest'

const mem = new Map<string, string | boolean>()
vi.mock('@/lib/me', () => ({
  store: {
    getString: (k: string) => (typeof mem.get(k) === 'string' ? mem.get(k) : undefined),
    getBoolean: (k: string) => (typeof mem.get(k) === 'boolean' ? mem.get(k) : undefined),
    set: (k: string, v: string | boolean) => void mem.set(k, v),
  },
}))
import { readAppearance, writeAppearance, readNotifyPlantings, writeNotifyPlantings } from '@/lib/prefs'

describe('prefs (R153)', () => {
  beforeEach(() => mem.clear())
  it('appearance defaults to system and round-trips', () => {
    expect(readAppearance()).toBe('system')
    writeAppearance('dark')
    expect(readAppearance()).toBe('dark')
  })
  it('planting notifications default to on and round-trip', () => {
    expect(readNotifyPlantings()).toBe(true)
    writeNotifyPlantings(false)
    expect(readNotifyPlantings()).toBe(false)
  })
})
