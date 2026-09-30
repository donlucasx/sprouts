/** Decimals per asset, from each mint (stORE read on chain 2026-09-29: 11, not 9). Every raw amount crosses this table. */
export const DECIMALS = { SKR: 6, stORE: 11 } as const;
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

/** One amount in its own coin, dollars beside it: the receipt, Activity and the notification all say it this way. */
export function formatAmount(asset: "SKR" | "stORE", raw: bigint, usd: number | null): string {
  return asset === "SKR" ? formatSkr(raw, usd) : formatStore(raw, usd);
}

/** The line under the fence (audits/ore-plan, finding 9): the picker splits money delivered, not plantings counted. */
export function oreShareLine(share: number): string {
  return share === 0 ? "Every planting grows SKR." : `About ${share} cents of every dollar grows ORE.`;
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
