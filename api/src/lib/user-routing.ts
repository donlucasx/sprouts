import type { Repo } from "@/db/repo";
import type { SplitDayRow, VenueDayRow } from "@/db/types";
import { COINS, LEND_ASSETS, type LendAsset } from "@/domain/coins";
import { VENUE_PROTOCOL, pickVenue, venueCandidates, type AutoVenue, type Protocol } from "@/domain/venues";
import { addDays } from "@/domain/day";
import type { LendPosition } from "./holdings";
import { routingWhy, WHY_MAX } from "./split-run";

/** The user's lending value per protocol (the 60% cap's input): receipt x the venue's exchange rate (underlying raw per receipt raw) x the underlying's price. */
export function lendingUsdByProtocol(positions: LendPosition[], rows: VenueDayRow[], prices: Partial<Record<LendAsset, number | null>>): Partial<Record<Protocol, number>> {
  const out: Partial<Record<Protocol, number>> = {};
  for (const p of positions) {
    const price = prices[p.asset];
    if (!price) continue;
    const rate = rows.find((r) => r.venue === p.venue && r.asset === p.asset)?.exchangeRate ?? 1;
    const usd = ((Number(p.receiptRaw) * rate) / 10 ** COINS[p.asset].decimals) * price;
    out[VENUE_PROTOCOL[p.venue]] = (out[VENUE_PROTOCOL[p.venue]] ?? 0) + usd;
  }
  return out;
}

export type Picks = Partial<Record<LendAsset, AutoVenue | null>>;

/**
 * K-I5: the stop's stored pick is code's pick BEFORE each user's 60% protocol cap (contracts 4 step 9); the planting run applies the
 * cap with the user's own positions. What a user is shown (picks, `picked`, the routing sentence, the lend signs) must name where
 * THEIR money goes, so the same cap is applied here, on the same day's venue rows the pick was made from, with `addUsd` the user's
 * next pull (min of the change waiting and their daily limit; the run's real pull is never larger). A pick the cap moves gets the
 * capped sentence; nothing moved, the stored `why` stands. Unknown positions (null): the stored picks and why stand.
 */
export async function userRouting(a: { repo: Repo; splitRow: SplitDayRow | null; positions: LendPosition[] | null; prices: Partial<Record<LendAsset, number | null>>; addUsd: number }): Promise<{ picks: Picks; why: string | null }> {
  const stored: Picks = a.splitRow?.venuePick ?? {};
  if (!a.splitRow || a.positions === null || a.positions.length === 0) return { picks: stored, why: a.splitRow?.why ?? null };
  const rows = await a.repo.listVenueDays(a.splitRow.day);
  const yesterday = await a.repo.listVenueDays(addDays(a.splitRow.day, -1));
  const byProtocol = lendingUsdByProtocol(a.positions, rows, a.prices);
  const picks: Picks = { ...stored };
  const moved: LendAsset[] = [];
  for (const asset of LEND_ASSETS) {
    const s = stored[asset];
    if (!s) continue;
    const capped = pickVenue({ candidates: venueCandidates(asset, rows, yesterday), lendingUsdByProtocol: byProtocol, addUsd: a.addUsd });
    if (capped !== s) { picks[asset] = capped; moved.push(asset); }
  }
  if (!moved.length) return { picks, why: a.splitRow.why };
  // The capped legs' sentences first; the other routed legs' (code's, as split-run writes them) while the whole stays within WHY_MAX.
  const split = a.splitRow.split;
  let why = moved.map((l) => routingWhy(l, picks[l] ?? null, rows, stored[l] ?? null)).join(" ");
  for (const l of LEND_ASSETS.filter((x) => split[x] > 0 && !moved.includes(x))) {
    const more = routingWhy(l, picks[l] ?? null, rows);
    if (why.length + 1 + more.length <= WHY_MAX) why = `${why} ${more}`;
  }
  return { picks, why };
}
