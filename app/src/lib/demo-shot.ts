import type { Holding, LendingPosition, MeResponse } from "./api";

/**
 * Dev only, for marketing screenshots (branch demo/shot-420, never merged): Metro started with EXPO_PUBLIC_DEMO_SHOT=1 turns the real
 * /api/me into a grown demo garden worth exactly $420.69, mostly SKR and stORE with USDC and SOL lending behind. Nothing is saved:
 * writeLastMe and the widget refresh do nothing under the flag, so the phone's saved state stays the real one.
 */
export const DEMO_SHOT = process.env.EXPO_PUBLIC_DEMO_SHOT === "1";

const DAY = 86_400_000;
/** Dollars per coin row; they sum to 420.69. Earned sums to 24.69, so Put in is 396.00. */
export const DEMO = {
  SKR: { value: 231.38, earned: 14.12 },
  stORE: { value: 126.21, earned: 8.43 },
  USDC_LEND: { value: 42.07, earned: 1.61 },
  SOL_LEND: { value: 21.03, earned: 0.53 },
} as const;
const cents = (usd: number) => Math.round(usd * 100);
const putCents = (k: keyof typeof DEMO) => cents(DEMO[k].value) - cents(DEMO[k].earned);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` planting sizes that vary like real change (small, usual, a few large) and sum to exactly `total` cents. */
function sizes(n: number, total: number, rnd: () => number): number[] {
  const w = Array.from({ length: n }, () => { const b = rnd(); return b < 0.4 ? 0.4 + rnd() * 0.5 : b < 0.85 ? 1 + rnd() * 2 : 3 + rnd() * 2; });
  const sum = w.reduce((s, x) => s + x, 0);
  const out = w.map((x) => Math.max(30, Math.round((x / sum) * total)));
  out[out.length - 1] += total - out.reduce((s, x) => s + x, 0);
  return out;
}

type Planting = MeResponse["history"]["plantings"][number];

export function demoMe(real: MeResponse, now: Date = new Date()): MeResponse {
  const skrUsd = real.pot.skrUsd ?? 0.0183;
  const storeUsd = real.pot.storeUsd ?? 73;
  const rnd = mulberry32(420);
  const ago = (d: number) => new Date(now.getTime() - d * DAY).toISOString();
  // The last planting (SKR, 2 days ago) is fixed so the Last planting line reads a plain number.
  const LAST_CENTS = 312;
  const plan: [keyof typeof DEMO, number, number][] = [["SKR", 60, putCents("SKR") - LAST_CENTS], ["stORE", 31, putCents("stORE")], ["USDC_LEND", 10, putCents("USDC_LEND")], ["SOL_LEND", 6, putCents("SOL_LEND")]];
  const plantings: Planting[] = [];
  for (const [asset, n, total] of plan) {
    const sz = sizes(n, total, rnd);
    // Spread over the last ~300 days, oldest first; lending started later (about four months ago).
    const span = asset === "USDC_LEND" || asset === "SOL_LEND" ? 120 : 300;
    sz.forEach((c, i) => {
      const day = 3 + span * (1 - (i + rnd() * 0.8) / n);
      const amountOutRaw =
        asset === "SKR" ? String(Math.round((c / 100 / skrUsd) * 1e6)) : asset === "stORE" ? String(Math.round((c / 100 / storeUsd) * 1e11)) : String(c * 10_000);
      plantings.push({ id: `demo-${asset}-${i}`, ts: ago(day), asset, usdcInCents: c, amountOutRaw, feeCents: 0, signature: null, venue: asset === "USDC_LEND" ? "kamino_klend" : asset === "SOL_LEND" ? "jupiter_lend" : null });
    });
  }
  const lastTs = new Date(now.getTime() - 2 * DAY);
  lastTs.setHours(8, 14, 0, 0);
  const lastSkrRaw = String(Math.round((LAST_CENTS / 100 / skrUsd) * 1e6));
  plantings.push({ id: "demo-last", ts: lastTs.toISOString(), asset: "SKR", usdcInCents: LAST_CENTS, amountOutRaw: lastSkrRaw, feeCents: 0, signature: null, venue: null });
  plantings.sort((a, b) => a.ts.localeCompare(b.ts));

  const skrRaw = (usd: number) => String(Math.round((usd / skrUsd) * 1e6));
  const storeRawOf = (usd: number) => String(Math.round((usd / storeUsd) * 1e11));
  const solPrice = 150;
  const positions: LendingPosition[] = [
    { asset: "USDC_LEND", venue: "kamino_klend", receiptMint: "B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D", receiptRaw: String(Math.round(DEMO.USDC_LEND.value * 0.83 * 1e6)), underlyingRaw: String(Math.round(DEMO.USDC_LEND.value * 1e6)), valueUsd: DEMO.USDC_LEND.value, ratePct: 4.43, avg7Pct: 4.41, earnedUsd: DEMO.USDC_LEND.earned, putInCents: putCents("USDC_LEND"), withdrawableUsd: 12_000_000, poolFull: false },
    { asset: "SOL_LEND", venue: "jupiter_lend", receiptMint: "2uQsyo1fXXQkDtcpXnLofWy88PxcvnfH2L8FPSE62FVU", receiptRaw: String(Math.round((DEMO.SOL_LEND.value / solPrice) * 0.94 * 1e9)), underlyingRaw: String(Math.round((DEMO.SOL_LEND.value / solPrice) * 1e9)), valueUsd: DEMO.SOL_LEND.value, ratePct: 3.87, avg7Pct: 3.9, earnedUsd: DEMO.SOL_LEND.earned, putInCents: putCents("SOL_LEND"), withdrawableUsd: 8_000_000, poolFull: false },
  ];
  const holdings: Holding[] = [
    { asset: "stORE", heldRaw: storeRawOf(DEMO.stORE.value), putInCents: putCents("stORE"), valueUsd: DEMO.stORE.value, earnedUsd: DEMO.stORE.earned, earnedUnderlyingRaw: storeRawOf(DEMO.stORE.earned), growthPct: 11 },
    { asset: "USDC_LEND", heldRaw: positions[0].underlyingRaw, putInCents: putCents("USDC_LEND"), valueUsd: DEMO.USDC_LEND.value, earnedUsd: DEMO.USDC_LEND.earned, earnedUnderlyingRaw: String(cents(DEMO.USDC_LEND.earned) * 10_000) },
    { asset: "SOL_LEND", heldRaw: positions[1].underlyingRaw, putInCents: putCents("SOL_LEND"), valueUsd: DEMO.SOL_LEND.value, earnedUsd: DEMO.SOL_LEND.earned, earnedUnderlyingRaw: String(Math.round((DEMO.SOL_LEND.earned / solPrice) * 1e9)) },
  ];
  const linked = real.wallets.filter((w) => w.status !== "revoked");
  const wallets = (linked.length > 0 ? linked : [{ pubkey: real.user.pubkey, status: "active" as const, dailyCapCents: 2000 }]).map((w) => ({ ...w, status: "active" as const, linkModel: "leash" as const }));
  const allocation = { SKR: 55, stORE: 30, USDC_LEND: 10, SOL_LEND: 5, hSOL: 0, cbBTC: 0 };
  const watered = new Date(lastTs.getTime() + 5 * 3_600_000);   // after the last planting, over a day ago: no buds, no wet rings
  const termsVersion = real.terms?.currentVersion ?? "2026-10-06";

  return {
    ...real,
    user: { ...real.user, skrName: real.user.skrName ?? "sprouts.skr", wateredAt: watered.toISOString() },
    pot: {
      ...real.pot,
      skrStakedRaw: skrRaw(DEMO.SKR.value), skrPutInRaw: skrRaw(DEMO.SKR.value - DEMO.SKR.earned), skrEarnedRaw: skrRaw(DEMO.SKR.earned),
      skrPickedRaw: "0", skrPrincipalPickedRaw: "0", joinedValueRaw: "0", fruit: 6, nextFruitProgress: 0.45, skrUnstakingRaw: "0", skrUnstakeReadyAt: null,
      storeRaw: storeRawOf(DEMO.stORE.value), storePutInRaw: storeRawOf(DEMO.stORE.value - DEMO.stORE.earned), storeEarnedRaw: storeRawOf(DEMO.stORE.earned),
      skrUsd, storeUsd, asOf: now.toISOString(),
    },
    holdings,
    positions,
    lendSigns: {
      USDC_LEND: { line1: "USDC", line2: "Kamino 4.4%", venue: "kamino_klend", ratePct: 4.43 },
      SOL_LEND: { line1: "SOL", line2: "Jupiter 3.9%", venue: "jupiter_lend", ratePct: 3.87 },
    },
    manager: { ...real.manager, managed: true, legsEnabled: null, picks: { USDC_LEND: "kamino_klend", SOL_LEND: "jupiter_lend" }, stopSplit: allocation },
    history: { plantings, picks: [] },
    nextPlanting: { ...real.nextPlanting, pendingCents: 137, thresholdCents: 200, asset: "stORE" },
    lastReceipt: { ts: lastTs.toISOString(), usdcPulledCents: LAST_CENTS, networkFeeCents: 0, asset: "SKR", amountOutRaw: lastSkrRaw, feeCents: 0, feeAmountRaw: "0", usdPrice: skrUsd, signature: null, venue: null },
    basket: null,
    wallets,
    rules: { ...real.rules, allocation },
    relink: { needed: false, wallets: [] },
    terms: { currentVersion: termsVersion, acceptedVersion: termsVersion },
    moveProposal: null,
  };
}
