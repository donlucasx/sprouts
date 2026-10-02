import { describe, it, expect } from 'vitest'
import {
  usableMe,
  pickMeState,
  noPlantingLine,
  withdrawMode,
  applyRulesTo,
  gardenTotals,
  gardenLine,
  pauseState,
  coinRows,
  statTiles,
  walletsLine,
  lastPlantingLine,
} from '@/lib/me-state'
import type { MeResponse } from '@/lib/api'
const cached = { pot: { asOf: '2026-09-28T16:00:00Z' }, holdings: [], manager: { why: null } } as never
const live = { pot: { asOf: '2026-09-28T17:00:00Z' } } as never
const full = { pot: { asOf: '2026-09-28T16:00:00Z' }, holdings: [], manager: { why: null } } as unknown as MeResponse
describe('pickMeState', () => {
  it('a cached me from before the Yield Manager build (no holdings or manager) counts as no cache (whole-branch review I2)', () => {
    const old = { ...full } as Record<string, unknown>
    delete old.holdings
    delete old.manager
    expect(usableMe(old as unknown as MeResponse)).toBeNull()
    expect(usableMe(full)).toBe(full)
    expect(pickMeState(undefined, old as unknown as MeResponse, false)).toEqual({ data: undefined, stale: false })
    expect(pickMeState(undefined, old as unknown as MeResponse, true)).toEqual({ data: undefined, stale: true })
    expect(pickMeState(undefined, full, false)).toEqual({ data: full, stale: false })
  })
  it('keeps the last verified read on failure and says it is stale', () => {
    expect(pickMeState(undefined, cached, true)).toEqual({ data: cached, stale: true })
  })
  it('prefers the live read', () => {
    expect(pickMeState(live, cached, false)).toEqual({ data: live, stale: false })
  })
  it('never invents a garden', () => {
    expect(pickMeState(undefined, null, true)).toEqual({ data: undefined, stale: true })
  })
})

// The 09-29 Saga check: with a wallet linked and 62 cents waiting, Home still said "Link a wallet and swap."
describe('noPlantingLine', () => {
  const me = (pendingCents: number, statuses: ('active' | 'paused' | 'revoked')[]) =>
    ({
      nextPlanting: { pendingCents, thresholdCents: 200 },
      wallets: statuses.map((status) => ({ pubkey: 'W', status, dailyCapCents: 500 })),
    }) as unknown as MeResponse
  it('asks for a wallet when none is active', () => {
    expect(noPlantingLine(me(0, []))).toBe('No planting yet. Link a wallet and swap.')
    expect(noPlantingLine(me(0, ['revoked']))).toBe('No planting yet. Link a wallet and swap.')
  })
  it('asks for a swap when a wallet is linked and nothing is waiting', () => {
    expect(noPlantingLine(me(0, ['active']))).toBe('No planting yet. Your next swap starts it.')
  })
  it('names the threshold when change is waiting', () => {
    expect(noPlantingLine(me(62, ['active']))).toBe('No planting yet. It plants when the change reaches $2.00.')
  })
})

// The 09-29 Saga check: Withdraw opened on "Earned, 0.00 SKR", the one choice that could not be used.
describe('withdrawMode', () => {
  it('opens on an amount while earned is under 1 SKR', () => {
    expect(withdrawMode(0n, null)).toBe('amount')
    expect(withdrawMode(999_999n, null)).toBe('amount')
  })
  it('opens on earned once there is 1 SKR of it', () => {
    expect(withdrawMode(1_000_000n, null)).toBe('earned')
  })
  it("keeps the user's own choice", () => {
    expect(withdrawMode(0n, 'earned')).toBe('earned')
    expect(withdrawMode(5_000_000n, 'amount')).toBe('amount')
  })
})

// The 10-01 device check: Save and Undo moved the screen twice (the draft cleared, then the fresh read landed); the answer is applied at once.
describe('applyRulesTo', () => {
  const oldRules = {
    roundupOn: true,
    roundupToCents: 100,
    pctOn: false,
    pctBps: 100,
    pctThresholdCents: 5000,
    plantThresholdCents: 200,
    plantMaxDays: 7,
    dailyCapCents: 300,
    managed: false,
    stop: 'balanced',
    pins: {},
    allocation: { SKR: 100 },
  }
  const me = {
    user: { pubkey: 'U' },
    pot: { asOf: '2026-10-01T16:00:00Z' },
    holdings: [],
    history: { plantings: [], picks: [] },
    nextPlanting: { pendingCents: 0, thresholdCents: 200, capLeftCents: 300, asset: 'SKR' },
    lastReceipt: null,
    basket: null,
    wallets: [],
    rules: oldRules,
    manager: {
      managed: false,
      stop: 'balanced',
      pins: {},
      changedDay: '2026-10-01',
      undoAvailable: true,
      why: 'Kept steady.',
      fallback: null,
      stopSplit: { SKR: 100 },
    },
  } as unknown as MeResponse
  const rules = { ...oldRules, managed: true, stop: 'bold', pins: { hSOL: 10 } } as unknown as MeResponse['rules']
  it("replaces the rules, merges the manager's fields from them and the extras, and leaves everything else untouched", () => {
    const out = applyRulesTo(me, rules, { undoAvailable: false, changedDay: null })!
    expect(out.rules).toBe(rules)
    expect(out.manager.managed).toBe(true)
    expect(out.manager.stop).toBe('bold')
    expect(out.manager.pins).toBe(rules.pins)
    expect(out.manager.undoAvailable).toBe(false)
    expect(out.manager.changedDay).toBeNull()
    expect(out.manager.why).toBe('Kept steady.')
    expect(out.manager.stopSplit).toBe(me.manager.stopSplit)
    for (const k of ['user', 'pot', 'holdings', 'history', 'nextPlanting', 'lastReceipt', 'basket', 'wallets'] as const)
      expect(out[k]).toBe(me[k])
    expect(me.rules).toBe(oldRules)
    expect(me.manager.managed).toBe(false)
  })
  it('an extra wins over the field derived from the rules', () => {
    expect(applyRulesTo(me, rules, { managed: false })!.manager.managed).toBe(false)
  })
  it('leaves an empty cache empty', () => {
    expect(applyRulesTo(undefined, rules, {})).toBeUndefined()
  })
})

// R146: the pot card leads with the whole garden in dollars, then put in and earned, then the coins.
describe('gardenTotals and gardenLine', () => {
  const me = {
    pot: { skrStakedRaw: '1284500000', skrEarnedRaw: '84500000', skrUsd: 0.01833 },
    holdings: [
      {
        asset: 'hSOL',
        heldRaw: '2000000000',
        putInCents: 400,
        valueUsd: 336,
        earnedUsd: 2.8,
        earnedUnderlyingRaw: '20000000',
      },
      { asset: 'cbBTC', heldRaw: '2389', putInCents: 200, valueUsd: 1.997, earnedUsd: null, earnedUnderlyingRaw: null },
    ],
    history: { plantings: [{ asset: 'hSOL', usdcInCents: 400 }, { asset: 'cbBTC', usdcInCents: 200 }, { asset: 'SKR', usdcInCents: 23 }] },
  } as never
  it('sums the SKR pot at its price with every wallet coin; earned is the staking and pool growth in dollars; put in is the dollars planted', () => {
    const t = gardenTotals(me)
    expect(t.valueUsd).toBeCloseTo(361.54, 2)
    expect(t.earnedUsd).toBeCloseTo(4.35, 2)
    expect(t.putInCents).toBe(623)
    expect(gardenLine(t)).toBe('Put in $6.23. Earned $4.35.')
  })
  it('without an SKR price the total and earned are unknown and the line says only what was put in', () => {
    const t = gardenTotals({
      ...(me as object),
      pot: { skrStakedRaw: '1284500000', skrEarnedRaw: '84500000', skrUsd: null },
    } as never)
    expect(t.valueUsd).toBeNull()
    expect(t.earnedUsd).toBeNull()
    expect(gardenLine(t)).toBe('Put in $6.23.')
  })
})

// R147: the switch on Home, decided from the wallets' statuses, so it always agrees with what the puller will do.
describe('pauseState', () => {
  const w = (status: 'active' | 'paused' | 'revoked') => ({ pubkey: status, status, dailyCapCents: 500 })
  it('is hidden with no wallet to pause', () => {
    expect(pauseState([])).toEqual({ shown: false, on: false, line: '' })
    expect(pauseState([w('revoked')])).toEqual({ shown: false, on: false, line: '' })
  })
  it('is on while any wallet is active, off when every linked wallet is paused', () => {
    expect(pauseState([w('active'), w('paused')])).toEqual({ shown: true, on: true, line: 'On. Planting your change.' })
    expect(pauseState([w('paused'), w('revoked')])).toEqual({
      shown: true,
      on: false,
      line: 'Paused. Nothing moves; your garden keeps earning.',
    })
  })
})

describe('Home as numbers (R150)', () => {
  const pot = { skrStakedRaw: '34900000', skrUsd: 0.0183 } as MeResponse['pot']
  const hsol = { asset: 'hSOL', heldRaw: '12300000', putInCents: 203, valueUsd: 2.07, earnedUsd: 0.04, earnedUnderlyingRaw: '1' } as const
  it('coinRows: SKR first and locked, then each holding in coin order', () => {
    const rows = coinRows({ pot, holdings: [{ ...hsol, asset: 'cbBTC' }, hsol] })
    expect(rows.map((r) => [r.asset, r.locked])).toEqual([['SKR', true], ['hSOL', false], ['cbBTC', false]])
    expect(rows[0].amount).toBe('34.90 SKR ($0.64)')
    expect(rows[1].amount).toBe('0.0123 hSOL ($2.07)')
  })
  it('coinRows: no SKR row while nothing is staked', () => {
    expect(coinRows({ pot: { ...pot, skrStakedRaw: '0' }, holdings: [hsol] }).map((r) => r.asset)).toEqual(['hSOL'])
  })
  it('statTiles: Put in and Earned as two tiles; Earned left out when unknown', () => {
    expect(statTiles({ valueUsd: 12.4, earnedUsd: 2.4, putInCents: 1000 })).toEqual([
      { label: 'Put in', value: '$10.00' },
      { label: 'Earned', value: '$2.40' },
    ])
    expect(statTiles({ valueUsd: null, earnedUsd: null, putInCents: 1000 })).toEqual([{ label: 'Put in', value: '$10.00' }])
  })
  it('walletsLine: counts the linked wallets in his words, revoked ones aside; null when none', () => {
    expect(walletsLine([{ status: 'active' }, { status: 'paused' }, { status: 'revoked' }])).toBe('2 wallets linked')
    expect(walletsLine([{ status: 'active' }])).toBe('1 wallet linked')
    expect(walletsLine([{ status: 'revoked' }])).toBeNull()
    expect(walletsLine([])).toBeNull()
  })
  it('lastPlantingLine: the date, what the change became, no fee clause', () => {
    const r = { ts: '2026-10-01T14:00:00Z', usdcPulledCents: 206, networkFeeCents: 3, asset: 'hSOL', amountOutRaw: '12300000', feeCents: 1, usdPrice: 168.3, signature: 's' } as MeResponse['lastReceipt']
    expect(lastPlantingLine(r)).toBe('Last planting Oct 1: $2.03 became 0.0123 hSOL ($2.07)')
    expect(lastPlantingLine(null)).toBeNull()
  })
})

describe('gardenTotals: put in follows the holdings (audit finding 7, R159)', () => {
  it("put in is the SKR plantings plus each holding's pro-rated put in, so a sale moves Put in with Earned", () => {
    const me = {
      pot: { skrStakedRaw: '34900000', skrEarnedRaw: '0', skrUsd: 0.0183 },
      holdings: [{ asset: 'hSOL', heldRaw: '6150000', putInCents: 101, valueUsd: 1.03, earnedUsd: 0.02, earnedUnderlyingRaw: '1' }],
      history: { plantings: [{ asset: 'SKR', usdcInCents: 65 }, { asset: 'hSOL', usdcInCents: 203 }], picks: [] },
    } as unknown as MeResponse
    expect(gardenTotals(me).putInCents).toBe(166)
  })
})
