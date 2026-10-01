/** The coin vocabulary, dependency-free so the pure models and their node tests can import it (Ruling P6). */

export type Asset = "SKR" | "stORE" | "hSOL" | "JitoSOL" | "JupSOL" | "cbBTC";
/** The registry's order, the order every list in the app shows. */
export const ASSETS: readonly Asset[] = ["SKR", "stORE", "hSOL", "JitoSOL", "JupSOL", "cbBTC"] as const;
export type Stop = "careful" | "balanced" | "bold";
/** Whole percents per coin, summing to 100. */
export type Split = Record<Asset, number>;
/** The user's pins: a fixed percent per coin; a missing coin is the manager's to set, or 0 when the manager is off. */
export type Pins = Partial<Record<Asset, number>>;
