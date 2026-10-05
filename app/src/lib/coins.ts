/** The coin vocabulary, dependency-free so the pure models and their node tests can import it (Ruling P6). Contracts 1.1 and 1.3. */

export type LiveAsset = "SKR" | "stORE" | "USDC_LEND" | "SOL_LEND" | "hSOL" | "cbBTC";
export type RetiredAsset = "JitoSOL" | "JupSOL";
/** What a row from the API may carry: retired rows stay readable in history and are shown nowhere (R281). */
export type Asset = LiveAsset | RetiredAsset;
export type LendAsset = "USDC_LEND" | "SOL_LEND";
/** The spec's order, the order every list in the app shows. */
export const ASSETS: readonly LiveAsset[] = ["SKR", "stORE", "USDC_LEND", "SOL_LEND", "hSOL", "cbBTC"] as const;
export const isRetired = (a: string): a is RetiredAsset => a === "JitoSOL" || a === "JupSOL";
export const isLend = (a: string): a is LendAsset => a === "USDC_LEND" || a === "SOL_LEND";
export type Stop = "careful" | "balanced" | "bold";
/** Whole percents per live leg, summing to 100. */
export type Split = Record<LiveAsset, number>;
/** The user's pins: a fixed percent per leg; a missing leg is the manager's to set, or 0 when the manager is off. */
export type Pins = Partial<Record<LiveAsset, number>>;
export type Venue = "kamino_klend" | "jupiter_lend" | "kamino_sm_vault" | "marginfi" | "lulo_protected";
/** The only venues that receive money (spec 3). */
export type AutoVenue = "kamino_klend" | "jupiter_lend";
export const VENUE_NAME: Record<Venue, string> = { kamino_klend: "Kamino", jupiter_lend: "Jupiter", kamino_sm_vault: "Kamino SM Vault", marginfi: "marginfi", lulo_protected: "Lulo Protected" };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** A split as any API version serves it: live keys kept, missing ones 0, retired shares folded into SKR so the sum stays 100 (contracts 1.1 toSplit [decision]). */
export function liveSplit(p: Partial<Record<string, number>> | null | undefined): Split {
  const out = { SKR: 0, stORE: 0, USDC_LEND: 0, SOL_LEND: 0, hSOL: 0, cbBTC: 0 } as Split;
  for (const a of ASSETS) out[a] = num(p?.[a]);
  out.SKR += num(p?.JitoSOL) + num(p?.JupSOL);
  return out;
}
/** Pins on live legs only; a pin on a retired coin is dropped (contracts 4, migration step 10). */
export function livePins(p: Partial<Record<string, number>> | null | undefined): Pins {
  const out: Pins = {};
  for (const a of ASSETS) {
    const v = p?.[a];
    if (typeof v === "number") out[a] = v;
  }
  return out;
}
