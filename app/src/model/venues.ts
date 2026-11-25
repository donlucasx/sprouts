import type { VenuesResponse, VenueRow } from '@/lib/api'
import { VENUE_NAME } from '@/lib/coins'
import { percent } from "@/i18n/format"
import { t } from "@/i18n"

/** R275: the AI's reason for skipping a venue for the day, in plain words. A reason this build does not know reads plainly too. */
const REASONS = ['incentive_spike', 'near_full', 'deposits_fleeing', 'data_suspect'] as const
const reasonLine = (r: string | null | undefined): string | null =>
  r && (REASONS as readonly string[]).includes(r) ? t(`venues.state.${r as (typeof REASONS)[number]}`) : null
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const pct = (n: number) => percent(n, 2)
/** A venue this build does not know (the API is ahead of a cached phone) keeps the name the API sends. */
const venueName = (r: VenueRow) => (VENUE_NAME as Record<string, string>)[r.venue] ?? r.name

/**
 * One line per venue (contracts 5.1): this morning's rate (the daily run's, so it can differ from Home's live rate), with the rewards beside it when there are any (so the card agrees with the why
 * line's totals, fix round 1 I2), the 7-day average once two days are measured (spec 4 bootstrap), the state.
 */
export function venueLines(v: VenuesResponse): { key: string; title: string; detail: string }[] {
  return v.venues.map((r) => {
    // 0.1.13: one whole line per variant (rewards or not, 7-day average / one day measured / none); the venue's own note is server text
    const avg = r.avg7Pct !== null && r.daysMeasured >= 2 ? 'avg' : r.daysMeasured === 1 ? 'day1' : null
    const rewards = r.rewardsPct !== null && r.rewardsPct > 0
    const vars = { pct: r.supplyPct === null ? '' : pct(r.supplyPct), rewards: rewards ? pct(r.rewardsPct!) : '', avg: avg === 'avg' ? pct(r.avg7Pct!) : '' }
    const rate =
      r.supplyPct === null
        ? r.note != null ? cap(r.note) : t('venues.rate.none')
        : rewards
          ? t(avg === 'avg' ? 'venues.rate.rewards.avg' : avg === 'day1' ? 'venues.rate.rewards.day1' : 'venues.rate.rewards', vars)
          : t(avg === 'avg' ? 'venues.rate.avg' : avg === 'day1' ? 'venues.rate.day1' : 'venues.rate', vars)
    const state = !r.auto
      ? t('venues.state.compared')
      : r.verdict === 'avoid'
        ? reasonLine(r.reason) ?? t('venues.state.skipped')
        : r.picked
          ? t('venues.state.picked')
          : r.eligible
            ? t('venues.state.notPicked')
            : t('venues.state.notUsed')
    return {
      key: `${r.venue}:${r.asset}`,
      title: t('venues.line.title', { coin: r.asset === 'USDC_LEND' ? 'USDC' : 'SOL', venue: venueName(r) }),
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
  return { message: isError || data ? empty : t('venues.loading') }
}

/**
 * R451 (venues moved under the Yield Manager): the venues Sprouts can use. 0.1.13 (his ruling 11-25: marginfi and Lulo get no money,
 * so they do not show): a venue the API marks not auto is left out; the server still reads and logs its rate.
 */
export function venueGroups(v: VenuesResponse): { used: ReturnType<typeof venueLines> } {
  const lines = venueLines(v)
  return { used: lines.filter((_, i) => v.venues[i].auto) }
}
