import { describe, it, expect } from 'vitest'
import { venueCard, venueLines } from '@/model/venues'
import { FIXTURE_VENUES } from '@/lib/lend-fixtures'

describe('the venue card (R275, R276, R278: the rates the AI reads, its verdicts, the pick)', () => {
  it("one line per venue: the asset and venue, today's rate, the 7-day average or how long it has been measured, the state", () => {
    expect(venueLines(FIXTURE_VENUES)).toEqual([
      { key: 'kamino_klend:USDC_LEND', title: 'USDC on Kamino', detail: "4.43%, 7-day 4.41%. Today's pick." },
      {
        key: 'jupiter_lend:USDC_LEND',
        title: 'USDC on Jupiter',
        detail: '3.83% + 0.36% rewards, 7-day 3.90%. Not picked today.',
      },
      {
        key: 'kamino_klend:SOL_LEND',
        title: 'SOL on Kamino',
        detail: '5.62%, 7-day 5.50%. Skipped today: the pool is nearly fully lent out.',
      },
      { key: 'jupiter_lend:SOL_LEND', title: 'SOL on Jupiter', detail: "3.87%, 7-day 3.90%. Today's pick." },
      {
        key: 'kamino_sm_vault:USDC_LEND',
        title: 'USDC on Kamino SM Vault',
        detail: '2.96% + 1.21% rewards, measured 1 day. Compared only.',
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
  it('rewards show beside the rate only when there are some, so the card agrees with the why line (fix round 1, I2)', () => {
    const one = (o: Partial<(typeof FIXTURE_VENUES.venues)[number]>) =>
      venueLines({ ...FIXTURE_VENUES, venues: [{ ...FIXTURE_VENUES.venues[1], ...o }] })[0].detail
    expect(one({})).toBe('3.83% + 0.36% rewards, 7-day 3.90%. Not picked today.')
    expect(one({ rewardsPct: 0 })).toBe('3.83%, 7-day 3.90%. Not picked today.')
    expect(one({ rewardsPct: null })).toBe('3.83%, 7-day 3.90%. Not picked today.')
  })
  it('a venue or veto reason this build does not know never prints "undefined"', () => {
    const row = {
      ...FIXTURE_VENUES.venues[0],
      venue: 'new_venue',
      name: 'New Venue',
      verdict: 'avoid',
      reason: 'new_reason',
      picked: false,
    }
    const [line] = venueLines({ ...FIXTURE_VENUES, venues: [row as unknown as (typeof FIXTURE_VENUES.venues)[number]] })
    expect(line.title).toBe('USDC on New Venue')
    expect(line.detail).toBe('4.43%, 7-day 4.41%. Skipped today.')
  })
  it('the card: lines when there are venues; the empty sentence on an error or an empty list; loading before', () => {
    expect(venueCard(FIXTURE_VENUES, false, 'E')).toMatchObject({ why: FIXTURE_VENUES.why })
    expect(venueCard({ ...FIXTURE_VENUES, venues: [] }, false, 'E')).toEqual({ message: 'E' })
    expect(venueCard(undefined, true, 'E')).toEqual({ message: 'E' })
    expect(venueCard(undefined, false, 'E')).toEqual({ message: 'Loading the venues.' })
  })
})
