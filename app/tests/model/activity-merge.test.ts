import { describe, expect, it } from 'vitest'
import { filterRows, mergeRows, type ActivityRow } from '@/model/activity'

const row = (key: string, ts: string): ActivityRow => ({ key, ts, label: key, amount: null, details: [], signature: null })

describe('Activity as one list (R450)', () => {
  const merged = mergeRows({
    plant: [{ row: row('p1', '2026-10-07T15:45:00Z') }],
    swap: [{ row: row('s1', '2026-10-07T15:44:00Z') }, { row: row('s2', '2026-10-08T01:00:00Z') }],
    withdraw: [{ row: row('w1', '2026-10-06T21:55:00Z'), walletAccount: true }],
    split: [{ row: row('a1', '2026-10-07T14:12:00Z') }],
  })
  it('puts every kind in one list, newest first', () => {
    expect(merged.map((r) => r.row.key)).toEqual(['s2', 'p1', 's1', 'a1', 'w1'])
    expect(merged.find((r) => r.row.key === 'w1')).toMatchObject({ kind: 'withdraw', walletAccount: true })
  })
  it('filters by kind; All keeps everything', () => {
    expect(filterRows(merged, 'all')).toHaveLength(5)
    expect(filterRows(merged, 'swap').map((r) => r.row.key)).toEqual(['s2', 's1'])
    expect(filterRows(merged, 'split').map((r) => r.kind)).toEqual(['split'])
  })
})
