import { isLend, VENUE_NAME, type AutoVenue, type LendAsset, type LiveAsset } from "./coins";
import type { Holding, LendingPosition } from "./api";
import { t } from "@/i18n";
import { dayHourOf, decimalSeparator, dayMonth, dayMonthParts, dayTimeOf, fixedNumber, groupedNumber, percent, timeOfDay, usdFromCents } from "@/i18n/format";

// 0.1.13 P1: the formatters live in @/i18n/format (language-aware); the names the app already imports stay here.
export { clockShort, dayMonth, dayMonthYear, decimalNumber, percent, usdTrimmed, weekday } from "@/i18n/format";

/** Display decimals per leg (the mints', read on chain; stORE is 11; lending legs show the UNDERLYING, USDC 6 and SOL 9, never the receipt). Never money math: the API computes, the app formats. */
export const DECIMALS: Record<LiveAsset, number> = { SKR: 6, stORE: 11, USDC_LEND: 6, SOL_LEND: 9, hSOL: 9, cbBTC: 8 };
export const COIN_NAME: Record<LiveAsset, string> = { SKR: "SKR", stORE: "stORE", USDC_LEND: "USDC", SOL_LEND: "SOL", hSOL: "hSOL", cbBTC: "cbBTC" };
/** Contracts 1.1 / 5.7: the names a list or a sentence uses ("USDC lending"). */
export const COIN_NAME_LONG: Record<LiveAsset, string> = { SKR: "SKR", stORE: "stORE", USDC_LEND: "USDC lending", SOL_LEND: "SOL lending", hSOL: "hSOL", cbBTC: "cbBTC" };
/** 0.1.13: COIN_NAME_LONG in the current language (only the two lending legs have words in them). */
export function coinNameLong(asset: LiveAsset): string {
  return asset === "USDC_LEND" ? t("coin.usdcLending") : asset === "SOL_LEND" ? t("coin.solLending") : COIN_NAME_LONG[asset];
}
/** Places shown per leg. */
const SHOWN: Record<LiveAsset, number> = { SKR: 2, stORE: 4, USDC_LEND: 2, SOL_LEND: 4, hSOL: 4, cbBTC: 8 };
/** Contracts 5.7, R284: the leg as Activity names it, e.g. "USDC lending (Kamino)". */
export function legLabel(asset: LiveAsset, venue?: AutoVenue | null): string {
  return `${coinNameLong(asset)}${venue ? ` (${VENUE_NAME[venue]})` : ""}`;
}
const decimalSep = () => decimalSeparator();
const SKR_DECIMALS = DECIMALS.SKR;

/** R355 (10-05): a coin amount's whole part grouped by thousands, "12980.46" as "12,980.46" (es "12.980,46"); the decimals untouched. */
export function grouped(n: string): string {
  return groupedNumber(n);
}
/** A coin amount at `places` decimals, grouped (R355). */
const fixed = (amount: number, places: number) => fixedNumber(amount, places);

export function formatUsd(cents: number): string {
  return usdFromCents(cents);
}

/** SKR with its dollar value beside it (R44); the dollar part is left out only when no price is known. */
export function formatSkr(raw: bigint, skrUsd: number | null): string {
  const whole = raw / 10n ** BigInt(SKR_DECIMALS);
  const frac = raw % 10n ** BigInt(SKR_DECIMALS);
  const hundredths = Number(frac / 10_000n);
  const skr = `${grouped(String(whole))}${decimalSep()}${String(hundredths).padStart(2, "0")} SKR`;
  if (skrUsd === null) return skr;
  const cents = Math.round((Number(raw) / 10 ** SKR_DECIMALS) * skrUsd * 100);
  return `${skr} (${formatUsd(cents)})`;
}

/** stORE with its dollar value beside it: four decimals shown, since a $2 planting is about 0.02 stORE. */
export function formatStore(raw: bigint, storeUsd: number | null): string {
  const unit = 10n ** BigInt(DECIMALS.stORE);
  const whole = raw / unit;
  const tenThousandths = Number((raw % unit) / 10n ** BigInt(DECIMALS.stORE - 4));
  const store = `${grouped(String(whole))}${decimalSep()}${String(tenThousandths).padStart(4, "0")} stORE`;
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
  if (feeCents > 0) return t("format.fee", { fee: formatUsd(feeCents) });
  if (feeCents === 0 && feeAmountRaw === "0") return t("format.feeUnder");
  return "";
}

/** The line under a pin (the ORE plan's finding 9, generalised): what a share of each dollar grows. */
export function shareLine(asset: LiveAsset, pct: number): string {
  if (pct <= 0) return t("format.share.none");
  return t("format.share", { pct, coin: COIN_NAME[asset] });
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
/** HOLDINGS_NOTE in the current language (the constant stays English for the tests). */
export const holdingsNote = (): string => t("format.holdingsNote");

type Planted = { usdcInCents: number; asset: LiveAsset; amountOutRaw: string; usdPrice: number | null; venue?: AutoVenue | null };
/** What a planting became, no fee clause (Home's receipt row, the push, the widget). A lending leg's amountOutRaw is in RECEIPT units
 * (kUSDC, kSOL at 6 decimals, jl shares; contracts 4), so lending names where the dollars went and never formats that amount. */
export function plantedWhat(p: Planted): string {
  const w = plantedParts(p);
  return w.kind === "went" ? t("planted.went", w.vars) : t("planted.became", w.vars);
}
/** 0.1.13: plantedWhat as its values, so a sentence that carries it is one whole line per language: lending "went" ({usd}, {leg}),
 * any other coin "became" ({usd}, {amount}). */
export function plantedParts(p: Planted): { kind: "became" | "went"; vars: { usd: string; amount: string; leg: string } } {
  const usd = formatUsd(p.usdcInCents);
  if (isLend(p.asset)) return { kind: "went", vars: { usd, leg: legLabel(p.asset, p.venue), amount: "" } };
  return { kind: "became", vars: { usd, amount: formatAmount(p.asset, BigInt(p.amountOutRaw), p.usdPrice), leg: "" } };
}
/** A planting in one clause, dollars first (manual 5 and 6), with the fee clause as ruled (R139); SOL and USDC lending pay 0.5% from the season, and rows from before it keep saying no fee. */
export function plantedLine(p: Planted & { feeCents: number; feeAmountRaw?: string }): string {
  const w = plantedParts(p);
  const fee = formatUsd(p.feeCents);
  if (p.asset === "SOL_LEND" || p.asset === "USDC_LEND") {
    if (p.feeCents > 0) return t("planted.went.fee", { ...w.vars, fee });
    if (p.feeAmountRaw && /^[1-9]\d*$/.test(p.feeAmountRaw)) return t("planted.went.feeUnder", w.vars);
    return t("planted.went.noFee", w.vars);
  }
  // feeClause's three cases, each as a whole line
  const k = w.kind === "went" ? "planted.went" : "planted.became";
  if (p.feeCents > 0) return t(`${k}.fee` as const, { ...w.vars, fee });
  if (p.feeCents === 0 && p.feeAmountRaw === "0") return t(`${k}.feeUnder` as const, w.vars);
  return t(k, w.vars);
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
  return dayMonthParts(Number(m) - 1, Number(d));
}

export function timeOf(d: Date): string {
  return timeOfDay(d);
}

/** R350: an Activity row's when, "Oct 5, 7:11 AM" (es "5 oct, 7:11"), in the phone's zone. */
export function dayTime(iso: string): string {
  return dayTimeOf(new Date(iso));
}

/** "as of 9:41 AM" today, "as of yesterday 9:41 AM", else "as of Sep 20": the last verified read, never a guess. */
export function formatAsOf(date: Date, now: Date = new Date()): string {
  const a = asOfParts(date, now);
  return a.kind === "time" ? t("format.asOf.time", { time: a.value }) : a.kind === "yesterday" ? t("format.asOf.yesterday", { time: a.value }) : t("format.asOf.day", { day: a.value });
}
/** 0.1.13: formatAsOf as its values, for sentences that carry it whole (me-state staleLine): today's time, yesterday's time, or the day. */
export function asOfParts(date: Date, now: Date = new Date()): { kind: "time" | "yesterday" | "day"; value: string } {
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return { kind: "time", value: timeOf(date) };
  if (sameDay(date, yesterday)) return { kind: "yesterday", value: timeOf(date) };
  return { kind: "day", value: dayMonth(date) };
}

/** A time as the staking withdrawals show it: "Oct 4, 3 PM", in the phone's zone. */
const arrivalTime = (d: Date) => dayHourOf(d);

/**
 * When a withdrawal arrives (R156), as a phrase: "arrives Oct 4, 3 PM" while that time is ahead; "arriving today" once readyAt has
 * passed, since the daily delivery job has not yet marked it delivered. `capital` gives the sentence-start form.
 */
export function arrivalLine(readyAt: Date | string, now: Date = new Date(), capital = false): string {
  const a = arrivalParts(readyAt, now);
  if (a.today) return t(capital ? "format.arrivingToday.cap" : "format.arrivingToday");
  return t(capital ? "format.arrives.cap" : "format.arrives", { when: a.when });
}
/** 0.1.13: arrivalLine as its values, for a sentence that carries it whole (Home's basket line): arriving today, or the day and hour. */
export function arrivalParts(readyAt: Date | string, now: Date = new Date()): { today: boolean; when: string } {
  const at = new Date(readyAt);
  return at.getTime() <= now.getTime() ? { today: true, when: "" } : { today: false, when: arrivalTime(at) };
}

/** The change on one swap: the distance to the next multiple of `toCents`; a whole multiple has no change (R484, the API's rule). */
export function roundUpTo(cents: number, toCents: number): number {
  const rest = cents % toCents;
  return rest === 0 ? 0 : toCents - rest;
}

/** One linked wallet in a line: the short address, its status, its daily limit. Home and Settings say it the same way. */
export function formatWallet(w: { pubkey: string; status: string; dailyCapCents: number }): string {
  const status = w.status === "active" || w.status === "paused" || w.status === "revoked" ? t(`format.status.${w.status}` as const) : w.status;
  return t("format.wallet", { wallet: `${w.pubkey.slice(0, 4)}...${w.pubkey.slice(-4)}`, status, cap: formatUsd(w.dailyCapCents) });
}

/** A lending position in UNDERLYING units with its value: "2.00 USDC ($2.00)" (contracts 5.2: underlyingRaw is USDC 6 / SOL 9). */
export function positionAmount(p: LendingPosition): string {
  const amount = fixed(Number(p.underlyingRaw) / 10 ** DECIMALS[p.asset], SHOWN[p.asset]);
  return `${amount} ${COIN_NAME[p.asset]}${p.valueUsd === null ? "" : ` (${formatUsd(Math.round(p.valueUsd * 100))})`}`;
}
/** The row's status under the dollars: the venue and today's rate, then what it earned once that is a cent. */
export function positionWhere(p: LendingPosition): string {
  return p.ratePct === null ? VENUE_NAME[p.venue] : `${VENUE_NAME[p.venue]} ${percent(p.ratePct, 1)}`;
}
export function positionNote(p: LendingPosition): string {
  const where = positionWhere(p);
  return p.earnedUsd !== null && p.earnedUsd >= 0.005 ? t("format.positionNote", { where, amount: formatUsd(Math.round(p.earnedUsd * 100)) }) : where;
}

/** An underlying amount of a lending leg, "0.0010 SOL" (USDC 6 / SOL 9 decimals). */
export function underlyingAmount(asset: LendAsset, raw: string): string {
  return `${fixed(Number(raw) / 10 ** DECIMALS[asset], SHOWN[asset])} ${COIN_NAME[asset]}`;
}
