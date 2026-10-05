/** Contracts 1.3 + spec 3: the venues, their protocols, and every venue rule. Pure; the cron and plant-run call it with what they read. */
export type Venue = "kamino_klend" | "jupiter_lend" | "kamino_sm_vault" | "marginfi" | "lulo_protected";
export type AutoVenue = "kamino_klend" | "jupiter_lend";
export const AUTO_VENUES: readonly AutoVenue[] = ["kamino_klend", "jupiter_lend"];
export const VENUES: readonly Venue[] = ["kamino_klend", "jupiter_lend", "kamino_sm_vault", "marginfi", "lulo_protected"];
export type VetoReason = "incentive_spike" | "near_full" | "deposits_fleeing" | "data_suspect";
export const VETO_REASONS: readonly VetoReason[] = ["incentive_spike", "near_full", "deposits_fleeing", "data_suspect"];
