/** Contracts 1.3 + spec 3: the venues, their protocols, and every venue rule. Pure; the cron and plant-run call it with what they read. */
export type Venue = "kamino_klend" | "jupiter_lend" | "kamino_sm_vault" | "marginfi" | "lulo_protected";
export type AutoVenue = "kamino_klend" | "jupiter_lend";
export const AUTO_VENUES: readonly AutoVenue[] = ["kamino_klend", "jupiter_lend"];
export const VENUES: readonly Venue[] = ["kamino_klend", "jupiter_lend", "kamino_sm_vault", "marginfi", "lulo_protected"];
export type VetoReason = "incentive_spike" | "near_full" | "deposits_fleeing" | "data_suspect";
export const VETO_REASONS: readonly VetoReason[] = ["incentive_spike", "near_full", "deposits_fleeing", "data_suspect"];
export type Protocol = "kamino" | "jupiter" | "marginfi" | "lulo";
export const VENUE_PROTOCOL: Record<Venue, Protocol> = { kamino_klend: "kamino", jupiter_lend: "jupiter", kamino_sm_vault: "kamino", marginfi: "marginfi", lulo_protected: "lulo" };
export const VENUE_NAME: Record<Venue, string> = { kamino_klend: "Kamino", jupiter_lend: "Jupiter", kamino_sm_vault: "Kamino SM Vault", marginfi: "marginfi", lulo_protected: "Lulo Protected" };
export const VENUE_SHORT: Record<AutoVenue, string> = { kamino_klend: "Kamino", jupiter_lend: "Jupiter" };
export const isAutoVenue = (s: string): s is AutoVenue => (AUTO_VENUES as readonly string[]).includes(s);

export const RATE_BAND_PCT = { min: 0, max: 15 } as const;
export const MAX_UTILIZATION_PCT = 95;
export const MIN_TVL_USD = 10_000_000;
/** R293: the 60% protocol cap applies once a user's total lending value (USDC + SOL) is at least $20. */
export const CAP_FROM_USD = 20;
export const PROTOCOL_CAP = 0.6;

/** Spec 3: the code's eligibility; a missing number is not eligible. */
export function eligibleVenue(r: { supplyPct: number | null; utilizationPct: number | null; tvlUsd: number | null }): boolean {
  if (r.supplyPct === null || r.utilizationPct === null || r.tvlUsd === null) return false;
  return r.supplyPct >= RATE_BAND_PCT.min && r.supplyPct <= RATE_BAND_PCT.max && r.utilizationPct <= MAX_UTILIZATION_PCT && r.tvlUsd >= MIN_TVL_USD;
}

export type VenueCandidate = { venue: AutoVenue; avg7Pct: number | null; eligible: boolean; verdict: "ok" | "avoid" | null };

/**
 * Spec 4 "code decides the venue": the highest 7-day-average actual rate among eligible, non-vetoed venues; from $20 of lending,
 * no protocol above 60% once the new money lands (R293); `allowed` narrows to the venues whose leash leg is enabled. Null means
 * no venue may take the money: the lending share goes to the next leg (spec 3).
 */
export function pickVenue(a: { candidates: VenueCandidate[]; lendingUsdByProtocol: Partial<Record<Protocol, number>>; addUsd: number; allowed?: readonly AutoVenue[] }): AutoVenue | null {
  const order = (v: AutoVenue) => AUTO_VENUES.indexOf(v);
  const ranked = a.candidates
    .filter((c) => c.eligible && c.verdict !== "avoid" && c.avg7Pct !== null && (!a.allowed || a.allowed.includes(c.venue)))
    .sort((p, q) => (q.avg7Pct as number) - (p.avg7Pct as number) || order(p.venue) - order(q.venue));
  if (!ranked.length) return null;
  const total = Object.values(a.lendingUsdByProtocol).reduce((s, v) => s + (v ?? 0), 0);
  if (total < CAP_FROM_USD) return ranked[0].venue;
  for (const c of ranked) {
    const mine = (a.lendingUsdByProtocol[VENUE_PROTOCOL[c.venue]] ?? 0) + a.addUsd;
    if (mine / (total + a.addUsd) <= PROTOCOL_CAP + 1e-9) return c.venue;
  }
  return null;
}

/** Spec 7, R280: propose a move only when its 30-day dollar gain on 7-day-average actual rates beats 3x its network cost. */
export function moveQualifies(a: { valueUsd: number; fromAvg7Pct: number; toAvg7Pct: number; costUsd: number }): { gain30dUsd: number; qualifies: boolean } {
  const gain30dUsd = (a.valueUsd * (a.toAvg7Pct - a.fromAvg7Pct) * 30) / (100 * 365);
  return { gain30dUsd, qualifies: gain30dUsd > 3 * a.costUsd };
}

/** The mean of our own ok rows' supply rates (the caller passes the last 7 days); spot with one row (Kimi round 2 #10). */
export function avg7(rows: { supplyPct: number | null; ok: boolean }[]): { avg7Pct: number | null; daysMeasured: number } {
  const good = rows.filter((r) => r.ok && r.supplyPct !== null).map((r) => r.supplyPct as number);
  if (!good.length) return { avg7Pct: null, daysMeasured: 0 };
  return { avg7Pct: Math.round((good.reduce((s, x) => s + x, 0) / good.length) * 1e6) / 1e6, daysMeasured: good.length };
}
