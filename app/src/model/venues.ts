import type { VenuesResponse, VetoReason } from '@/lib/api'
import { VENUE_NAME } from '@/lib/coins'

/** R275: the AI's reason for skipping a venue for the day, in plain words. */
const REASON: Record<VetoReason, string> = {
  incentive_spike: 'Skipped today: most of the rate is a short-term reward',
  near_full: 'Skipped today: the pool is nearly fully lent out',
  deposits_fleeing: 'Skipped today: money is leaving it fast',
  data_suspect: 'Skipped today: its numbers look wrong',
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/** One line per venue (contracts 5.1): today's actual rate, the 7-day average once two days are measured (spec 4 bootstrap), the state. */
export function venueLines(v: VenuesResponse): { key: string; title: string; detail: string }[] {
  return v.venues.map((r) => {
    const avg =
      r.avg7Pct !== null && r.daysMeasured >= 2
        ? `, 7-day ${r.avg7Pct.toFixed(2)}%`
        : r.daysMeasured === 1
          ? ', measured 1 day'
          : ''
    const rate = r.supplyPct === null ? cap(r.note ?? 'rate unavailable') : `${r.supplyPct.toFixed(2)}%${avg}`
    const state = !r.auto
      ? 'Compared only'
      : r.verdict === 'avoid' && r.reason
        ? REASON[r.reason]
        : r.picked
          ? "Today's pick"
          : r.eligible
            ? 'Not picked today'
            : 'Not used today'
    return {
      key: `${r.venue}:${r.asset}`,
      title: `${r.asset === 'USDC_LEND' ? 'USDC' : 'SOL'} on ${VENUE_NAME[r.venue]}`,
      detail: `${rate}. ${state}.`,
    }
  })
}
