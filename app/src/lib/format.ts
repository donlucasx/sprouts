import type { Asset } from "./coins";
import type { Holding } from "./api";

/** Display decimals per coin (the mints', read on chain; stORE is 11, not 9). Never money math: the API computes, the app formats. */
export const DECIMALS: Record<Asset, number> = { SKR: 6, stORE: 11, hSOL: 9, JitoSOL: 9, JupSOL: 9, cbBTC: 8 };
export const COIN_NAME: Record<Asset, string> = { SKR: "SKR", stORE: "stORE", hSOL: "hSOL", JitoSOL: "JitoSOL", JupSOL: "JupSOL", cbBTC: "cbBTC" };
/** Places shown per coin. */
const SHOWN: Record<Asset, number> = { SKR: 2, stORE: 4, hSOL: 4, JitoSOL: 4, JupSOL: 4, cbBTC: 8 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SKR_DECIMALS = DECIMALS.SKR;

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** SKR with its dollar value beside it (R44); the dollar part is left out only when no price is known. */
export function formatSkr(raw: bigint, skrUsd: number | null): string {
  const whole = raw / 10n ** BigInt(SKR_DECIMALS);
  const frac = raw % 10n ** BigInt(SKR_DECIMALS);
  const hundredths = Number(frac / 10_000n);
  const skr = `${whole}.${String(hundredths).padStart(2, "0")} SKR`;
  if (skrUsd === null) return skr;
  const cents = Math.round((Number(raw) / 10 ** SKR_DECIMALS) * skrUsd * 100);
  return `${skr} (${formatUsd(cents)})`;
}

/** stORE with its dollar value beside it: four decimals shown, since a $2 planting is about 0.02 stORE. */
export function formatStore(raw: bigint, storeUsd: number | null): string {
  const unit = 10n ** BigInt(DECIMALS.stORE);
  const whole = raw / unit;
  const tenThousandths = Number((raw % unit) / 10n ** BigInt(DECIMALS.stORE - 4));
  const store = `${whole}.${String(tenThousandths).padStart(4, "0")} stORE`;
  if (storeUsd === null) return store;
  const cents = Math.round((Number(raw) / 10 ** DECIMALS.stORE) * storeUsd * 100);
  return `${store} (${formatUsd(cents)})`;
}

/** A coin amount with its dollar value beside it when a price is known. SKR and stORE keep their own formatters. */
export function formatAmount(asset: Asset, raw: bigint, usd: number | null): string {
  if (asset === "SKR") return formatSkr(raw, usd);
  if (asset === "stORE") return formatStore(raw, usd);
  const amount = Number(raw) / 10 ** DECIMALS[asset];
  const text = `${amount.toFixed(SHOWN[asset])} ${COIN_NAME[asset]}`;
  return usd === null ? text : `${text} (${formatUsd(Math.round(amount * usd * 100))})`;
}

/** The receipt's fee clause: none for a legacy planting with no recorded fee (migration 0005 left those at 0; their fee was taken in the coin). */
export function feeClause(feeCents: number): string {
  return feeCents > 0 ? `, fee ${formatUsd(feeCents)}` : "";
}

/** The line under a pin (the ORE plan's finding 9, generalised): what a share of each dollar grows. */
export function shareLine(asset: Asset, pct: number): string {
  if (pct <= 0) return "Every planting grows SKR.";
  return `About ${pct} cents of every dollar grows ${COIN_NAME[asset]}.`;
}

/** Home's line per held coin (spec 3.3): the amount with its value, earned when the coin has a measured rate, and where it sits. */
export function formatHolding(h: Holding): string {
  const raw = BigInt(h.heldRaw);
  const amount = Number(raw) / 10 ** DECIMALS[h.asset];
  const value = h.valueUsd === null ? "" : ` (${formatUsd(Math.round(h.valueUsd * 100))})`;
  const earned = h.earnedUsd === null ? "" : `, earned ${formatUsd(Math.round(h.earnedUsd * 100))}`;
  return `${amount.toFixed(SHOWN[h.asset])} ${COIN_NAME[h.asset]}${value}${earned}, in your Seeker wallet, not locked. Sprouts cannot sell it for you.`;
}

/** A UTC `YYYY-MM-DD` as "Mon D", read as given: the API's day is the day, whatever the phone's zone. */
export function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

function timeOf(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** "as of 9:41 AM" today, "as of yesterday 9:41 AM", else "as of Sep 20": the last verified read, never a guess. */
export function formatAsOf(date: Date, now: Date = new Date()): string {
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return `as of ${timeOf(date)}`;
  if (sameDay(date, yesterday)) return `as of yesterday ${timeOf(date)}`;
  return `as of ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** The change on one swap: the distance to the next multiple of `toCents`; a whole multiple gives a whole step (R29). */
export function roundUpTo(cents: number, toCents: number): number {
  const rest = cents % toCents;
  return rest === 0 ? toCents : toCents - rest;
}

/** One linked wallet in a line: the short address, its status, its daily limit. Home and Settings say it the same way. */
export function formatWallet(w: { pubkey: string; status: string; dailyCapCents: number }): string {
  return `${w.pubkey.slice(0, 4)}...${w.pubkey.slice(-4)}, ${w.status}, limit ${formatUsd(w.dailyCapCents)} a day`;
}
