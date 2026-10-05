import { describe, it, expect } from 'vitest'
import { venueLines } from '@/model/venues'
import { FIXTURE_VENUES } from '@/lib/lend-fixtures'

describe('the venue card (R275, R276, R278: the rates the AI reads, its verdicts, the pick)', () => {
  it("one line per venue: the asset and venue, today's rate, the 7-day average or how long it has been measured, the state", () => {
    expect(venueLines(FIXTURE_VENUES)).toEqual([
      { key: 'kamino_klend:USDC_LEND', title: 'USDC on Kamino', detail: "4.43%, 7-day 4.41%. Today's pick." },
      { key: 'jupiter_lend:USDC_LEND', title: 'USDC on Jupiter', detail: '3.83%, 7-day 3.90%. Not picked today.' },
      {
        key: 'kamino_klend:SOL_LEND',
        title: 'SOL on Kamino',
        detail: '5.62%, 7-day 5.50%. Skipped today: the pool is nearly fully lent out.',
      },
      { key: 'jupiter_lend:SOL_LEND', title: 'SOL on Jupiter', detail: "3.87%, 7-day 3.90%. Today's pick." },
      {
        key: 'kamino_sm_vault:USDC_LEND',
        title: 'USDC on Kamino SM Vault',
        detail: '2.96%, measured 1 day. Compared only.',
      },
      { key: 'marginfi:USDC_LEND', title: 'USDC on marginfi', detail: 'Rate unavailable. Compared only.' },
      {
        key: 'lulo_protected:USDC_LEND',
        title: 'USDC on Lulo Protected',
        detail: '5.10%, measured 1 day. Compared only.',
      },
    ])
  })
  it('every veto reason reads plainly; an ineligible auto venue says not used', () => {
    const one = (o: Partial<(typeof FIXTURE_VENUES.venues)[number]>) =>
      venueLines({ ...FIXTURE_VENUES, venues: [{ ...FIXTURE_VENUES.venues[0], picked: false, ...o }] })[0].detail
    expect(one({ verdict: 'avoid', reason: 'incentive_spike' })).toBe(
      '4.43%, 7-day 4.41%. Skipped today: most of the rate is a short-term reward.',
    )
    expect(one({ verdict: 'avoid', reason: 'deposits_fleeing' })).toBe(
      '4.43%, 7-day 4.41%. Skipped today: money is leaving it fast.',
    )
    expect(one({ verdict: 'avoid', reason: 'data_suspect' })).toBe(
      '4.43%, 7-day 4.41%. Skipped today: its numbers look wrong.',
    )
    expect(one({ eligible: false, verdict: null })).toBe('4.43%, 7-day 4.41%. Not used today.')
  })
})
