import type { VenuesResponse, VenueRow } from '@/lib/api'
import { VENUE_NAME } from '@/lib/coins'

/** R275: the AI's reason for skipping a venue for the day, in plain words. A reason this build does not know reads plainly too. */
const REASON: Record<string, string> = {
  incentive_spike: 'Skipped today: mostly a short-term bonus',
  near_full: 'Skipped today: almost fully lent out',
  deposits_fleeing: 'Skipped today: money is leaving fast',
  data_suspect: 'Skipped today: its numbers look off',
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const pct = (n: number) => `${n.toFixed(2)}%`
/** A venue this build does not know (the API is ahead of a cached phone) keeps the name the API sends. */
const venueName = (r: VenueRow) => (VENUE_NAME as Record<string, string>)[r.venue] ?? r.name

/**
 * One line per venue (contracts 5.1): today's rate, with the rewards beside it when there are any (so the card agrees with the why
 * line's totals, fix round 1 I2), the 7-day average once two days are measured (spec 4 bootstrap), the state.
 */
export function venueLines(v: VenuesResponse): { key: string; title: string; detail: string }[] {
  return v.venues.map((r) => {
    const avg =
      r.avg7Pct !== null && r.daysMeasured >= 2
        ? `, 7-day ${pct(r.avg7Pct)}`
        : r.daysMeasured === 1
          ? ', measured 1 day'
          : ''
    const rewards = r.rewardsPct !== null && r.rewardsPct > 0 ? ` + ${pct(r.rewardsPct)} rewards` : ''
    const rate = r.supplyPct === null ? cap(r.note ?? 'rate unavailable') : `${pct(r.supplyPct)}${rewards}${avg}`
    const state = !r.auto
      ? 'Compared only'
      : r.verdict === 'avoid'
        ? (r.reason && REASON[r.reason]) || 'Skipped today'
        : r.picked
          ? "Today's pick"
          : r.eligible
            ? 'Not picked today'
            : 'Not used today'
    return {
      key: `${r.venue}:${r.asset}`,
      title: `${r.asset === 'USDC_LEND' ? 'USDC' : 'SOL'} on ${venueName(r)}`,
      detail: `${rate}. ${state}.`,
    }
  })
}

/** What the venue card shows: the lines, or one sentence (loading; the read failed or came back empty, review minor 4). */
export function venueCard(
  data: VenuesResponse | undefined,
  isError: boolean,
  empty: string,
): { why: string | null; lines: ReturnType<typeof venueLines> } | { message: string } {
  if (data && data.venues.length > 0) return { why: data.why, lines: venueLines(data) }
  return { message: isError || data ? empty : 'Loading the venues.' }
}

/** R451 (venues moved under the Yield Manager): the venues Sprouts can use first, the ones it only compares after. */
export function venueGroups(v: VenuesResponse): { used: ReturnType<typeof venueLines>; compared: ReturnType<typeof venueLines> } {
  const lines = venueLines(v)
  return { used: lines.filter((_, i) => v.venues[i].auto), compared: lines.filter((_, i) => !v.venues[i].auto) }
}
