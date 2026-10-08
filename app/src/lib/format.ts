import { isLend, VENUE_NAME, type AutoVenue, type LendAsset, type LiveAsset } from "./coins";
import type { Holding, LendingPosition } from "./api";

/** Display decimals per leg (the mints', read on chain; stORE is 11; lending legs show the UNDERLYING, USDC 6 and SOL 9, never the receipt). Never money math: the API computes, the app formats. */
export const DECIMALS: Record<LiveAsset, number> = { SKR: 6, stORE: 11, USDC_LEND: 6, SOL_LEND: 9, hSOL: 9, cbBTC: 8 };
export const COIN_NAME: Record<LiveAsset, string> = { SKR: "SKR", stORE: "stORE", USDC_LEND: "USDC", SOL_LEND: "SOL", hSOL: "hSOL", cbBTC: "cbBTC" };
/** Contracts 1.1 / 5.7: the names a list or a sentence uses ("USDC lending"). */
export const COIN_NAME_LONG: Record<LiveAsset, string> = { SKR: "SKR", stORE: "stORE", USDC_LEND: "USDC lending", SOL_LEND: "SOL lending", hSOL: "hSOL", cbBTC: "cbBTC" };
/** Places shown per leg. */
const SHOWN: Record<LiveAsset, number> = { SKR: 2, stORE: 4, USDC_LEND: 2, SOL_LEND: 4, hSOL: 4, cbBTC: 8 };
/** Contracts 5.7, R284: the leg as Activity names it, e.g. "USDC lending (Kamino)". */
export function legLabel(asset: LiveAsset, venue?: AutoVenue | null): string {
  return `${COIN_NAME_LONG[asset]}${venue ? ` (${VENUE_NAME[venue]})` : ""}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SKR_DECIMALS = DECIMALS.SKR;

/** R355 (10-05): a coin amount's whole part grouped by thousands, "12980.46" as "12,980.46"; the decimals untouched. */
export function grouped(n: string): string {
  const [whole, frac] = n.split(".");
  const g = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? g : `${g}.${frac}`;
}
/** A coin amount at `places` decimals, grouped (R355). */
const fixed = (amount: number, places: number) => grouped(amount.toFixed(places));

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");   // "$11,407.00" (10-05)
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** SKR with its dollar value beside it (R44); the dollar part is left out only when no price is known. */
export function formatSkr(raw: bigint, skrUsd: number | null): string {
  const whole = raw / 10n ** BigInt(SKR_DECIMALS);
  const frac = raw % 10n ** BigInt(SKR_DECIMALS);
  const hundredths = Number(frac / 10_000n);
  const skr = `${grouped(String(whole))}.${String(hundredths).padStart(2, "0")} SKR`;
  if (skrUsd === null) return skr;
  const cents = Math.round((Number(raw) / 10 ** SKR_DECIMALS) * skrUsd * 100);
  return `${skr} (${formatUsd(cents)})`;
}

/** stORE with its dollar value beside it: four decimals shown, since a $2 planting is about 0.02 stORE. */
export function formatStore(raw: bigint, storeUsd: number | null): string {
  const unit = 10n ** BigInt(DECIMALS.stORE);
  const whole = raw / unit;
  const tenThousandths = Number((raw % unit) / 10n ** BigInt(DECIMALS.stORE - 4));
  const store = `${grouped(String(whole))}.${String(tenThousandths).padStart(4, "0")} stORE`;
  if (storeUsd === null) return store;
  const cents = Math.round((Number(raw) / 10 ** DECIMALS.stORE) * storeUsd * 100);
  return `${store} (${formatUsd(cents)})`;
}

/** A coin amount with its dollar value beside it when a price is known. SKR and stORE keep their own formatters. */
export function formatAmount(asset: LiveAsset, raw: bigint, usd: number | null): string {
  if (asset === "SKR") return formatSkr(raw, usd);
  if (asset === "stORE") return formatStore(raw, usd);
  const amount = Number(raw) / 10 ** DECIMALS[asset];
  const text = `${fixed(amount, SHOWN[asset])} ${COIN_NAME[asset]}`;
  return usd === null ? text : `${text} (${formatUsd(Math.round(amount * usd * 100))})`;
}

/** The receipt's fee clause: the fee in dollars; "under 1 cent" for a USDC fee that rounds to zero (feeAmountRaw "0"); none for a legacy planting (its fee was taken in the coin) or when feeAmountRaw is absent. */
export function feeClause(feeCents: number, feeAmountRaw?: string): string {
  if (feeCents > 0) return `, fee ${formatUsd(feeCents)}`;
  if (feeCents === 0 && feeAmountRaw === "0") return ", fee under 1 cent";
  return "";
}

/** The line under a pin (the ORE plan's finding 9, generalised): what a share of each dollar grows. */
export function shareLine(asset: LiveAsset, pct: number): string {
  if (pct <= 0) return "Every planting grows SKR.";
  return `About ${pct} cents of every dollar grows ${COIN_NAME[asset]}.`;
}

/** Home's coin row (R150): the amount with its value, nothing else; earned lives in the Earned tile. */
export function holdingAmount(h: Holding): string {
  const raw = BigInt(h.heldRaw);
  const amount = Number(raw) / 10 ** DECIMALS[h.asset];
  const value = h.valueUsd === null ? "" : ` (${formatUsd(Math.round(h.valueUsd * 100))})`;
  return `${fixed(amount, SHOWN[h.asset])} ${COIN_NAME[h.asset]}${value}`;
}
/** Under Home's holdings (spec 3.3, said once): the wallet coins are not locked and Sprouts cannot sell them. */
export const HOLDINGS_NOTE = "These sit in your wallet, not locked. Sprouts cannot sell them for you.";

type Planted = { usdcInCents: number; asset: LiveAsset; amountOutRaw: string; usdPrice: number | null; venue?: AutoVenue | null };
/** What a planting became, no fee clause (Home's receipt row, the push, the widget). A lending leg's amountOutRaw is in RECEIPT units
 * (kUSDC, kSOL at 6 decimals, jl shares; contracts 4), so lending names where the dollars went and never formats that amount. */
export function plantedWhat(p: Planted): string {
  if (isLend(p.asset)) return `${formatUsd(p.usdcInCents)} went into ${legLabel(p.asset, p.venue)}`;
  return `${formatUsd(p.usdcInCents)} became ${formatAmount(p.asset, BigInt(p.amountOutRaw), p.usdPrice)}`;
}
/** A planting in one clause, dollars first (manual 5 and 6), with the fee clause as ruled (R139); lending carries no Sprouts fee (R266). */
export function plantedLine(p: Planted & { feeCents: number; feeAmountRaw?: string }): string {
  if (isLend(p.asset)) return `${plantedWhat(p)}, no Sprouts fee`;
  return `${plantedWhat(p)}${feeClause(p.feeCents, p.feeAmountRaw)}`;
}

/** The pot's headline on Home (manual 5: the big number is dollars first): the dollar value big, the SKR under it; the SKR alone when no price is known. */
export function potHeadline(raw: bigint, skrUsd: number | null): { big: string; small: string | null } {
  const skr = formatSkr(raw, null);
  if (skrUsd === null) return { big: skr, small: null };
  return { big: formatUsd(Math.round((Number(raw) / 10 ** SKR_DECIMALS) * skrUsd * 100)), small: skr };
}

/** A UTC `YYYY-MM-DD` as "Mon D", read as given: the API's day is the day, whatever the phone's zone. */
export function dayLabel(day: string): string {
  const [, m, d] = day.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

export function timeOf(d: Date): string {
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** R350: an Activity row's when, "Oct 5, 7:11 AM", in the phone's zone. */
export function dayTime(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${timeOf(d)}`;
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

/** A time as the staking withdrawals show it: "Oct 4, 3 PM", in the phone's zone. */
const arrivalTime = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric" });

/**
 * When a withdrawal arrives (R156), as a phrase: "arrives Oct 4, 3 PM" while that time is ahead; "arriving today" once readyAt has
 * passed, since the daily delivery job has not yet marked it delivered. `capital` gives the sentence-start form.
 */
export function arrivalLine(readyAt: Date | string, now: Date = new Date(), capital = false): string {
  const at = new Date(readyAt);
  const text = at.getTime() <= now.getTime() ? "arriving today" : `arrives ${arrivalTime(at)}`;
  return capital ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** The change on one swap: the distance to the next multiple of `toCents`; a whole multiple gives a whole step (R29). */
export function roundUpTo(cents: number, toCents: number): number {
  const rest = cents % toCents;
  return rest === 0 ? toCents : toCents - rest;
}

/** One linked wallet in a line: the short address, its status, its daily limit. Home and Settings say it the same way. */
export function formatWallet(w: { pubkey: string; status: string; dailyCapCents: number }): string {
  return `${w.pubkey.slice(0, 4)}...${w.pubkey.slice(-4)}, ${w.status}, up to ${formatUsd(w.dailyCapCents)} a day`;
}

/** A lending position in UNDERLYING units with its value: "2.00 USDC ($2.00)" (contracts 5.2: underlyingRaw is USDC 6 / SOL 9). */
export function positionAmount(p: LendingPosition): string {
  const amount = fixed(Number(p.underlyingRaw) / 10 ** DECIMALS[p.asset], SHOWN[p.asset]);
  return `${amount} ${COIN_NAME[p.asset]}${p.valueUsd === null ? "" : ` (${formatUsd(Math.round(p.valueUsd * 100))})`}`;
}
/** The row's status under the dollars: the venue and today's rate, then what it earned once that is a cent. */
export function positionNote(p: LendingPosition): string {
  const where = p.ratePct === null ? VENUE_NAME[p.venue] : `${VENUE_NAME[p.venue]} ${p.ratePct.toFixed(1)}%`;
  return p.earnedUsd !== null && p.earnedUsd >= 0.005 ? `${where}, earned ${formatUsd(Math.round(p.earnedUsd * 100))}` : where;
}

/** An underlying amount of a lending leg, "0.0010 SOL" (USDC 6 / SOL 9 decimals). */
export function underlyingAmount(asset: LendAsset, raw: string): string {
  return `${fixed(Number(raw) / 10 ** DECIMALS[asset], SHOWN[asset])} ${COIN_NAME[asset]}`;
}
