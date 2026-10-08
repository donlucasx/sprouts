import { describe, expect, it } from 'vitest'
import { weekLine } from '../../src/lib/week'

const now = new Date('2026-10-08T20:00:00Z')
const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * 24 * 3600 * 1000).toISOString()

describe('weekLine', () => {
  it('is null before the activity read lands', () => {
    expect(weekLine(undefined, now)).toBeNull()
  })
  it('counts only swaps with change inside the last 7 days', () => {
    const swaps = [
      { ts: at(1), roundupCents: 100 },
      { ts: at(3), roundupCents: 50 },
      { ts: at(6.9), roundupCents: 4 },
      { ts: at(7.1), roundupCents: 99 },
      { ts: at(2), roundupCents: 0 },
    ]
    expect(weekLine(swaps, now)).toBe('This week: 3 swaps, $1.54 of change.')
  })
  it('says swap for one', () => {
    expect(weekLine([{ ts: at(0.5), roundupCents: 35 }], now)).toBe('This week: 1 swap, $0.35 of change.')
  })
  it('names the quiet week', () => {
    expect(weekLine([{ ts: at(9), roundupCents: 35 }], now)).toBe('No round-ups yet this week.')
  })
})
