import { withNetworkFee } from "./put-in";
import type { PlantingLegRow, PlantingRow, WithdrawalRow, EventRow } from "@/db/types";
import { COINS, isLendAsset, type Asset, type LendAsset } from "@/domain/coins";
import { isAutoVenue, VENUE_SHORT, type AutoVenue } from "@/domain/venues";
import { RECEIPT } from "@/lib/venues/addresses";
import { USDC_MINT } from "@/lib/constants";

/**
 * R447: the taxable events Sprouts creates, as one plain CSV in Koinly's Universal import template (support.koinly.io article
 * 9489976 "How to create a custom CSV file with your data", updated 2026-06-03, read 2026-10-08). This is a record for a tax tool,
 * not tax advice and not a tax form: the tool computes gains and produces Form 8949 / Schedule D from it. Nothing here computes a
 * gain, a lot or an amount of tax.
 *
 * Koinly's rules followed: Date "YYYY-MM-DD HH:mm:ss" in UTC; dot decimals; a trade fills Sent and Received, a deposit only
 * Received, a withdrawal only Sent; the fee is separate from the Sent amount (Koinly's example: 200 USD sent + 20 USD fee = 220
 * spent); Net Worth is the worth of the transacted amount in a fiat currency; one tag per row from its CSV tag list; tokens pinned
 * with its extended notation SYMBOL:CONTRACT_ADDRESS:BLOCKCHAIN so a same-symbol token is never picked.
 */
export const KOINLY_HEADER = ["Date", "Sent Amount", "Sent Currency", "Received Amount", "Received Currency", "Fee Amount", "Fee Currency", "Net Worth Amount", "Net Worth Currency", "Tag", "Description", "TxHash"] as const;

export type TaxRow = {
  date: Date;
  sentAmount: string; sentCurrency: string;
  receivedAmount: string; receivedCurrency: string;
  feeAmount: string; feeCurrency: string;
  netWorthAmount: string; netWorthCurrency: string;
  /** Koinly CSV tags only ("reward" is the one used); empty for trades and transfers. */
  tag: "" | "reward";
  description: string;
  txHash: string;
};

/** A raw integer amount with its decimals as a dot-decimal string, by integer arithmetic only: (1_500_000n, 6) -> "1.50"; at least two decimals ("##.00"). */
export function formatRaw(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = decimals > 0 ? (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** Cents (a whole number of US cents, as stored) as a dot-decimal string. */
export const formatCents = (cents: number): string => formatRaw(BigInt(cents), 2);

/** Koinly's date: "YYYY-MM-DD HH:mm:ss", UTC. */
export const koinlyDate = (d: Date): string => d.toISOString().slice(0, 19).replace("T", " ");

/**
 * The USD worth of `raw` units at `priceUsd` per whole unit, in cents, rounded half up. The price is a stored decimal (coin_days);
 * it is read as a fixed 12-decimal integer so the multiplication itself is exact.
 */
export function usdCents(raw: bigint, decimals: number, priceUsd: number): string | null {
  if (!Number.isFinite(priceUsd) || priceUsd < 0) return null;
  const [w, f = ""] = priceUsd.toFixed(12).split(".");
  const p = BigInt(w + f.padEnd(12, "0"));   // price x 1e12
  const num = raw * p * 100n;
  const den = 10n ** BigInt(decimals) * 10n ** 12n;
  return formatRaw((num + den / 2n) / den, 2);
}

const pin = (symbol: string, mint: string) => `${symbol}:${mint}:SOL`;
export const USDC = pin("USDC", USDC_MINT);
/** The coin a leg delivers, pinned by its mint (SKR, stORE, hSOL, cbBTC and the retired LSTs). */
export const coinCurrency = (asset: Asset): string => pin(COINS[asset].name, COINS[asset].mint);
const RECEIPT_SYMBOL: Record<LendAsset, Record<AutoVenue, string>> = {
  USDC_LEND: { kamino_klend: "kUSDC", jupiter_lend: "jlUSDC" },
  SOL_LEND: { kamino_klend: "kSOL", jupiter_lend: "jlWSOL" },
};
/** A lending venue's receipt token, pinned by its mint. */
export const receiptCurrency = (asset: LendAsset, venue: AutoVenue): string => pin(RECEIPT_SYMBOL[asset][venue], RECEIPT[asset][venue].mint);
const underlyingOf = (asset: LendAsset) => (asset === "USDC_LEND" ? { currency: USDC, decimals: 6, name: "USDC" } : { currency: "SOL", decimals: 9, name: "SOL" });

const blank = { sentAmount: "", sentCurrency: "", receivedAmount: "", receivedCurrency: "", feeAmount: "", feeCurrency: "", netWorthAmount: "", netWorthCurrency: "", tag: "" as const, txHash: "" };

/**
 * One trade row per leg of a confirmed planting: USDC sent (what went into the swap, the fee excluded), the coin or lending
 * receipt received (what landed), the fee in USDC (the 0.5% Sprouts fee), and
 * the Net Worth as the USDC sent at $1 per USDC. Lending legs carry no tag: Koinly's CSV has no lending-deposit tag, and its
 * "liquidity in" is documented for LP tokens only.
 */
export function plantingRows(p: PlantingRow, legs: PlantingLegRow[]): TaxRow[] {
  if (p.status !== "confirmed") return [];
  // R583 (his ruling 10-10): the legacy 3c "network fee" was planted, so it is cost basis: it joins the USDC sent, never the fee
  return withNetworkFee(legs, [p]).map((l) => {
    const feeCents = l.feeCents;
    const sentCents = l.usdcInCents - l.feeCents;
    const fees: string[] = [];
    if (l.feeCents > 0) fees.push(`Sprouts fee ${formatCents(l.feeCents)} USDC`);
    const feeNote = fees.length ? ` Fee: ${fees.join(" and ")}.` : "";
    let received: { amount: string; currency: string };
    let what: string;
    if (isLendAsset(l.asset)) {
      const venue = l.venue && isAutoVenue(l.venue) ? l.venue : null;
      received = venue ? { amount: formatRaw(l.amountOutRaw, RECEIPT[l.asset][venue].decimals), currency: receiptCurrency(l.asset, venue) } : { amount: "", currency: "" };
      what = venue
        ? `USDC put into ${underlyingOf(l.asset).name} lending on ${VENUE_SHORT[venue]}; received the venue's receipt token.`
        : `USDC put into ${underlyingOf(l.asset).name} lending; the venue was not recorded, so the receipt received is left blank.`;
    } else {
      received = { amount: formatRaw(l.amountOutRaw, COINS[l.asset].decimals), currency: coinCurrency(l.asset) };
      what = `USDC swapped to ${COINS[l.asset].name}${l.asset === "SKR" ? " (staked in your Seed Vault)" : ""}.`;
    }
    return {
      ...blank,
      date: p.ts,
      sentAmount: formatCents(sentCents), sentCurrency: USDC,
      receivedAmount: received.amount, receivedCurrency: received.currency,
      ...(feeCents > 0 ? { feeAmount: formatCents(feeCents), feeCurrency: USDC } : {}),
      netWorthAmount: formatCents(sentCents), netWorthCurrency: "USD",
      description: `Sprouts planting: ${what}${feeNote}`,
      txHash: p.signature ?? "",
    };
  });
}

/**
 * A delivered SKR withdrawal (R41): the SKR earned inside the stake as a "reward" deposit dated one minute before, then the
 * withdrawal of what was delivered (no tag, so the tax tool can match it to the deposit in the user's wallet). The earned part is
 * what the unstake fixed above principal (amountRaw - principalRaw, A15). The reward's Net Worth uses that day's stored SKR price,
 * blank when none is stored (the tool prices it). The table keeps no delivery time: both rows are dated at the unstake.
 * Unstakes the Seed Vault made outside Sprouts (source "wallet"), cancelled and undelivered ones are not Sprouts withdrawals.
 */
export function withdrawalRows(w: WithdrawalRow, skrPriceUsd: number | null): TaxRow[] {
  if (w.source !== "sprouts" || w.cancelSignature !== null || w.withdrawSignature === null || w.asset !== "SKR") return [];
  const decimals = COINS.SKR.decimals;
  const delivered = w.amountOutRaw ?? w.amountRaw;
  if (delivered === null) return [];
  const earned = w.amountRaw !== null && w.amountRaw > w.principalRaw ? w.amountRaw - w.principalRaw : 0n;
  const rows: TaxRow[] = [];
  if (earned > 0n) {
    const worth = skrPriceUsd !== null ? usdCents(earned, decimals, skrPriceUsd) : null;
    rows.push({
      ...blank,
      date: new Date(w.unstakeTs.getTime() - 60_000),
      receivedAmount: formatRaw(earned, decimals), receivedCurrency: coinCurrency("SKR"),
      ...(worth !== null ? { netWorthAmount: worth, netWorthCurrency: "USD" } : {}),
      tag: "reward",
      description: `SKR earned while staked through Sprouts, fixed when you started the withdrawal.${worth === null ? " No stored SKR price for that day; your tax tool can price it." : " Worth at that day's stored SKR price."}`,
      txHash: w.unstakeSignature ?? "",
    });
  }
  rows.push({
    ...blank,
    date: w.unstakeTs,
    sentAmount: formatRaw(delivered, decimals), sentCurrency: coinCurrency("SKR"),
    description: "SKR withdrawn from your Sprouts stake to your wallet. Dated when the withdrawal started; the SKR arrived after the 48-hour cooldown in this transaction.",
    txHash: w.withdrawSignature,
  });
  return rows;
}

/**
 * A lending withdrawal (lend_withdrawn event): the receipt sent, the underlying received. The underlying is the receipt at the
 * venue's rate when the withdrawal confirmed (an estimate the confirm route records; blank when it recorded none). Interest is not
 * split out: Sprouts keeps no per-deposit cost for a receipt, so the row carries no income tag. Malformed events give no row.
 */
export function lendWithdrawalRows(e: EventRow): TaxRow[] {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  const digits = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
  if (typeof d.asset !== "string" || !isLendAsset(d.asset) || typeof d.venue !== "string" || !isAutoVenue(d.venue) || !digits(d.receiptRaw) || typeof d.signature !== "string" || !d.signature) return [];
  const asset = d.asset;
  const venue = d.venue;
  const u = underlyingOf(asset);
  const under = digits(d.underlyingRaw) ? BigInt(d.underlyingRaw) : null;
  return [{
    ...blank,
    date: e.ts,
    sentAmount: formatRaw(BigInt(d.receiptRaw), RECEIPT[asset][venue].decimals), sentCurrency: receiptCurrency(asset, venue),
    ...(under !== null ? { receivedAmount: formatRaw(under, u.decimals), receivedCurrency: u.currency } : {}),
    ...(under !== null && asset === "USDC_LEND" ? { netWorthAmount: formatRaw(under, u.decimals), netWorthCurrency: "USD" } : {}),
    description: `Sprouts lending withdrawal from ${VENUE_SHORT[venue]}: receipt token redeemed for ${u.name}. ${under !== null ? `The ${u.name} amount is the receipt at the venue's rate when the withdrawal confirmed.` : `The ${u.name} amount returned was not recorded; see the transaction.`} Interest earned is not split out.`,
    txHash: d.signature,
  }];
}

/** Every row, oldest first, kept to one UTC calendar year when `year` is given. */
export function selectRows(rows: TaxRow[], year: number | null): TaxRow[] {
  return rows.filter((r) => year === null || r.date.getUTCFullYear() === year).sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break; quotes doubled. */
export function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: TaxRow[]): string {
  const lines = [KOINLY_HEADER.join(",")];
  for (const r of rows) {
    lines.push([koinlyDate(r.date), r.sentAmount, r.sentCurrency, r.receivedAmount, r.receivedCurrency, r.feeAmount, r.feeCurrency, r.netWorthAmount, r.netWorthCurrency, r.tag, r.description, r.txHash].map(csvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
