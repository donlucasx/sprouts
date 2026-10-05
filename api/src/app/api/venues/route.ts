import { NextResponse } from "next/server";
import { getRepo } from "@/db/repo";
import type { VenueDayRow } from "@/db/types";
import { requireSession } from "@/lib/auth-guard";
import { json } from "@/lib/json";
import { latestVenueRows } from "@/lib/holdings";
import { dayOf, addDays } from "@/domain/day";
import { VENUES, VENUE_NAME, isAutoVenue, type Venue } from "@/domain/venues";
import { LEND_ASSETS, type LendAsset } from "@/domain/coins";

export const runtime = "nodejs";

/** marginfi is compared on USDC only, and has no reliable rate source (contracts 1.4: "rate unavailable"). */
const ALWAYS: { venue: Venue; asset: LendAsset }[] = [{ venue: "marginfi", asset: "USDC_LEND" }];

/**
 * Contracts 5.1: today's venue table (else each venue's newest row of the last 7 days), the user's stop's picks and why, the
 * scout's finds of the last 7 days. One row per (venue, asset) that has a row; marginfi USDC is always listed.
 */
export async function GET(request: Request) {
  const session = await requireSession(request);
  if (session instanceof NextResponse) return session;
  const repo = await getRepo();
  const user = await repo.getUser(session.pubkey);
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const today = dayOf(new Date());
  // Today's rows, and for a (venue, asset) with no row today (its snapshot failed) its newest rated row of the last 7 days.
  const [todays, latest] = await Promise.all([repo.listVenueDays(today), latestVenueRows(repo, today)]);
  const rows: VenueDayRow[] = [...todays, ...latest.filter((l) => !todays.some((t) => t.venue === l.venue && t.asset === l.asset))];
  const day = rows.reduce((m, r) => (r.day > m ? r.day : m), rows[0]?.day ?? today);
  const rules = await repo.getRules(user.seedVaultPubkey);
  const split = (await repo.getSplitDay(today, rules.stop)) ?? (await repo.latestSplitDay(rules.stop));
  const picks: Partial<Record<LendAsset, string | null>> = split?.venuePick ?? {};
  const venues = VENUES.flatMap((venue) => LEND_ASSETS.map((asset) => ({ venue, asset, r: rows.find((x) => x.venue === venue && x.asset === asset) ?? null })))
    .filter(({ venue, asset, r }) => r !== null || ALWAYS.some((x) => x.venue === venue && x.asset === asset))
    .map(({ venue, asset, r }) => {
      const supplyPct = r?.supplyPct ?? null;
      return {
        venue, asset, name: VENUE_NAME[venue], auto: isAutoVenue(venue), supplyPct, rewardsPct: r?.rewardsPct ?? null, avg7Pct: r?.avg7Pct ?? null, daysMeasured: r?.daysMeasured ?? 0,
        utilizationPct: r?.utilizationPct ?? null, tvlUsd: r?.tvlUsd ?? null, withdrawableUsd: r?.withdrawableUsd ?? null, eligible: r?.eligible ?? false, verdict: r?.verdict ?? null, reason: r?.reason ?? null,
        picked: isAutoVenue(venue) && picks[asset] === venue, note: venue === "marginfi" && supplyPct === null ? "rate unavailable" : null,
      };
    });
  const found = (await repo.listFoundVenues(addDays(today, -7), 20)).map((f) => ({ day: f.day, project: f.project, symbol: f.symbol, asset: f.asset, apyBasePct: f.apyBasePct, tvlUsd: f.tvlUsd, note: f.note }));
  return NextResponse.json(json({ day, venues, picks: split?.venuePick ?? {}, why: split?.why ?? null, found }));
}
