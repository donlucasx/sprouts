import { describe, it, expect, beforeEach } from 'vitest'
import { FIXTURE_POSITIONS, FIXTURE_LEND_HOLDINGS, FIXTURE_VENUES, FIXTURE_TERMS_VERSION, mockMe } from '@/lib/lend-fixtures'
import { LEND_MOCK, mockAfter, mockBefore, resetMock } from '@/lib/lend-mock'
import { normalizeMe } from '@/lib/me-state'
import type { ActivityResponse, MeResponse } from '@/lib/api'

const real = {
  user: { pubkey: 'U', skrName: null, joinedAt: '2026-09-25T00:00:00.000Z', wateredAt: null },
  pot: { skrStakedRaw: '0', skrPutInRaw: '0', skrEarnedRaw: '0', skrPickedRaw: '0', skrPrincipalPickedRaw: '0', joinedValueRaw: '0', fruit: 0, nextFruitProgress: 0, skrUnstakingRaw: '0', skrUnstakeReadyAt: null, storeRaw: '0', storePutInRaw: '0', storeEarnedRaw: '0', storeRedeemRate: null, skrUsd: null, storeUsd: null, asOf: '2026-10-05T00:00:00.000Z' },
  holdings: [{ asset: 'hSOL', heldRaw: '1', putInCents: 1, valueUsd: 1, earnedUsd: 0, earnedUnderlyingRaw: '0' }],
  manager: { managed: true, stop: 'balanced', pins: {}, changedDay: null, undoAvailable: false, why: null, fallback: null, stopSplit: { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 } },
  history: { plantings: [], picks: [] },
  nextPlanting: { pendingCents: 0, thresholdCents: 200, capLeftCents: 500, asset: 'SKR' },
  lastReceipt: null, basket: null, wallets: [{ pubkey: 'U', status: 'active', dailyCapCents: 500 }],
  rules: { roundupOn: true, roundupToCents: 100, pctOn: true, pctBps: 100, pctThresholdCents: 10000, plantThresholdCents: 200, plantMaxDays: 7, dailyCapCents: 500, managed: true, stop: 'balanced', pins: {}, allocation: { SKR: 100, stORE: 0, hSOL: 0, JitoSOL: 0, JupSOL: 0, cbBTC: 0 } },
} as unknown as MeResponse

describe('the dev mock (EXPO_PUBLIC_LEND_MOCK=1 only)', () => {
  beforeEach(() => resetMock())
  it('is off unless the env flag is set (never in a release build)', () => expect(LEND_MOCK).toBe(false))
  it('fills /api/me with the contract fields: positions, signs, a re-link, unaccepted Terms, lending split', () => {
    const me = normalizeMe(mockAfter('/api/me', real) as MeResponse)
    expect(me.positions).toEqual(FIXTURE_POSITIONS)
    expect(me.lendSigns?.USDC_LEND?.line2).toBe('Kamino 4.4%')
    expect(me.relink).toEqual({ needed: true, wallets: [{ pubkey: 'U', via: 'app' }] })
    expect(me.terms).toEqual({ currentVersion: '2026-10-08', acceptedVersion: null })
    expect(me.rules.allocation).toEqual({ SKR: 45, stORE: 0, USDC_LEND: 15, SOL_LEND: 10, hSOL: 20, cbBTC: 10 })
    expect(me.holdings.map((h) => h.asset)).toEqual(['hSOL', 'USDC_LEND', 'SOL_LEND'])
    expect(me.history.plantings.map((p) => p.asset)).toEqual(['USDC_LEND', 'SOL_LEND'])
    expect(me.moveProposal).toBeNull()   // no faked card unless EXPO_PUBLIC_LEND_MOCK_MOVE=1
  })
  it('every wallet is on the old puller link; another active wallet re-links on the link page, a revoked one is not asked (T9)', () => {
    const withWeb = { ...real, wallets: [...real.wallets, { pubkey: 'W', status: 'active', dailyCapCents: 500 }, { pubkey: 'R', status: 'revoked', dailyCapCents: 500 }] } as MeResponse
    const me = mockAfter('/api/me', withWeb) as MeResponse
    expect(me.wallets.map((w) => w.linkModel)).toEqual(['puller', 'puller', 'puller'])
    expect(me.relink).toEqual({ needed: true, wallets: [{ pubkey: 'U', via: 'app' }, { pubkey: 'W', via: 'link_page' }] })
  })
  it('Terms accepted through the mock stay accepted', () => {
    expect(mockBefore('/api/terms', 'POST', { version: '2026-10-08' })).toMatchObject({ answer: { acceptedVersion: '2026-10-08' } })
    expect((mockAfter('/api/me', real) as MeResponse).terms?.acceptedVersion).toBe(FIXTURE_TERMS_VERSION)
  })
  it('never builds a transaction: withdraw answers the pool-full sentence for a full pool, else says it needs the live API', () => {
    expect(mockBefore('/api/lend/withdraw/build', 'POST', { asset: 'USDC_LEND', venue: 'jupiter_lend' })).toEqual({ error: { status: 409, message: 'A venue can pause withdrawals when its pool is fully lent out; your money stays yours.' } })
    expect(mockBefore('/api/lend/withdraw/build', 'POST', { asset: 'USDC_LEND', venue: 'kamino_klend' })).toEqual({ error: { status: 409, message: 'Mock mode: this needs the live API.' } })
    expect(mockBefore('/api/relink/build', 'POST', {})).toEqual({ error: { status: 409, message: 'Mock mode: this needs the live API.' } })
    expect(mockBefore('/api/me', 'GET', undefined)).toBeNull()
    expect(mockBefore('/api/venues', 'GET', undefined)).toEqual({ answer: FIXTURE_VENUES })
  })
  it('fixtures agree with each other: the aggregated holding is the positions summed (underlying units)', () => {
    for (const asset of ['USDC_LEND', 'SOL_LEND'] as const) {
      const sum = FIXTURE_POSITIONS.filter((p) => p.asset === asset).reduce((s, p) => s + BigInt(p.underlyingRaw), 0n)
      expect(FIXTURE_LEND_HOLDINGS.find((h) => h.asset === asset)?.heldRaw).toBe(String(sum))
    }
    for (const p of FIXTURE_POSITIONS) expect([p.receiptRaw, p.underlyingRaw].every((s) => /^\d+$/.test(s))).toBe(true)
  })
  it('adds the lending rows to /api/activity, keeping the real ones after them', () => {
    const a = mockAfter('/api/activity', { splits: [], swaps: [], plantings: [{ id: 'r' }], withdrawals: [] } as unknown as ActivityResponse) as ActivityResponse
    expect(a.plantings.map((p) => p.id)).toEqual(['mock-a1', 'r'])
    expect(a.lendWithdrawals).toHaveLength(1)
    expect(a.found).toHaveLength(1)
    expect(a.moves).toHaveLength(1)
  })
  it('mockMe can carry a move proposal for the card check', () => expect(mockMe(real, new Date(), { move: true, termsAccepted: false }).moveProposal?.id).toBe('mock-move-1'))
})
