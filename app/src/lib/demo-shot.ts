import type { ActivityResponse, Holding, LendingPosition, MeResponse } from "./api";

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

/** A wall-clock time `days` before `now` (local), e.g. at(now, 1, 8, 14) = yesterday 8:14. */
function at(now: Date, days: number, h: number, m: number): Date {
  const d = new Date(now.getTime() - days * DAY);
  d.setHours(h, m, 0, 0);
  return d;
}
/** The watering: yesterday morning, but always over a day ago (no buds, no wet rings); the recent plantings all came before it. */
function wateredFor(now: Date): Date {
  return new Date(Math.min(at(now, 1, 9, 5).getTime(), now.getTime() - 1.05 * DAY));
}
/** The four latest plantings, fixed so Home's Last planting line and Activity read plain numbers: two days ago and yesterday morning. */
function recentPlantings(now: Date): { asset: keyof typeof DEMO; cents: number; ts: Date }[] {
  const w = wateredFor(now).getTime();
  const before = (d: Date, minutes: number) => new Date(Math.min(d.getTime(), w - minutes * 60_000));
  return [
    { asset: "SKR", cents: 218, ts: before(at(now, 2, 9, 2), 1500) },
    { asset: "USDC_LEND", cents: 240, ts: before(at(now, 2, 18, 31), 900) },
    { asset: "stORE", cents: 205, ts: before(at(now, 1, 7, 48), 77) },
    { asset: "SKR", cents: 312, ts: before(at(now, 1, 8, 14), 51) },
  ];
}

/** The last demo read, so /api/activity tells the same story Home does. */
let lastDemo: MeResponse | null = null;
export function demoActivityFor(real: ActivityResponse): ActivityResponse {
  return lastDemo ? demoActivity(lastDemo) : real;
}

export function demoMe(real: MeResponse, now: Date = new Date()): MeResponse {
  return (lastDemo = buildDemoMe(real, now));
}
function buildDemoMe(real: MeResponse, now: Date): MeResponse {
  const skrUsd = real.pot.skrUsd ?? 0.0183;
  const storeUsd = real.pot.storeUsd ?? 73;
  const rnd = mulberry32(420);
  const ago = (d: number) => new Date(now.getTime() - d * DAY).toISOString();
  const recent = recentPlantings(now);
  const recentCents = (k: keyof typeof DEMO) => recent.filter((r) => r.asset === k).reduce((t, r) => t + r.cents, 0);
  const LAST_CENTS = 312;
  const plan: [keyof typeof DEMO, number, number][] = [["SKR", 15, putCents("SKR") - recentCents("SKR")], ["stORE", 31, putCents("stORE") - recentCents("stORE")], ["USDC_LEND", 14, putCents("USDC_LEND") - recentCents("USDC_LEND")], ["SOL_LEND", 6, putCents("SOL_LEND")]];
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
  const rawOf = (asset: keyof typeof DEMO, c: number) =>
    asset === "SKR" ? String(Math.round((c / 100 / skrUsd) * 1e6)) : asset === "stORE" ? String(Math.round((c / 100 / storeUsd) * 1e11)) : String(c * 10_000);
  recent.forEach((r, i) =>
    plantings.push({ id: i === recent.length - 1 ? "demo-last" : `demo-recent-${i}`, ts: r.ts.toISOString(), asset: r.asset, usdcInCents: r.cents, amountOutRaw: rawOf(r.asset, r.cents), feeCents: 0, signature: null, venue: r.asset === "USDC_LEND" ? "kamino_klend" : null }),
  );
  const lastTs = recent[recent.length - 1].ts;
  const lastSkrRaw = rawOf("SKR", LAST_CENTS);
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
  // Balanced (SKR at least 35, stORE at most 20); hSOL and cbBTC switched off
  const allocation = DEMO_ALLOCATION;
  const watered = wateredFor(now);   // after the last planting, over a day ago: no buds, no wet rings
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
    manager: { ...real.manager, managed: true, stop: "balanced", pins: DEMO_PINS, changedDay: null, undoAvailable: false, why: DEMO_WHY, fallback: null, legsEnabled: null, picks: { USDC_LEND: "kamino_klend", SOL_LEND: "jupiter_lend" }, stopSplit: allocation },
    history: { plantings, picks: [] },
    nextPlanting: { ...real.nextPlanting, pendingCents: 137, thresholdCents: 200, asset: "stORE" },
    lastReceipt: { ts: lastTs.toISOString(), usdcPulledCents: LAST_CENTS, networkFeeCents: 0, asset: "SKR", amountOutRaw: lastSkrRaw, feeCents: 0, feeAmountRaw: "0", usdPrice: skrUsd, signature: null, venue: null },
    basket: null,
    wallets,
    rules: { ...real.rules, managed: true, stop: "balanced", pins: DEMO_PINS, allocation, roundupOn: true, roundupToCents: 100 },
    relink: { needed: false, wallets: [] },
    terms: { currentVersion: termsVersion, acceptedVersion: termsVersion },
    moveProposal: null,
  };
}

export const DEMO_ALLOCATION = { SKR: 45, stORE: 20, USDC_LEND: 25, SOL_LEND: 10, hSOL: 0, cbBTC: 0 };
const DEMO_PINS = { hSOL: 0, cbBTC: 0 };
const DEMO_WHY = "USDC lending pays 4.4% on Kamino today, more than stORE's recent pace, so more of your change goes there.";

/**
 * /api/activity for the same garden: the latest plantings from demoMe's history (the same rows Home counts), today's swaps whose
 * change waits for the next planting ($1.37, Home's Next planting bar), yesterday's planted swaps, the AI's split change this morning,
 * and two withdrawals (SKR, part of the USDC lending). No signatures that lead anywhere real: the planting rows carry none.
 */
export function demoActivity(me: MeResponse, now: Date = new Date()): ActivityResponse {
  const skrUsd = me.pot.skrUsd ?? 0.0183;
  const storeUsd = me.pot.storeUsd ?? 73;
  const priceOf = (a: string) => (a === "SKR" ? skrUsd : a === "stORE" ? storeUsd : a === "SOL_LEND" ? 150 : 1);
  const plantings = [...me.history.plantings]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 12)
    .map((p) => ({
      id: p.id, ts: p.ts, status: "confirmed" as const, signature: null, usdcPulledCents: p.usdcInCents, networkFeeCents: 0,
      legs: [{ asset: p.asset, usdcInCents: p.usdcInCents, amountOutRaw: p.amountOutRaw, feeCents: 0, feeAmountRaw: "0", usdPrice: priceOf(p.asset), venue: p.venue ?? null }],
    }));
  const today = (h: number, m: number, minsBeforeNow: number) => new Date(Math.min(at(now, 0, h, m).getTime(), now.getTime() - minsBeforeNow * 60_000)).toISOString();
  const recent = recentPlantings(now);
  const sig = (n: number) => `demo${n}`.padEnd(64, "x");
  const swaps: ActivityResponse["swaps"] = [
    { signature: sig(1), ts: today(13, 26, 40), walletPubkey: me.user.pubkey, usdSizeCents: 1458, class: "swap", roundupCents: 42, plantingId: null },
    { signature: sig(2), ts: today(9, 3, 150), walletPubkey: me.user.pubkey, usdSizeCents: 705, class: "swap", roundupCents: 95, plantingId: null },
    { signature: sig(3), ts: new Date(recent[3].ts.getTime() - 3 * 60_000).toISOString(), walletPubkey: me.user.pubkey, usdSizeCents: 4688, class: "swap", roundupCents: 12, plantingId: "demo-last" },
    { signature: sig(4), ts: new Date(recent[3].ts.getTime() - 41 * 60_000).toISOString(), walletPubkey: me.user.pubkey, usdSizeCents: 1210, class: "swap", roundupCents: 90, plantingId: "demo-last" },
    { signature: sig(5), ts: new Date(recent[2].ts.getTime() - 25 * 60_000).toISOString(), walletPubkey: me.user.pubkey, usdSizeCents: 2335, class: "swap", roundupCents: 65, plantingId: "demo-recent-2" },
  ];
  const before = { SKR: 50, stORE: 25, USDC_LEND: 15, SOL_LEND: 10, hSOL: 0, cbBTC: 0 };
  const splits: ActivityResponse["splits"] = [
    { ts: today(6, 0, 300), by: "manager", from: before, to: DEMO_ALLOCATION, stop: "balanced", why: DEMO_WHY, fallback: null, managed: true },
    { ts: at(now, 3, 19, 12).toISOString(), by: "you", from: { SKR: 70, stORE: 20, USDC_LEND: 10, SOL_LEND: 0, hSOL: 0, cbBTC: 0 }, to: before, stop: "balanced", why: null, fallback: null, managed: true, turnedOn: true },
  ];
  const skrRaw = String(Math.round((18.3 / skrUsd) * 1e6));
  const withdrawals: ActivityResponse["withdrawals"] = [
    { id: "demo-w1", ts: at(now, 12, 17, 40).toISOString(), asset: "SKR", source: "sprouts", amountRaw: skrRaw, principalRaw: skrRaw, unstakeSignature: null, withdrawSignature: null, cancelled: false, delivered: true },
  ];
  const lendWithdrawals: NonNullable<ActivityResponse["lendWithdrawals"]> = [
    { ts: at(now, 6, 12, 5).toISOString(), asset: "USDC_LEND", venue: "kamino_klend", receiptRaw: "12450000", underlyingRaw: "15000000", signature: sig(6), whole: false },
  ];
  return { plantings, splits, swaps, withdrawals, lendWithdrawals, moves: [], found: [] };
}
