import type { Repo } from "@/db/repo";
import type { SplitDayRow, VenueDayRow } from "@/db/types";
import { COINS, LEND_ASSETS, type LendAsset } from "@/domain/coins";
import { VENUE_PROTOCOL, pickVenue, venueCandidates, type AutoVenue, type Protocol } from "@/domain/venues";
import { addDays } from "@/domain/day";
import type { LendPosition } from "./holdings";
import { enabledLegs, leashAllowedVenues, type LeashConfig } from "./leash";
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
export type LeashAllowed = Record<LendAsset, readonly AutoVenue[]>;

/**
 * Residual O2: the venues a user's leashed wallet may lend on, per asset (the planting run's own set, `leashAllowedVenues`).
 * Undefined when the user has no leashed wallet (nothing narrows the picks); no venue at all when the config cannot be read
 * (the run then plants nothing for that wallet). A user with a leashed wallet is shown the leash's venues.
 */
export function leashAllowedFor(hasLeashedWallet: boolean, cfg: LeashConfig | null): LeashAllowed | undefined {
  if (!hasLeashedWallet) return undefined;
  const enabled = new Set<number>(cfg ? enabledLegs(cfg) : []);
  return { USDC_LEND: leashAllowedVenues(enabled, "USDC_LEND"), SOL_LEND: leashAllowedVenues(enabled, "SOL_LEND") };
}

/**
 * K-I5: the stop's stored pick is code's pick BEFORE each user's 60% protocol cap (contracts 4 step 9); the planting run applies the
 * cap with the user's own positions. What a user is shown (picks, `picked`, the routing sentence, the lend signs) must name where
 * THEIR money goes, so the same cap is applied here, on the same day's venue rows the pick was made from, with `addUsd` the user's
 * next pull (min of the change waiting and their daily limit; the run's real pull is never larger). A pick the cap moves gets the
 * capped sentence; nothing moved, the stored `why` stands. Unknown positions (null): the stored picks and why stand, unless the
 * leash narrows them. Residual O2: `leash` (a leashed user) narrows every pick to the venues the leash allows, as the run does; a
 * pick the leash moves gets the leash sentence.
 */
export async function userRouting(a: { repo: Repo; splitRow: SplitDayRow | null; positions: LendPosition[] | null; prices: Partial<Record<LendAsset, number | null>>; addUsd: number; leash?: LeashAllowed }): Promise<{ picks: Picks; why: string | null }> {
  const stored: Picks = a.splitRow?.venuePick ?? {};
  if (!a.splitRow) return { picks: stored, why: null };
  const capKnown = a.positions !== null && a.positions.length > 0;
  if (!capKnown && !a.leash) return { picks: stored, why: a.splitRow.why };
  const rows = await a.repo.listVenueDays(a.splitRow.day);
  const yesterday = await a.repo.listVenueDays(addDays(a.splitRow.day, -1));
  const byProtocol = capKnown ? lendingUsdByProtocol(a.positions!, rows, a.prices) : {};
  const picks: Picks = { ...stored };
  const moved: LendAsset[] = [];
  const leashed = new Set<LendAsset>();
  for (const asset of LEND_ASSETS) {
    const s = stored[asset];
    if (!s) continue;
    const allowed = a.leash?.[asset];
    const capped = pickVenue({ candidates: venueCandidates(asset, rows, yesterday), lendingUsdByProtocol: byProtocol, addUsd: a.addUsd, ...(allowed ? { allowed } : {}) });
    if (capped !== s) { picks[asset] = capped; moved.push(asset); if (allowed && !allowed.includes(s)) leashed.add(asset); }
  }
  if (!moved.length) return { picks, why: a.splitRow.why };
  // The capped legs' sentences first; the other routed legs' (code's, as split-run writes them) while the whole stays within WHY_MAX.
  const split = a.splitRow.split;
  // R344: a leash-moved leg gets the plain sentence for the venue it plants to, or none when no allowed venue qualifies (compared only against venues the leash allows).
  const one = (l: LendAsset) => (leashed.has(l) ? (picks[l] ? routingWhy(l, picks[l] ?? null, rows.filter((r) => r.asset !== l || (a.leash?.[l] ?? []).includes(r.venue as never))) : "") : routingWhy(l, picks[l] ?? null, rows, stored[l] ?? null));
  let why = moved.map(one).filter(Boolean).join(" ");
  for (const l of LEND_ASSETS.filter((x) => split[x] > 0 && !moved.includes(x))) {
    const more = routingWhy(l, picks[l] ?? null, rows);
    if (why.length + (why ? 1 : 0) + more.length <= WHY_MAX) why = why ? `${why} ${more}` : more;
  }
  return { picks, why: why || null };
}
