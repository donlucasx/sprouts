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

// 10-27 (his rulings: top-ups show in Activity, never as a swap; copy "Added $5.00 of USDC" / "From SOL in this wallet. No Sprouts fee.")
describe('a top-up row', () => {
  it('says the USDC it added, the note, its transaction, and the tag "Top up"', async () => {
    const { topUpRow, KIND_TAG } = await import('@/model/activity')
    expect(topUpRow({ ts: '2026-10-27T20:00:00Z', signature: 'sig', usdcRaw: '5000000' })).toEqual({
      key: 'tu-sig', ts: '2026-10-27T20:00:00Z', label: 'Added $5.00 of USDC', amount: null, details: ['From SOL in this wallet. No Sprouts fee.'], signature: 'sig',
    })
    expect(topUpRow({ ts: '2026-10-27T20:00:00Z', signature: 's', usdcRaw: '25000000' }).label).toBe('Added $25.00 of USDC')
    expect(KIND_TAG.topup).toBe('Top up')
  })

  it('sorts among the other rows by time and shows only under All', () => {
    const merged = mergeRows({ swap: [{ row: row('s1', '2026-10-27T19:00:00Z') }], topup: [{ row: row('t1', '2026-10-27T20:00:00Z') }] })
    expect(merged.map((r) => [r.kind, r.row.key])).toEqual([['topup', 't1'], ['swap', 's1']])
    expect(filterRows(merged, 'swap').map((r) => r.row.key)).toEqual(['s1'])
  })
})

describe('10-28: which wallet a row came from, only with 2+ wallets linked', () => {
  const phone = 'PHONEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaZZ'
  const other = 'FdPpbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbYjB6'
  const swap = { signature: 'sw', ts: '2026-10-28T10:00:00Z', usdSizeCents: 1050, roundupCents: 50, plantingId: null }
  it('one linked wallet (or one live, one revoked): no name, rows read as before', async () => {
    const { walletNamer, swapRow, topUpRow, TOPUP_NOTE } = await import('@/model/activity')
    expect(walletNamer([{ pubkey: phone, status: 'active' }, { pubkey: other, status: 'revoked' }], phone)).toBeNull()
    expect(swapRow({ ...swap, walletPubkey: other }, null).details).toEqual(['Change $0.50, waiting to be planted.'])
    expect(topUpRow({ ts: swap.ts, signature: 't', usdcRaw: '5000000' }, false).details).toEqual([TOPUP_NOTE])
  })
  it('two linked wallets: swaps name their wallet, top-ups name the Seed Vault wallet', async () => {
    const { walletNamer, swapRow, topUpRow } = await import('@/model/activity')
    const name = walletNamer([{ pubkey: phone, status: 'active' }, { pubkey: other, status: 'paused' }], phone)
    expect(swapRow({ ...swap, walletPubkey: other }, name).details).toEqual(['Change $0.50, waiting to be planted.', 'In FdPp...YjB6.'])
    expect(swapRow({ ...swap, walletPubkey: phone }, name).details).toEqual(['Change $0.50, waiting to be planted.', 'In your Seed Vault wallet.'])
    expect(swapRow({ ...swap, roundupCents: 0, walletPubkey: other }, name).details).toEqual(['No spare change on a whole-dollar swap.', 'In FdPp...YjB6.'])
    expect(topUpRow({ ts: swap.ts, signature: 't', usdcRaw: '5000000' }, true).details).toEqual(['From SOL in your Seed Vault wallet. No Sprouts fee.'])
  })
})

describe('10-28: wallet links and revokes in Activity', () => {
  const phone = 'PHONEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaZZ'
  const other = 'FdPpbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbYjB6'
  const ts = '2026-10-28T10:00:00Z'
  it('names the wallet and says why a revoke happened', async () => {
    const { walletRow, WALLET_LINE } = await import('@/model/activity')
    expect(walletRow({ ts, kind: 'linked', wallet: other, why: null, signature: null }, phone)).toMatchObject({ label: 'Linked FdPp...YjB6', details: [WALLET_LINE.linked], signature: null })
    expect(walletRow({ ts, kind: 'revoked', wallet: other, why: 'user', signature: 'sig' }, phone)).toMatchObject({ label: 'Unlinked FdPp...YjB6', details: [WALLET_LINE.user], signature: 'sig' })
    expect(walletRow({ ts, kind: 'revoked', wallet: phone, why: 'approval', signature: null }, phone)).toMatchObject({ label: 'Stopped planting from your Seed Vault wallet', details: [WALLET_LINE.approval] })
    expect(walletRow({ ts, kind: 'revoked', wallet: phone, why: 'outside', signature: null }, phone).details).toEqual([WALLET_LINE.outside])
  })
})

describe("10-28: the Wallet chip", () => {
  it('keeps top-ups and wallet links/unlinks, nothing else', () => {
    const merged = mergeRows({ topup: [{ row: row('t', '2026-10-28T03:00:00Z') }], wallet: [{ row: row('w', '2026-10-28T02:00:00Z') }], swap: [{ row: row('s', '2026-10-28T01:00:00Z') }] })
    expect(filterRows(merged, 'wallet').map((r) => r.row.key)).toEqual(['t', 'w'])
  })
})
