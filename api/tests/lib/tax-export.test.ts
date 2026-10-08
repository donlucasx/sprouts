import { describe, it, expect } from "vitest";
import type { EventRow, PlantingLegRow, PlantingRow, WithdrawalRow } from "@/db/types";
import { formatRaw, formatCents, koinlyDate, usdCents, csvField, toCsv, plantingRows, withdrawalRows, lendWithdrawalRows, selectRows, KOINLY_HEADER, USDC, coinCurrency, receiptCurrency, type TaxRow } from "@/lib/tax-export";

const planting = (o: Partial<PlantingRow> = {}): PlantingRow => ({
  id: "p1", userPubkey: "U", walletPubkey: "W", ts: new Date("2026-03-04T05:06:07.890Z"), signature: "sigP", usdcPulledCents: 1000, networkFeeCents: 0,
  status: "confirmed", aiLine: null, sharesBefore: null, sharesAfter: null, sharesMinted: null, skrCarryInRaw: 0n, skrSurplusRaw: null, ...o,
});
const leg = (o: Partial<PlantingLegRow> = {}): PlantingLegRow => ({
  plantingId: "p1", asset: "SKR", usdcInCents: 1000, amountOutRaw: 545_123_456n, staked: true, feeAmountRaw: 0n, feeCents: 5, rateAtPlanting: null, venue: null, ...o,
});
const withdrawal = (o: Partial<WithdrawalRow> = {}): WithdrawalRow => ({
  id: "w1", userPubkey: "U", asset: "SKR", unstakeTs: new Date("2026-05-01T12:00:00Z"), unstakeSignature: "sigU", withdrawSignature: "sigW", amountOutRaw: 1_050_000_000n,
  rewardDeltaRaw: null, cancelSignature: null, sharesUnstaked: 1n, amountRaw: 1_050_000_000n, principalRaw: 1_000_000_000n, source: "sprouts", skippedAt: null, ...o,
});
const lendEvent = (detail: unknown, ts = new Date("2026-06-01T00:00:00Z")): EventRow => ({ id: 1, userPubkey: "U", walletPubkey: null, ts, kind: "lend_withdrawn", detail });

describe("formatRaw / formatCents / usdCents: integer arithmetic, dot decimals, at least two places", () => {
  it("formats raw amounts by their decimals", () => {
    expect(formatRaw(545_123_456n, 6)).toBe("545.123456");
    expect(formatRaw(1_500_000n, 6)).toBe("1.50");
    expect(formatRaw(1_000_000n, 6)).toBe("1.00");
    expect(formatRaw(1n, 9)).toBe("0.000000001");
    expect(formatRaw(0n, 6)).toBe("0.00");
    expect(formatRaw(123_456_789_012_345_678_901n, 11)).toBe("1234567890.12345678901");   // beyond 2^53: no float rounding
    expect(formatRaw(-250n, 2)).toBe("-2.50");
    expect(formatRaw(7n, 0)).toBe("7.00");
  });
  it("formats cents", () => {
    expect(formatCents(995)).toBe("9.95");
    expect(formatCents(5)).toBe("0.05");
  });
  it("prices an amount to the cent, half up", () => {
    expect(usdCents(50_000_000n, 6, 0.0183)).toBe("0.92");   // 50 SKR x $0.0183 = $0.915
    expect(usdCents(1_000_000n, 6, 2)).toBe("2.00");
    expect(usdCents(1n, 6, Number.NaN)).toBeNull();
  });
  it("dates are Koinly's YYYY-MM-DD HH:mm:ss in UTC", () => {
    expect(koinlyDate(new Date("2026-03-04T05:06:07.890Z"))).toBe("2026-03-04 05:06:07");
  });
});

describe("plantingRows: one trade per leg", () => {
  it("a coin leg: USDC sent net of the fee, the coin received, the 0.5% fee in USDC, Net Worth = USDC sent", () => {
    const [r] = plantingRows(planting(), [leg()]);
    expect(r).toMatchObject({
      sentAmount: "9.95", sentCurrency: USDC, receivedAmount: "545.123456", receivedCurrency: coinCurrency("SKR"),
      feeAmount: "0.05", feeCurrency: USDC, netWorthAmount: "9.95", netWorthCurrency: "USD", tag: "", txHash: "sigP",
    });
    expect(r.date.toISOString()).toBe("2026-03-04T05:06:07.890Z");
    expect(r.receivedCurrency).toBe("SKR:SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3:SOL");
    expect(r.description).toContain("Sprouts fee 0.05 USDC");
  });
  it("a lending deposit: USDC sent, the venue receipt received (its own decimals), no fee, no tag", () => {
    const [r] = plantingRows(planting(), [leg({ asset: "USDC_LEND", venue: "kamino_klend", usdcInCents: 200, amountOutRaw: 1_661_072n, feeCents: 0, staked: false })]);
    expect(r).toMatchObject({ sentAmount: "2.00", sentCurrency: USDC, receivedAmount: "1.661072", receivedCurrency: receiptCurrency("USDC_LEND", "kamino_klend"), feeAmount: "", feeCurrency: "", tag: "", netWorthAmount: "2.00" });
    expect(r.receivedCurrency).toBe("kUSDC:B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D:SOL");
    const [s] = plantingRows(planting(), [leg({ asset: "SOL_LEND", venue: "jupiter_lend", usdcInCents: 300, amountOutRaw: 12_345_678n, feeCents: 0 })]);
    expect(s).toMatchObject({ receivedAmount: "0.012345678", receivedCurrency: receiptCurrency("SOL_LEND", "jupiter_lend") });
  });
  it("a lending leg with no venue leaves the receipt blank rather than guess it", () => {
    const [r] = plantingRows(planting(), [leg({ asset: "USDC_LEND", venue: null, feeCents: 0 })]);
    expect(r).toMatchObject({ receivedAmount: "", receivedCurrency: "", sentAmount: "10.00" });
  });
  it("a legacy network fee rides the first leg only; unconfirmed plantings give no rows", () => {
    const rows = plantingRows(planting({ networkFeeCents: 3 }), [leg(), leg({ asset: "stORE", amountOutRaw: 100_000_000_000n })]);
    expect(rows.map((r) => r.feeAmount)).toEqual(["0.08", "0.05"]);
    expect(rows[1].receivedAmount).toBe("1.00");
    expect(plantingRows(planting({ status: "sent" }), [leg()])).toEqual([]);
    expect(plantingRows(planting({ status: "failed" }), [leg()])).toEqual([]);
  });
});

describe("withdrawalRows: the earned SKR as a reward a minute before, then the withdrawal", () => {
  it("delivered: reward (earned = amount - principal, priced from the stored price) then the withdrawal with the withdraw signature", () => {
    const [reward, out] = withdrawalRows(withdrawal(), 0.02);
    expect(reward).toMatchObject({ receivedAmount: "50.00", receivedCurrency: coinCurrency("SKR"), tag: "reward", netWorthAmount: "1.00", netWorthCurrency: "USD", txHash: "sigU", sentAmount: "" });
    expect(reward.date.toISOString()).toBe("2026-05-01T11:59:00.000Z");
    expect(out).toMatchObject({ sentAmount: "1050.00", sentCurrency: coinCurrency("SKR"), tag: "", txHash: "sigW", receivedAmount: "" });
  });
  it("no stored price: the reward's worth stays blank", () => {
    const [reward] = withdrawalRows(withdrawal(), null);
    expect(reward).toMatchObject({ netWorthAmount: "", netWorthCurrency: "" });
  });
  it("nothing earned: only the withdrawal", () => {
    expect(withdrawalRows(withdrawal({ principalRaw: 1_050_000_000n }), 0.02).map((r) => r.tag)).toEqual([""]);
  });
  it("undelivered, cancelled and wallet-side unstakes give no rows", () => {
    expect(withdrawalRows(withdrawal({ withdrawSignature: null }), 0.02)).toEqual([]);
    expect(withdrawalRows(withdrawal({ cancelSignature: "c" }), 0.02)).toEqual([]);
    expect(withdrawalRows(withdrawal({ source: "wallet" }), 0.02)).toEqual([]);
  });
});

describe("lendWithdrawalRows: receipt sent, underlying received", () => {
  it("USDC: the underlying and its Net Worth; the redeem signature", () => {
    const [r] = lendWithdrawalRows(lendEvent({ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "1661072", underlyingRaw: "2001591", signature: "sigL" }));
    expect(r).toMatchObject({ sentAmount: "1.661072", sentCurrency: receiptCurrency("USDC_LEND", "kamino_klend"), receivedAmount: "2.001591", receivedCurrency: USDC, netWorthAmount: "2.001591", netWorthCurrency: "USD", tag: "", txHash: "sigL" });
    expect(r.description).toContain("Interest earned is not split out");
  });
  it("SOL: received in SOL with 9 decimals, Net Worth left to the tax tool", () => {
    const [r] = lendWithdrawalRows(lendEvent({ asset: "SOL_LEND", venue: "jupiter_lend", receiptRaw: "940800000", underlyingRaw: "1000000000", signature: "sigS" }));
    expect(r).toMatchObject({ sentAmount: "0.9408", receivedAmount: "1.00", receivedCurrency: "SOL", netWorthAmount: "" });
  });
  it("no recorded underlying: Received left blank and said so", () => {
    const [r] = lendWithdrawalRows(lendEvent({ asset: "USDC_LEND", venue: "jupiter_lend", receiptRaw: "5", signature: "sigN" }));
    expect(r).toMatchObject({ receivedAmount: "", receivedCurrency: "", netWorthAmount: "" });
    expect(r.description).toContain("was not recorded");
  });
  it("malformed events give no row", () => {
    expect(lendWithdrawalRows(lendEvent(null))).toEqual([]);
    expect(lendWithdrawalRows(lendEvent({ asset: "JitoSOL", venue: "kamino_klend", receiptRaw: "1", signature: "x" }))).toEqual([]);
    expect(lendWithdrawalRows(lendEvent({ asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "1.5", signature: "x" }))).toEqual([]);
  });
});

describe("selectRows: the year filter and order", () => {
  const at = (iso: string): TaxRow => plantingRows(planting({ ts: new Date(iso) }), [leg()])[0];
  const rows = [at("2026-01-01T00:00:00Z"), at("2025-12-31T23:59:59Z"), at("2026-12-31T23:59:59Z"), at("2027-01-01T00:00:00Z")];
  it("keeps one UTC calendar year, oldest first", () => {
    expect(selectRows(rows, 2026).map((r) => koinlyDate(r.date))).toEqual(["2026-01-01 00:00:00", "2026-12-31 23:59:59"]);
    expect(selectRows(rows, 2024)).toEqual([]);
  });
  it("no year: everything, oldest first", () => {
    expect(selectRows(rows, null).map((r) => r.date.getUTCFullYear())).toEqual([2025, 2026, 2026, 2027]);
  });
});

describe("CSV: Koinly's header and RFC 4180 escaping", () => {
  it("the header is Koinly's Universal columns, in order", () => {
    expect(toCsv([]).split("\r\n")[0]).toBe("Date,Sent Amount,Sent Currency,Received Amount,Received Currency,Fee Amount,Fee Currency,Net Worth Amount,Net Worth Currency,Tag,Description,TxHash");
    expect(KOINLY_HEADER).toHaveLength(12);
  });
  it("quotes fields with commas, quotes or line breaks and doubles the quotes", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField("a, b")).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("two\nlines")).toBe('"two\nlines"');
  });
  it("a row with a comma and quotes in its description stays twelve columns", () => {
    const r = { ...plantingRows(planting(), [leg()])[0], description: 'Planting, with "quotes"' };
    const line = toCsv([r]).split("\r\n")[1];
    expect(line).toBe(`2026-03-04 05:06:07,9.95,${USDC},545.123456,${coinCurrency("SKR")},0.05,${USDC},9.95,USD,,"Planting, with ""quotes""",sigP`);
    // A naive parser that honours quotes counts twelve fields.
    const fields = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.filter((f) => f !== "");
    expect(fields).toHaveLength(12);
  });
});
